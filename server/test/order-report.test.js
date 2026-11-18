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
let clock = Date.parse('2026-11-11T10:00:00Z');

const ADS_ID = 'AdsReportId012345678'; // 20 characters, the factory's public id
let adsPosts, adsPostStatus, adsCard;
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
  if (/from published_report p left join ads_market_run/.test(text)) {
    return Promise.resolve({ rows: adsCard && params[0].includes(ADS_ID) ? [{ public_id: ADS_ID, status: adsCard.status, title: adsCard.title, error: adsCard.error ?? null, ads_total: adsCard.ads_total ?? null, advertisers: adsCard.advertisers ?? null, has_html: Boolean(adsCard.html) }] : [] });
  }
  if (/select m\.report_html from published_report/.test(text)) return Promise.resolve({ rows: adsCard?.html && params[0] === ADS_ID ? [{ report_html: adsCard.html }] : [] });
  return Promise.reject(new Error(`unexpected query: ${text}`));
}

// The factory: records each start and, like the real one, makes a queued run the report list then shows.
async function fakeFactoryFetch(url, init) {
  if (String(url) === `${FACTORY}/api/ads-market`) {
    assert.equal(init.headers.authorization, 'Bearer factory-token');
    adsPosts.push(JSON.parse(init.body));
    if (adsPostStatus >= 400) return new Response(JSON.stringify({ error: 'busy' }), { status: adsPostStatus });
    return new Response(JSON.stringify({ report: { id: ADS_ID, status: 'queued' } }), { status: adsPostStatus });
  }
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
  adsPosts = []; adsPostStatus = 202; adsCard = null; runs = []; posts = []; factoryStatus = 200; dbDown = false; sessions = new Map(); sent = []; mailFail = []; cookie = ''; logs = [];
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
  cookie = '';
  assert.equal((await get(`/login/verify?token=${token}`)).status, 200, 'a used link still works: it is valid until a newer link is asked for');
  cookie = signed.headers.get('set-cookie').split(';')[0];

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

test('the sign-in link after payment cancels no earlier link, and a later payment cancels no earlier payment link', async () => {
  const asked = await post('/login', 'email=buyer%40example.com&next=%2Faccount', FORM);
  assert.equal(asked.status, 200);
  const earlier = linkIn(sent.at(-1));
  assert.equal(sent.at(-1).kind, 'magic-link');
  const id = await checkout();
  await pay(id);
  assert.equal((await get(`/login/verify?token=${earlier}`)).status, 200, 'the earlier link still works');
  const fresh = linkIn(sent.find((m) => m.kind === 'payment-signin'));
  assert.equal((await get(`/login/verify?token=${fresh}`)).status, 200);
  assert.doesNotMatch(sent.find((m) => m.kind === 'payment-signin').text, /expires|15 minutes/);

  // a second purchase (second payment email) leaves the first payment email's link alive
  const id2 = await checkout();
  await pay(id2);
  const mails = sent.filter((m) => m.kind === 'payment-signin');
  if (mails.length > 1) for (const m of mails) assert.equal((await get(`/login/verify?token=${linkIn(m)}`)).status, 200);
});

test('only a link the visitor asks for cancels the payment email link', async () => {
  const id = await checkout();
  await pay(id);
  const paymentLink = linkIn(sent.find((m) => m.kind === 'payment-signin'));
  assert.equal((await get(`/login/verify?token=${paymentLink}`)).status, 200);
  clock += 31_000;
  assert.equal((await post('/login', 'email=buyer%40example.com&next=%2Faccount', FORM)).status, 200);
  cookie = ''; // opened from the email on another device, signed out
  assert.equal((await get(`/login/verify?token=${paymentLink}`)).status, 410, 'the visitor asked for a newer link');
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

// ---- Report credits: the 2nd full report is really usable, and credits expire after 90 days ----

const DAY = 86_400_000;
const runCredit = (report = REPORT) => post('/account/reports/run', `report=${report}`, FORM);
const noteOf = (res) => new URL(res.headers.get('location'), 'http://x').searchParams.get('n');

test('credits: a paid order gives 2 full reports + 1 ads credit, each with a last day 90 days after payment, shown on the account', async () => {
  await pay(await checkout());
  const list = store.creditsFor('buyer@example.com', clock);
  assert.equal(list.length, 3);
  for (const c of list) assert.equal(c.expires_at, c.created_at + 90 * DAY);
  const overview = await (await get('/account')).text();
  assert.match(overview, /1 full report/);
  assert.match(overview, /use by 2027-02-09/); // paid 2026-11-11 + 90 days
  const reports = await (await get('/account/reports')).text();
  assert.match(reports, /Run a full report \(uses 1 credit\)/);
  assert.match(reports, /Available, use by 2027-02-09/);
});

test('credits: the second full report runs on the factory, spends the credit, shows in the list, and the balance drops to 0', async () => {
  await pay(await checkout());
  runs = [{ run_id: 'run-1', status: 'done', stage: '' }]; // the first report finished
  const res = await runCredit();
  assert.equal(res.status, 303);
  assert.equal(noteOf(res), 'run_started');
  assert.deepEqual(posts.at(-1), { report_id: REPORT });
  assert.equal(posts.length, 2, 'the paid run, then the credit run');
  assert.equal(store.creditBalance('buyer@example.com', clock).full_report, 0);
  const page = await (await get('/account/reports')).text();
  assert.match(page, /Reports run with a credit/);
  assert.match(page, /Started with 1 report credit/);
  assert.match(page, /You have no full-report credit left/);
  // the run just queued is in flight: a second click starts nothing and spends nothing
  assert.equal(noteOf(await runCredit()), 'run_already');
  assert.equal(posts.length, 2);
  // it finishes; the credit is gone, so nothing starts and nothing is charged
  runs[0].status = 'done';
  assert.equal(noteOf(await runCredit()), 'run_no_credit');
  assert.equal(posts.length, 2);
});

test('credits: if the factory refuses, the credit is given back and the page says so', async () => {
  await pay(await checkout());
  runs = [{ run_id: 'run-1', status: 'done', stage: '' }];
  factoryStatus = 500;
  assert.equal(noteOf(await runCredit()), 'run_failed');
  assert.equal(store.creditBalance('buyer@example.com', clock).full_report, 1, 'credit given back');
  assert.ok(logs.some((l) => /ALERT credit run/.test(l) && /was given back/.test(l)));
  factoryStatus = 200;
  assert.equal(noteOf(await runCredit()), 'run_started', 'and it works on the next try');
});

test('credits: after 90 days they are labelled expired, not counted, and cannot start a run', async () => {
  await pay(await checkout());
  runs = [{ run_id: 'run-1', status: 'done', stage: '' }];
  clock += 91 * DAY;
  signInAs('buyer@example.com'); // the login session itself lasts an hour
  assert.deepEqual(store.creditBalance('buyer@example.com', clock), { full_report: 0, 'ads research': 0 });
  const page = await (await get('/account/reports')).text();
  assert.match(page, /Expired 2027-02-09/);
  const before = posts.length;
  assert.equal(noteOf(await runCredit()), 'run_no_credit');
  assert.equal(posts.length, before);
  assert.equal(store.creditsFor('buyer@example.com', clock).filter((c) => c.state === 'expired').length, 2);
});

test('credits: the credit that expires first is spent first', async () => {
  signInAs('buyer@example.com');
  const late = store.assignCredit('buyer@example.com', 'full_report', 'late', clock, 200 * DAY);
  const soon = store.assignCredit('buyer@example.com', 'full_report', 'soon', clock, 10 * DAY);
  assert.equal(store.spendCredit('buyer@example.com', 'full_report', 'x', clock).id, soon.id);
  assert.equal(store.spendCredit('buyer@example.com', 'full_report', 'y', clock).id, late.id);
});

test('credits: a report that is not the account\'s own, a bad id and a bought report with no run yet start nothing and spend nothing', async () => {
  await pay(await checkout());
  runs = [];
  assert.equal(noteOf(await runCredit('11111111-2222-4333-8444-555555555555')), 'run_unknown');
  assert.equal(noteOf(await runCredit('nope')), 'run_unknown');
  assert.equal(noteOf(await runCredit()), 'run_paid_starting', 'the payment starts that one');
  assert.equal(store.creditBalance('buyer@example.com', clock).full_report, 1);
  assert.equal((await post('/account/reports/run', `report=${REPORT}`, FORM).then((r) => r.status)), 303);
  cookie = '';
  assert.match((await runCredit()).headers.get('location'), /^\/login/);
});

test('credits: a credit can run the full report of a ready free preview (a first run, any company the account has a preview of)', async () => {
  signInAs('other@example.com');
  const { request } = store.addPreviewRequest({ email: 'other@example.com', company: 'Eternalgy Sdn Bhd', who: 'mine' }, clock);
  store.markPreviewReady(request.id, REPORT, clock);
  store.assignCredit('other@example.com', 'full_report', 'gift', clock);
  runs = [];
  const page = await (await get('/account/reports')).text();
  assert.match(page, /Eternalgy Sdn Bhd \(free preview\)/);
  assert.equal(noteOf(await runCredit()), 'run_started');
  assert.deepEqual(posts, [{ report_id: REPORT }]);
  assert.equal(store.creditBalance('other@example.com', clock).full_report, 0);
});

// ---- Social Media Ads Research credit ----

const runAds = (body) => post('/account/reports/ads', body, FORM);
const ADS_FORM = 'keyword=solar+panel+installation&country=Malaysia';

test('ads credit: the form starts the factory\'s ads research, spends the ads credit, and the report appears in the list', async () => {
  await pay(await checkout());
  const page = await (await get('/account/reports')).text();
  assert.match(page, /Run Social Media Ads Research \(uses 1 credit\)/);
  const res = await runAds(ADS_FORM);
  assert.equal(noteOf(res), 'ads_started');
  assert.deepEqual(adsPosts, [{ keyword: 'solar panel installation', country: 'Malaysia', requesterId: 'mirrormirror.cloud' }]);
  assert.equal(store.creditBalance('buyer@example.com', clock)['ads research'], 0);
  const ads = store.creditsFor('buyer@example.com', clock).find((c) => c.kind === 'ads research');
  assert.equal(ads.state, 'used');
  assert.equal(ads.used_for, ADS_ID);
  adsCard = { status: 'running', title: 'solar panel installation — ads market (MY)' };
  const list = await (await get('/account/reports')).text();
  assert.match(list, /solar panel installation — ads market \(MY\)/);
  assert.match(list, /Being written/);
  assert.match(list, new RegExp(`href="/account/ads/${ADS_ID}"`));
  assert.equal(noteOf(await runAds(ADS_FORM)), 'ads_no_credit', 'only one ads credit in the bundle');
  assert.equal(adsPosts.length, 1);
});

test('ads credit: no keyword, a refusing factory, and an expired credit start nothing and lose nothing', async () => {
  await pay(await checkout());
  assert.equal(noteOf(await runAds('keyword=+&country=Malaysia')), 'ads_keyword');
  assert.equal(adsPosts.length, 0);
  adsPostStatus = 500;
  assert.equal(noteOf(await runAds(ADS_FORM)), 'ads_failed');
  assert.equal(store.creditBalance('buyer@example.com', clock)['ads research'], 1, 'credit given back');
  assert.ok(logs.some((l) => /ALERT ads research/.test(l) && /was given back/.test(l)));
  clock += 91 * DAY;
  signInAs('buyer@example.com');
  adsPostStatus = 202;
  assert.equal(noteOf(await runAds(ADS_FORM)), 'ads_no_credit');
  assert.equal(adsPosts.length, 1, 'only the refused attempt reached the factory');
});

test('ads credit: the report page shows the stored page in a sandbox to its owner only, and the state until then', async () => {
  await pay(await checkout());
  await runAds(ADS_FORM);
  adsCard = { status: 'running', title: 'solar — ads market (MY)' };
  let r = await get(`/account/ads/${ADS_ID}`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /is being prepared/);
  adsCard = { status: 'failed', title: 'solar — ads market (MY)', error: 'ad library blocked' };
  assert.match(await (await get(`/account/ads/${ADS_ID}`)).text(), /ad library blocked/);
  adsCard = { status: 'completed', title: 'solar — ads market (MY)', html: '<!doctype html><h1>Teardown</h1>' };
  r = await get(`/account/ads/${ADS_ID}`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<!doctype html><h1>Teardown</h1>');
  assert.match(r.headers.get('content-security-policy'), /^sandbox allow-scripts/);
  signInAs('stranger@example.com');
  assert.equal((await get(`/account/ads/${ADS_ID}`)).status, 404, 'not their credit');
  cookie = '';
  assert.equal((await get(`/account/ads/${ADS_ID}`)).status, 303, 'signed out: to sign in');
});

test('ads credit: a run that fails on the factory gives its credit back once, and the failed run stays listed with its reason', async () => {
  await pay(await checkout());
  await runAds(ADS_FORM);
  assert.equal(store.creditBalance('buyer@example.com', clock)['ads research'], 0);
  adsCard = { status: 'failed', title: 'solar — ads market (MY)', error: 'No worker is claiming ads.market.' };
  const page = await (await get('/account/reports')).text();
  assert.equal(store.creditBalance('buyer@example.com', clock)['ads research'], 1, 'credit given back');
  assert.match(page, /No worker is claiming ads\.market\. Your credit was given back/);
  assert.match(page, /Run failed, given back/);
  assert.match(page, /1 Social Media Ads Research<\/b> left/);
  assert.match(page, new RegExp(`href="/account/ads/${ADS_ID}"`), 'the failed run is still listed');
  // loading again, or opening the run's page, gives nothing more
  await get('/account/reports');
  assert.match(await (await get(`/account/ads/${ADS_ID}`)).text(), /Your credit was given back/);
  assert.equal(store.creditBalance('buyer@example.com', clock)['ads research'], 1);
  assert.equal(store.creditsFor('buyer@example.com', clock).filter((c) => c.kind === 'ads research').length, 2);
  // the credit given back runs it again
  assert.equal(noteOf(await runAds(ADS_FORM)), 'ads_started');
  assert.equal(adsPosts.length, 2);
});

test('credits: a full report run a credit paid for that fails gives the credit back; an earlier failed run does not', async () => {
  await pay(await checkout());
  runs = [{ run_id: 'run-1', status: 'failed', stage: '', created_at: new Date(clock - 3600_000).toISOString() }];
  clock += 1000;
  assert.equal(noteOf(await runCredit()), 'run_started');
  assert.equal(store.creditBalance('buyer@example.com', clock).full_report, 0);
  await get('/account/reports');
  assert.equal(store.creditBalance('buyer@example.com', clock).full_report, 0, 'the old failed run is not this credit\'s');
  runs[0].created_at = new Date(clock).toISOString();
  runs[0].status = 'failed';
  const page = await (await get('/account/reports')).text();
  assert.equal(store.creditBalance('buyer@example.com', clock).full_report, 1, 'credit given back');
  assert.match(page, /Run failed, given back/);
  assert.match(page, /Reports run with a credit/);
  await get('/account/reports');
  assert.equal(store.creditBalance('buyer@example.com', clock).full_report, 1, 'given back once only');
});
