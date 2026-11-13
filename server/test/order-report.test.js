// The order flow keyed on a company-diver report (/order?report=<uuid>): order page, checkout, the paid webhook that
// starts the full report on the factory exactly once, and the hand-off to /r/<id>. Fake Stripe, fake report database,
// fake factory. Nothing leaves the machine. Webhook signatures are made and checked by the real Stripe library.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { createApp } from '../app.js';
import { openStore } from '../store.js';
import { createReportDb } from '../reportdb.js';
import { createFactory } from '../factory.js';

const SECRET = 'whsec_test_secret';
const REPORT = '0b6f3f1e-8f0a-4c52-9a53-0d1f6e0c7a11';
const FACTORY = 'https://factory.test';
const realStripe = new Stripe('sk_test_fake');
const clock = Date.parse('2026-11-11T10:00:00Z');

let app, runs, posts, factoryStatus, dbDown, sessions, sent, mailFail, server, origin, store, cookie, logs;

const fakeStripe = {
  webhooks: realStripe.webhooks,
  checkout: { sessions: {
    async create(params) { const s = { id: `cs_test_${sessions.size + 1}`, url: `https://checkout.stripe.test/${sessions.size + 1}`, payment_status: 'unpaid', ...params }; sessions.set(s.id, s); return s; },
    async retrieve(id) { if (!sessions.has(id)) throw new Error('No such checkout session'); return sessions.get(id); },
  } },
};

function fakeQuery(text, params) {
  if (dbDown) return Promise.reject(new Error('connection refused'));
  if (/from v21_report /.test(text)) return Promise.resolve({ rows: params[0] === REPORT ? [{ company: 'Eternalgy Sdn Bhd' }] : [] });
  if (/select run_id, status/.test(text)) return Promise.resolve({ rows: params[0] === REPORT ? structuredClone(runs) : [] });
  return Promise.reject(new Error(`unexpected query: ${text}`));
}

// The factory: records each start and, like the real one, makes a queued run the report list then shows.
async function fakeFactoryFetch(url, init) {
  assert.equal(String(url), `${FACTORY}/api/v21/deeper`);
  assert.equal(init.headers.authorization, 'Bearer factory-token');
  const body = JSON.parse(init.body);
  posts.push(body);
  if (factoryStatus !== 200) return new Response(JSON.stringify({ error: 'busy' }), { status: factoryStatus });
  await new Promise((r) => setTimeout(r, 5)); // lets a concurrent second call arrive while this one is in flight
  runs.unshift({ run_id: `run-${posts.length}`, status: 'queued', stage: '' });
  return new Response(JSON.stringify({ run_id: `run-${posts.length}` }), { status: 202 });
}

async function start() {
  server?.closeAllConnections(); server?.close(); store?.close();
  store = openStore(':memory:');
  const reportDb = createReportDb({ query: fakeQuery });
  const factory = createFactory({ url: FACTORY, token: 'factory-token', db: reportDb, fetchImpl: fakeFactoryFetch, log: (m) => logs.push(m) });
  const config = { stripeKey: 'sk_test_fake', webhookSecret: SECRET, priceCents: 8900, currency: 'usd', reportHubUrl: FACTORY,
    siteDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site'), seller: { name: 'Test Seller', address: '1 St', note: '' } };
  // mailFail lists the email kinds that fail to send (a test can make the sign-in email fail on its own).
  const mailer = { configured: true, send: async (m) => { sent.push(m); return { ok: !mailFail.includes(m.kind) }; } };
  app = createApp({ stripe: fakeStripe, hub: {}, config, store, mailer, reportDb, factory, now: () => clock, log: (m) => logs.push(m) });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(async () => {
  runs = []; posts = []; factoryStatus = 200; dbDown = false; sessions = new Map(); sent = []; mailFail = []; cookie = ''; logs = [];
  await start();
});
after(() => { server?.closeAllConnections(); server?.close(); });

const get = (p) => fetch(origin + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const post = (p, body, headers = {}) => fetch(origin + p, { method: 'POST', body, headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' });

function signInAs(email) {
  const token = crypto.randomBytes(24).toString('base64url');
  store.upsertUser(email, clock);
  store.createSession(crypto.createHash('sha256').update(token).digest('hex'), email, clock, 3_600_000);
  cookie = `mm_session=${token}`;
}
async function checkout(email = 'buyer@example.com') {
  signInAs(email);
  const res = await post('/order/checkout', `report=${REPORT}`, FORM);
  assert.equal(res.status, 303);
  return [...sessions.keys()].at(-1);
}
async function pay(id) {
  const s = sessions.get(id); s.payment_status = 'paid';
  const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: s } });
  const sig = realStripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return post('/stripe/webhook', payload, { 'stripe-signature': sig, 'content-type': 'application/json' });
}

test('order page: from ?report=, or from a pasted preview link, shows the company and the price', async () => {
  for (const q of [`report=${REPORT}`, `preview=${encodeURIComponent(`https://mirrormirror.test/p/${REPORT}`)}`, `preview=${encodeURIComponent(`${FACTORY}/v21/r/${REPORT}`)}`]) {
    const res = await get(`/order?${q}`);
    assert.equal(res.status, 200, q);
    const body = await res.text();
    assert.match(body, /Full report on Eternalgy Sdn Bhd/);
    assert.match(body, /USD 89/);
  }
});

test('order page: an unknown report is 404, and a database outage shows a friendly page, not a crash', async () => {
  assert.equal((await get('/order?report=11111111-2222-4333-8444-555555555555')).status, 404);
  assert.equal((await get('/order?report=not-a-uuid')).status, 404);
  dbDown = true;
  const res = await get(`/order?report=${REPORT}`);
  assert.equal(res.status, 500);
  const body = await res.text();
  assert.match(body, /could not reach our report service/);
  assert.doesNotMatch(body, /connection refused/);
});

test('checkout: needs an account; then Stripe gets the report id and account email in its metadata', async () => {
  const anon = await post('/order/checkout', `report=${REPORT}`, FORM);
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get('location'), `/login?next=${encodeURIComponent(`/order?report=${REPORT}`)}`);
  assert.equal(sessions.size, 0);

  const id = await checkout();
  const s = sessions.get(id);
  assert.equal(s.metadata.report_id, REPORT);
  assert.equal(s.metadata.account_email, 'buyer@example.com');
  assert.equal(s.metadata.company, 'Eternalgy Sdn Bhd');
  assert.equal(s.client_reference_id, REPORT);
  assert.equal(s.line_items[0].price_data.unit_amount, 8900);
  assert.match(s.cancel_url, new RegExp(`/order\\?report=${REPORT}$`));
});

test('a paid webhook starts the report on the factory once, records the order with its report id and emails the invoice', async () => {
  const id = await checkout();
  assert.equal((await pay(id)).status, 200);
  assert.deepEqual(posts, [{ report_id: REPORT }]);
  const [order] = store.ordersFor('buyer@example.com');
  assert.equal(order.report_id, REPORT);
  assert.equal(order.report_url, `${origin}/r/${REPORT}`);
  assert.deepEqual(sent.map((m) => m.kind), ['invoice', 'payment-signin']);
  assert.equal(sent[0].to, 'buyer@example.com');

  // the same notice again, and the buyer's return page: nothing more is started, nothing more is sent
  assert.equal((await pay(id)).status, 200);
  const back = await get(`/order/done?session_id=${id}`);
  assert.equal(back.status, 200);
  assert.match(await back.text(), new RegExp(`/r/${REPORT}`));
  assert.equal(posts.length, 1);
  assert.equal(sent.length, 2);
  assert.equal(store.ordersFor('buyer@example.com').length, 1);
});

test('the webhook and the return page arriving together still start one run', async () => {
  const id = await checkout();
  sessions.get(id).payment_status = 'paid';
  const [a, b] = await Promise.all([pay(id), get(`/order/done?session_id=${id}`)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(posts.length, 1);
});

test('an existing run is reused (queued, running, done, incomplete, even an unknown status); only a failed one is started again', async () => {
  for (const status of ['queued', 'running', 'done', 'incomplete', 'strange']) {
    posts = []; runs = [{ run_id: 'old', status }]; sessions = new Map(); sent = [];
    await start();
    await pay(await checkout(`buyer-${status}@example.com`));
    assert.equal(posts.length, 0, status);
  }
  posts = []; runs = [{ run_id: 'old', status: 'failed' }]; sessions = new Map();
  await start();
  await pay(await checkout());
  assert.equal(posts.length, 1);
});

test('a paid order always starts its report and records the order', async () => {
  await start();
  const id = await checkout();
  assert.equal((await pay(id)).status, 200);
  assert.equal(posts.length, 1);
  assert.equal(store.ordersFor('buyer@example.com')[0].report_id, REPORT);
});

test('the sweep starts a paid report that never started, once, and leaves a failed run alone', async () => {
  await pay(await checkout());
  runs.length = 0; posts.length = 0; // the paid order exists but its report never started
  assert.equal(await app.sweepPaidReports(), 1);
  assert.equal(posts.length, 1);
  assert.equal(await app.sweepPaidReports(), 0, 'it now has a run: nothing more is started');
  runs.length = 0; runs.push({ run_id: 'x', status: 'failed', stage: '' });
  assert.equal(await app.sweepPaidReports(), 0, 'a failed run is not re-bought in a loop');
  assert.equal(posts.length, 1);
});

test('if the factory refuses, the webhook answers 500 so Stripe retries, and a retry then starts it', async () => {
  const id = await checkout();
  factoryStatus = 503;
  assert.equal((await pay(id)).status, 500);
  assert.equal(store.ordersFor('buyer@example.com').length, 0);
  factoryStatus = 200;
  assert.equal((await pay(id)).status, 200);
  assert.equal(store.ordersFor('buyer@example.com').length, 1);
  assert.equal(posts.length, 2); // the refused try and the good one: still one run
  assert.equal(runs.length, 1);
});

test('after paying, the buyer opens the report; the order page sends them there instead of selling it twice', async () => {
  const id = await checkout();
  await pay(id);
  runs = [{ run_id: 'r1', status: 'running', stage: 'Search', has_html: false }];
  assert.equal((await get(`/r/${REPORT}`)).status, 200); // the gate lets the owner in
  const order = await get(`/order?report=${REPORT}`);
  assert.equal(order.status, 303);
  assert.equal(order.headers.get('location'), `/r/${REPORT}`);
  const again = await post('/order/checkout', `report=${REPORT}`, FORM);
  assert.equal(again.headers.get('location'), `/r/${REPORT}`);
  assert.equal(sessions.size, 1);
  // the report is public now (owner, 2026-11-12): another account opens it too
  signInAs('other@example.com');
  assert.equal((await get(`/r/${REPORT}`)).status, 200);
});

// ---- After payment: a sign-in link, and the account shows the report and its progress ----

const linkIn = (m) => /\/login\/verify\?token=([A-Za-z0-9_-]+)/.exec(String(m?.text ?? ''))?.[1] ?? null;

test('the order page and the done page say the report takes about 120 minutes', async () => {
  const body = await (await get(`/order?report=${REPORT}`)).text();
  assert.match(body, /takes about 120 minutes/);
  const id = await checkout();
  await pay(id);
  const done = await (await get(`/order/done?session_id=${id}`)).text();
  assert.match(done, /about 120 minutes to make/);
  assert.match(done, /sign-in link to <b>buyer@example.com<\/b>/);
});

test('after paying, a sign-in link is emailed; following it signs the buyer in, and the account shows the report being prepared', async () => {
  const id = await checkout();
  assert.equal((await pay(id)).status, 200);
  const mail = sent.find((m) => m.kind === 'payment-signin');
  assert.equal(mail.to, 'buyer@example.com');
  assert.match(mail.text, /about 120 minutes/);
  const token = linkIn(mail);
  assert.ok(token, 'the email holds a sign-in link');

  // the link asks first (a mail scanner cannot use it up); the button signs in and sends them to the account
  assert.equal((await get(`/login/verify?token=${token}`)).status, 200);
  const signed = await post('/login/verify', `token=${token}`, FORM);
  assert.equal(signed.status, 303);
  assert.equal(signed.headers.get('location'), '/account');
  cookie = signed.headers.get('set-cookie').split(';')[0];
  assert.equal((await get(`/login/verify?token=${token}`)).status, 410, 'a used link no longer works');

  runs = [{ run_id: 'run-1', status: 'queued', stage: '', has_html: false }];
  const account = await get('/account/reports');
  assert.equal(account.status, 200);
  const body = await account.text();
  assert.match(body, /Eternalgy Sdn Bhd/);
  assert.match(body, /badge wait">Waiting in the factory queue/);
  assert.match(body, /Report started <small>[^<]*run run-1/);
  assert.match(body, /Usually about 120 minutes|Waiting for a free slot/);
  assert.match(body, new RegExp(`href="/r/${REPORT}"`));
});

test('the sign-in link after payment replaces an earlier sign-in link for the same email', async () => {
  const asked = await post('/login', 'email=buyer%40example.com&next=%2Faccount', FORM);
  assert.equal(asked.status, 200);
  const earlier = linkIn(sent.at(-1));
  assert.equal(sent.at(-1).kind, 'magic-link');
  const id = await checkout();
  await pay(id);
  assert.equal((await get(`/login/verify?token=${earlier}`)).status, 410, 'the earlier link was replaced');
  const fresh = linkIn(sent.find((m) => m.kind === 'payment-signin'));
  assert.equal((await get(`/login/verify?token=${fresh}`)).status, 200);
});

test('if the sign-in email cannot be sent, the report still starts and the done page says so; the next notice tries again', async () => {
  mailFail = ['payment-signin'];
  const id = await checkout();
  assert.equal((await pay(id)).status, 200);
  assert.deepEqual(posts, [{ report_id: REPORT }]);
  assert.equal(store.ordersFor('buyer@example.com').length, 1);
  assert.equal(store.ordersFor('buyer@example.com')[0].signin_emailed_at, null);
  assert.match(await (await get(`/order/done?session_id=${id}`)).text(), /could not email the sign-in link/);

  mailFail = [];
  assert.equal((await pay(id)).status, 200);
  // the webhook, the return page and this notice each tried; only the last one went out, and the invoice went once
  assert.equal(sent.filter((m) => m.kind === 'payment-signin').length, 3);
  assert.equal(sent.filter((m) => m.kind === 'invoice').length, 1);
  assert.notEqual(store.ordersFor('buyer@example.com')[0].signin_emailed_at, null);
  assert.equal(posts.length, 1, 'still one report run');
});
