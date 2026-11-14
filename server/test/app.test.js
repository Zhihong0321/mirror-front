// End-to-end tests of the order flow with a fake Stripe API and a fake hub. Nothing leaves the machine.
// Webhook signatures are made and checked by the real Stripe library.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { createApp } from '../app.js';
import { createHub } from '../hub.js';
import { openStore } from '../store.js';
import { createMailer } from '../mailer.js';
import { createReportDb } from '../reportdb.js';

const SECRET = 'whsec_test_secret';
const DIVE = 'AbCdEfGhIjKlMnOpQrSt'; // 20-char public id
const HUB = 'https://hub.test';
const realStripe = new Stripe('sk_test_fake');

let companies, hubCalls, sessions, server, origin;
let store, mailjet, mailjetFails, clock, cookie;

function fakeHubFetch(url, init = {}) {
  const p = new URL(url).pathname;
  hubCalls.push(`${init.method} ${p}`);
  assert.equal(init.headers.authorization, 'Bearer hub-token');
  const reply = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (init.method === 'GET' && p === '/api/dive-deeper/pipeline') return reply(200, { companies: structuredClone(companies) });
  if (init.method === 'POST' && p === '/api/dive-deeper') {
    const row = companies.find((c) => c.dive_id === JSON.parse(init.body).dive_id);
    row.report = { run_id: 7, status: 'queued', report_url: `${HUB}/dd/run7` };
    return reply(202, { id: 7, status: 'queued', report_url: `${HUB}/dd/run7` });
  }
  const retry = /^\/api\/dive-deeper\/(\d+)\/retry$/.exec(p);
  if (init.method === 'POST' && retry) {
    companies[0].report.status = 'queued';
    return reply(202, { id: Number(retry[1]), status: 'queued', dive_id: 42 });
  }
  return reply(404, { error: 'not found' });
}

// A fake Mailjet: records every message sent and can be told to fail.
function fakeMailjetFetch(url, init) {
  assert.equal(url, 'https://api.mailjet.com/v3.1/send');
  assert.equal(init.headers.authorization, `Basic ${Buffer.from('mj-key:mj-secret').toString('base64')}`);
  if (mailjetFails) return Promise.resolve(new Response(JSON.stringify({ Messages: [{ Status: 'error', Errors: [{ ErrorMessage: 'sender not validated' }] }] }), { status: 400 }));
  const m = JSON.parse(init.body).Messages[0];
  mailjet.push(m);
  return Promise.resolve(new Response(JSON.stringify({ Messages: [{ Status: 'success', To: [{ Email: m.To[0].Email, MessageID: 1000 + mailjet.length }] }] }), { status: 200 }));
}

const fakeStripe = {
  webhooks: realStripe.webhooks,
  checkout: {
    sessions: {
      async create(params) {
        const s = { id: `cs_test_${sessions.size + 1}`, url: `https://checkout.stripe.test/${sessions.size + 1}`, payment_status: 'unpaid', ...params };
        sessions.set(s.id, s);
        return s;
      },
      async retrieve(id) {
        if (!sessions.has(id)) throw new Error('No such checkout session');
        return sessions.get(id);
      },
    },
  },
};

function stop() {
  server?.closeAllConnections();
  server?.close();
}

let app;
async function start({ reportDb, previewAdminToken = 'admin-token', factory, autoStart = false } = {}) {
  stop();
  const hub = createHub({ url: HUB, token: 'hub-token', fetchImpl: fakeHubFetch, log: () => {} });
  const config = { stripeKey: 'sk_test_fake', webhookSecret: SECRET, priceCents: 8900, currency: 'usd',
    siteDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site'),
    seller: { name: 'MirrorMirror Test Seller', address: '1 Test Street', note: '' },
    previewAlertEmail: 'team@example.com', previewAdminToken, officeKey: 'office-key-test', previewAutoStart: autoStart, previewIndustry: 'General business' };
  store?.close();
  store = openStore(':memory:');
  const mailer = createMailer({ apiKey: 'mj-key', secretKey: 'mj-secret', from: 'admin@mirrormirror.cloud', store, now: () => clock, fetchImpl: fakeMailjetFetch, log: () => {} });
  app = createApp({ stripe: fakeStripe, hub, config, store, mailer, reportDb, factory, now: () => clock, log: () => {} });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(async () => {
  companies = [{ dive_id: 42, company: 'Eternalgy Sdn Bhd', dive_status: 'done', preview_url: `${HUB}/dp/${DIVE}`, report: null }];
  hubCalls = [];
  sessions = new Map();
  mailjet = [];
  mailjetFails = false;
  clock = Date.parse('2026-11-11T10:00:00Z');
  cookie = '';
  await start();
});

after(stop);

const withCookie = (h = {}) => (cookie ? { ...h, cookie } : h);
const get = (p) => fetch(origin + p, { redirect: 'manual', headers: withCookie() });
const post = (p, body, headers = {}) => fetch(origin + p, { method: 'POST', body, headers: withCookie(headers), redirect: 'manual' });
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const sentTo = (email, kind) => mailjet.filter((m) => m.To[0].Email === email && (!kind || m.CustomID === kind));
const tokenIn = (m) => /login\/verify\?token=([\w-]+)/.exec(m.TextPart)[1];

// Enters the office with its key (OFFICE_KEY). Adds the office cookie to `cookie`, keeping any sign-in.
async function officeIn(key = 'office-key-test') {
  const res = await post('/myoffice/login', `key=${encodeURIComponent(key)}&next=%2Fmyoffice%2Fpreviews`, FORM);
  if (res.status === 303) cookie = [cookie, res.headers.get('set-cookie').split(';')[0]].filter(Boolean).join('; ');
  return res;
}

// Asks for a sign-in link, opens it, presses Continue. Leaves the session cookie on `cookie`.
async function signIn(email = 'buyer@example.com', next = '') {
  const res = await post('/login', `email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`, FORM);
  assert.equal(res.status, 200);
  const token = tokenIn(sentTo(email, 'magic-link').at(-1));
  const done = await post('/login/verify', `token=${token}`, FORM);
  assert.equal(done.status, 303);
  cookie = done.headers.get('set-cookie').split(';')[0];
  return done;
}

async function payAndNotify(sessionId, type = 'checkout.session.completed') {
  const s = sessions.get(sessionId);
  s.payment_status = 'paid';
  const payload = JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object: s } });
  const sig = realStripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return post('/stripe/webhook', payload, { 'stripe-signature': sig, 'content-type': 'application/json' });
}

async function checkout() {
  if (!cookie) await signIn();
  const res = await post('/order/checkout', `dive=${DIVE}`, FORM);
  assert.equal(res.status, 303);
  return [...sessions.keys()].at(-1);
}

const starts = () => hubCalls.filter((c) => c.startsWith('POST'));

test('order page without a company asks for the preview link', async () => {
  const res = await get('/order');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Paste the link to the free preview/);
});

test('order page from a preview link shows the company and the price', async () => {
  const res = await get(`/order?preview=${encodeURIComponent(`${HUB}/dp/${DIVE}`)}`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /Full report on Eternalgy Sdn Bhd/);
  assert.match(body, /USD 89/);
  assert.match(body, /Test mode/);
});

test('unknown company and unfinished research are refused', async () => {
  assert.equal((await get('/order?dive=ZZZZZZZZZZZZZZZZZZZZ')).status, 404);
  companies[0].dive_status = 'running';
  assert.match(await (await get(`/order?dive=${DIVE}`)).text(), /not finished/);
  await signIn();
  const res = await post('/order/checkout', `dive=${DIVE}`, FORM);
  assert.equal(res.status, 409);
  assert.equal(sessions.size, 0);
});

test('checkout sends the buyer to Stripe with the dive and the account email in the metadata', async () => {
  await signIn('buyer@example.com');
  const res = await post('/order/checkout', `dive=${DIVE}`, FORM);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://checkout.stripe.test/1');
  const s = sessions.get('cs_test_1');
  assert.equal(s.mode, 'payment');
  assert.equal(s.line_items[0].price_data.unit_amount, 8900);
  assert.equal(s.line_items[0].price_data.currency, 'usd');
  assert.deepEqual(s.metadata, { dive_id: '42', dive_public_id: DIVE, company: 'Eternalgy Sdn Bhd', account_email: 'buyer@example.com' });
  assert.equal(s.customer_email, 'buyer@example.com');
  assert.match(s.success_url, /\/order\/done\?session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.equal(starts().length, 0, 'nothing starts before payment');
});

test('a webhook with a bad signature is rejected and starts nothing', async () => {
  const id = await checkout();
  sessions.get(id).payment_status = 'paid';
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: sessions.get(id) } });
  const res = await post('/stripe/webhook', payload, { 'stripe-signature': 't=1,v1=forged' });
  assert.equal(res.status, 400);
  assert.equal(starts().length, 0);
});

test('a paid webhook starts the full report once, however often it and the done page arrive', async () => {
  const id = await checkout();
  const [a, b, c] = await Promise.all([payAndNotify(id), payAndNotify(id), get(`/order/done?session_id=${id}`)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(starts(), ['POST /api/dive-deeper']);
  const body = await c.text();
  assert.match(body, /Your report on Eternalgy Sdn Bhd is on its way/);
  assert.match(body, /href="https:\/\/hub.test\/dd\/run7"/);
});

test('an unpaid session starts nothing and the done page waits', async () => {
  const id = await checkout();
  const res = await get(`/order/done?session_id=${id}`);
  assert.match(await res.text(), /still processing/);
  assert.equal(starts().length, 0);
});

test('a report that already exists is reused, a failed one is retried', async () => {
  companies[0].report = { run_id: 3, status: 'done', report_url: `${HUB}/dd/run3` };
  let id = await checkout();
  await payAndNotify(id);
  assert.equal(starts().length, 0);
  assert.match(await (await get(`/order/done?session_id=${id}`)).text(), /dd\/run3/);

  companies[0].report.status = 'failed';
  id = await checkout();
  await payAndNotify(id, 'checkout.session.async_payment_succeeded');
  assert.deepEqual(starts(), ['POST /api/dive-deeper/3/retry']);
});

test('the home page: signed out it is as it was; signed in, the nav button and the footer lead to My account', async () => {
  await start();
  const out = await (await get('/')).text();
  assert.match(out, /<a class="btn" href="#ask">Get my free preview<\/a>/);
  assert.doesNotMatch(out, /My account/);

  await signIn();
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /private/, 'a page made for one person is not cached for others');
  const inn = await res.text();
  assert.match(inn, /<header class="nav">[^]*<a class="btn" href="\/account">My account<\/a>\s*<\/header>/);
  assert.doesNotMatch(inn, /<a class="btn" href="#ask">Get my free preview<\/a>/, 'the nav button became My account');
  assert.match(inn, /<footer>[^]*<a href="\/account">My account<\/a>[^]*<\/footer>/);
  assert.match(inn, /id="ask"/, 'the free preview form is still on the page');
});

test('the site is served and paths cannot leave it', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /MirrorMirror/);
  assert.equal((await get('/..%2fserver%2fapp.js')).status, 404);
  assert.equal((await get('/%2e%2e/AGENTS.md')).status, 404);
});

// ---- Email: sign in by link, invoices ----

test('sign in: the link is emailed through Mailjet, the confirm page does not use it up, pressing Continue signs in', async () => {
  const res = await post('/login', 'email=Buyer%40Example.com&next=%2Forder%3Fdive%3D' + DIVE, FORM);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Check your email/);
  const [m] = sentTo('buyer@example.com', 'magic-link');
  assert.equal(m.From.Email, 'admin@mirrormirror.cloud');
  assert.match(m.Subject, /sign-in link/);
  assert.match(m.TextPart, /keeps working until you ask for a newer link/);
  assert.doesNotMatch(m.TextPart, /expires|minutes/);
  assert.match(m.HTMLPart, /Sign in/);
  const token = tokenIn(m);
  assert.ok(m.TextPart.includes(`${origin}/login/verify?token=${token}`));

  // A mail scanner opening the link twice must not use it up.
  for (let i = 0; i < 2; i++) assert.match(await (await get(`/login/verify?token=${token}`)).text(), /Sign in as buyer@example.com/);

  const ok = await post('/login/verify', `token=${token}`, FORM);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), `/order?dive=${DIVE}`);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /^mm_session=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  cookie = setCookie.split(';')[0];
  assert.match(await (await get('/account')).text(), /Signed in as <b>buyer@example.com<\/b>/);

  // Owner's rule: no use count. The same link works again (another device, a second click) until a newer one is asked for.
  cookie = '';
  assert.equal((await get(`/login/verify?token=${token}`)).status, 200);
  assert.equal((await post('/login/verify', `token=${token}`, FORM)).status, 303);
});

test('a new sign-in link the visitor asks for replaces the previous one', async () => {
  await post('/login', 'email=buyer@example.com', FORM);
  clock += 31_000;
  await post('/login', 'email=buyer@example.com', FORM);
  const [first, second] = sentTo('buyer@example.com', 'magic-link').map(tokenIn);
  assert.notEqual(first, second);
  const dead = await get(`/login/verify?token=${first}`);
  assert.equal(dead.status, 410, 'the older link is dead');
  const body = await dead.text();
  assert.match(body, /replaced this one/);
  assert.match(body, /Email a new link to buyer@example.com/, 'one press asks for a new link');
  assert.equal((await post('/login/verify', `token=${first}`, FORM)).status, 410);
  assert.equal((await post('/login/verify', `token=${second}`, FORM)).status, 303, 'the newest link works');
});

test('a link has no clock: it still works a year later', async () => {
  await post('/login', 'email=buyer@example.com', FORM);
  const token = tokenIn(sentTo('buyer@example.com')[0]);
  clock += 366 * 86_400_000;
  assert.equal((await get(`/login/verify?token=${token}`)).status, 200);
  assert.equal((await post('/login/verify', `token=${token}`, FORM)).status, 303);
});

test('a dead link opened while already signed in as its owner just goes on', async () => {
  await post('/login', 'email=buyer@example.com', FORM);
  clock += 31_000;
  await post('/login', 'email=buyer@example.com', FORM);
  const [first, second] = sentTo('buyer@example.com', 'magic-link').map(tokenIn);
  assert.equal((await get(`/login/verify?token=${first}`)).status, 410, 'signed out: the dead link says so');
  const signed = await post('/login/verify', `token=${second}`, FORM);
  assert.equal(signed.status, 303);
  cookie = signed.headers.get('set-cookie').split(';')[0];
  const again = await get(`/login/verify?token=${first}`);
  assert.equal(again.status, 303, 'signed in as its owner: carries on instead of showing an error');
});

test('asking again within 30 seconds is told to wait, a bad address is told so, and neither sends mail', async () => {
  await post('/login', 'email=buyer@example.com', FORM);
  const again = await post('/login', 'email=buyer@example.com', FORM);
  assert.equal(again.status, 429);
  assert.match(await again.text(), /ask for a new one in 30 seconds/);
  const bad = await post('/login', 'email=not-an-email', FORM);
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /valid email/);
  assert.equal(mailjet.length, 1);
});

test('when Mailjet refuses, the visitor is told, the failure is on record, and they can retry at once', async () => {
  mailjetFails = true;
  const res = await post('/login', 'email=buyer@example.com', FORM);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /could not send the email/);
  const [row] = store.recentMail();
  assert.equal(row.status, 'failed');
  assert.equal(row.kind, 'magic-link');
  assert.match(row.error, /sender not validated/);
  mailjetFails = false;
  assert.equal((await post('/login', 'email=buyer@example.com', FORM)).status, 200, 'no 30 second wait after a failed send');
  assert.equal(sentTo('buyer@example.com').length, 1);
});

test('sign-in only ever sends people to a page on this site', async () => {
  for (const next of ['https://evil.example/x', '//evil.example/x', '/\\evil.example']) {
    cookie = '';
    clock += 31_000;
    const done = await signIn('buyer@example.com', next);
    assert.equal(done.headers.get('location'), '/account', next);
  }
});

test('paying needs an account: the order page asks for an email, checkout without one goes to sign in', async () => {
  const page = await (await get(`/order?dive=${DIVE}`)).text();
  assert.match(page, /Enter your email to pay/);
  assert.doesNotMatch(page, /action="\/order\/checkout"/);
  const res = await post('/order/checkout', `dive=${DIVE}`, FORM);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `/login?next=${encodeURIComponent(`/order?dive=${DIVE}`)}`);
  assert.equal(sessions.size, 0);
  await signIn();
  assert.match(await (await get(`/order?dive=${DIVE}`)).text(), /action="\/order\/checkout"/);
});

test('a paid order is recorded and its invoice is emailed once, however often Stripe and the buyer notify us', async () => {
  const id = await checkout();
  await Promise.all([payAndNotify(id), payAndNotify(id), get(`/order/done?session_id=${id}`)]);
  await payAndNotify(id);
  const invoices = sentTo('buyer@example.com', 'invoice');
  assert.equal(invoices.length, 1);
  const [m] = invoices;
  assert.equal(m.Subject, 'Invoice MM-2026-0001: your MirrorMirror report');
  assert.match(m.TextPart, /Total paid: USD 89.00/);
  assert.match(m.TextPart, /Billed to: buyer@example\.com/);
  assert.match(m.TextPart, /MirrorMirror full report bundle \(2 full reports \+ 1 Social Media Ads report\): Eternalgy Sdn Bhd/);
  assert.match(m.TextPart, /https:\/\/hub\.test\/dd\/run7/);
  assert.match(m.TextPart, /1 Test Street/);
  assert.match(m.HTMLPart, /Open your report/);

  const done = await (await get(`/order/done?session_id=${id}`)).text();
  assert.match(done, /Your invoice and this link were emailed to <b>buyer@example.com<\/b>/);
  const account = await (await get('/account/reports')).text();
  assert.match(account, /Eternalgy Sdn Bhd/);
  assert.match(account, /MM-2026-0001/);
  assert.match(await (await get('/account/invoices/1')).text(), /Invoice MM-2026-0001/);
});

test('a paid order records prepaid report credits once: the first full report is used at payment, the rest wait', async () => {
  const id = await checkout();
  await Promise.all([payAndNotify(id), payAndNotify(id)]);
  await payAndNotify(id);
  const credits = store.creditsFor('buyer@example.com');
  assert.equal(credits.length, 3, 'one row per item, however often Stripe notifies us');
  assert.deepEqual(store.creditBalance('buyer@example.com'), { full_report: 1, 'ads research': 1 });
  assert.equal(credits.filter((c) => c.status === 'used').length, 1);
  const overview = await (await get('/account')).text();
  assert.match(overview, /1 full report/);
  assert.match(overview, /1 Social Media Ads Research/);
  const spent = store.spendCredit('buyer@example.com', 'full_report', 'run-2', clock);
  assert.equal(spent.status, 'used');
  assert.deepEqual(store.creditBalance('buyer@example.com'), { full_report: 0, 'ads research': 1 });
  assert.equal(store.spendCredit('buyer@example.com', 'full_report', 'run-3', clock), null, 'none left: reported, never thrown');
  // a credit can also be assigned by hand with any tag, and is spent only on its own tag
  const gift = store.assignCredit('buyer@example.com', 'full_report', 'gift', clock);
  assert.equal(gift.kind, 'full_report');
  assert.deepEqual(store.creditBalance('buyer@example.com'), { full_report: 1, 'ads research': 1 });
  assert.equal(store.spendCredit('buyer@example.com', 'ads research', 'ads-1', clock).kind, 'ads research');
  assert.equal(store.spendCredit('buyer@example.com', 'ads research', 'ads-2', clock), null);
});

test('an invoice can only be opened by the account it was issued to', async () => {
  await payAndNotify(await checkout());
  cookie = '';
  clock += 31_000;
  assert.equal((await get('/account/invoices/1')).status, 303, 'signed out: sent to sign in');
  assert.equal((await get('/account')).status, 303);
  await signIn('someone-else@example.com');
  assert.equal((await get('/account/invoices/1')).status, 404);
  assert.equal((await post('/account/invoices/1/resend', '', FORM)).status, 404);
  assert.doesNotMatch(await (await get('/account/reports')).text(), /Eternalgy/);
  assert.doesNotMatch(await (await get('/account')).text(), /Eternalgy/);
});

test('if the invoice email fails, the report still starts, the buyer is told, and a later notice sends it', async () => {
  const id = await checkout();
  mailjetFails = true;
  assert.equal((await payAndNotify(id)).status, 200, 'the webhook still succeeds');
  assert.deepEqual(starts(), ['POST /api/dive-deeper'], 'the report was started anyway');
  const done = await (await get(`/order/done?session_id=${id}`)).text();
  assert.match(done, /We could not email your invoice/);
  assert.match(done, /dd\/run7/, 'the report link is still shown');
  assert.equal(store.recentMail().filter((r) => r.kind === 'invoice' && r.status === 'failed').length, 2);
  assert.equal(store.ordersFor('buyer@example.com')[0].invoice_emailed_at, null);

  mailjetFails = false;
  await payAndNotify(id);
  assert.equal(sentTo('buyer@example.com', 'invoice').length, 1);
  assert.notEqual(store.ordersFor('buyer@example.com')[0].invoice_emailed_at, null);
});

test('the account page can send an invoice again', async () => {
  await payAndNotify(await checkout());
  const res = await post('/account/invoices/1/resend', '', FORM);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/account/reports?mail=sent');
  assert.equal(sentTo('buyer@example.com', 'invoice').length, 2);
  assert.match(await (await get('/account/reports?mail=sent')).text(), /Invoice sent/);
});

test('signing out ends the session', async () => {
  await signIn();
  const res = await post('/logout', '', FORM);
  assert.equal(res.status, 303);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await get('/account')).status, 303);
});

test('mailer: never throws, and records sent, failed, unconfigured and dry-run emails', async () => {
  const mk = (o) => createMailer({ store, now: () => clock, log: () => {}, ...o });
  const msg = { to: 'a@example.com', kind: 'test', subject: 'S', text: 't', html: '<p>t</p>' };
  assert.deepEqual(await mk({ apiKey: 'k', secretKey: 's', from: 'f@x.co', fetchImpl: () => Promise.reject(new Error('network down')) }).send(msg), { ok: false, status: 'failed', error: 'network down' });
  assert.equal((await mk({ from: 'f@x.co' }).send(msg)).ok, false);
  assert.equal((await mk({ apiKey: 'k', secretKey: 's', from: 'f@x.co', fetchImpl: () => Promise.resolve(new Response('<html>502</html>', { status: 502 })) }).send(msg)).ok, false);
  assert.equal((await mk({ dryRun: true }).send(msg)).status, 'dry-run');
  assert.equal((await mk({ dryRun: true }).send({ ...msg, to: '' })).ok, false, 'no recipient is a recorded failure, not a crash');
  assert.deepEqual(store.recentMail().reverse().map((r) => r.status), ['failed', 'failed', 'failed', 'dry-run', 'failed']);
});

// ---- Dashboard: free previews and bought reports ----

const REPORT = '0f8fad5b-d9cb-469f-a165-70867728950e';
const REPORT_2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const postForm = (p, fields) => post(p, new URLSearchParams(fields).toString(), FORM);

test('the dashboard asks a signed-out visitor to sign in and brings them back with the company filled in', async () => {
  const res = await get('/account/previews?company=Acme%20Sdn%20Bhd&who=rival');
  assert.equal(res.status, 303);
  const next = new URL(res.headers.get('location'), origin).searchParams.get('next');
  assert.equal(next, '/account/previews?company=Acme%20Sdn%20Bhd&who=rival');
  const back = await signIn('buyer@example.com', next);
  assert.equal(back.headers.get('location'), next);
  const page = await (await get(next)).text();
  assert.match(page, /value="Acme Sdn Bhd"/);
  assert.match(page, /value="rival" checked/);
  // links from before the split still arrive
  const old = await get('/account?company=Acme%20Sdn%20Bhd&who=rival');
  assert.equal(old.headers.get('location'), '/account/previews?company=Acme%20Sdn%20Bhd&who=rival');
});

test('a new account: the overview asks for a preview straight away, and each job still has its own page with the navigation on all of them', async () => {
  await signIn();
  const page = await (await get('/account')).text();
  assert.match(page, /<h1>Overview<\/h1>/);
  assert.match(page, /Signed in as <b>buyer@example.com<\/b>/);
  assert.match(page, /Start with a free preview/);
  // the overview's own request form: company name, who it is for, and the country chips (the landing page's two questions)
  assert.match(page, /<form method="post" action="\/account\/previews">/);
  assert.match(page, /name="back" value="overview"/);
  assert.match(page, /<input id="ask-company" name="company"/);
  assert.match(page, /Which country is the company in\?/);
  assert.match(page, /name="country" value="Malaysia" checked/);
  assert.match(page, /name="country" value="South Korea"/);
  assert.match(page, /name="country_other"/);
  assert.match(page, /name="who" value="rival"/);
  const prev = await (await get('/account/previews')).text();
  assert.match(prev, /<h1>Free previews<\/h1>/);
  assert.match(prev, /action="\/account\/previews"/);
  assert.match(prev, /No previews yet/);
  const rep = await (await get('/account/reports')).text();
  assert.match(rep, /<h1>Full reports<\/h1>/);
  assert.match(rep, /Nothing bought yet/);
  for (const p of [page, prev, rep, await (await get('/account/referrals')).text(), await (await get('/account/referrals/earnings')).text(), await (await get('/account/referrals/wallet')).text()]) {
    for (const href of ['/account', '/account/previews', '/account/reports', '/account/referrals', '/account/referrals/earnings', '/account/referrals/wallet']) {
      assert.ok(p.includes(`<a class="nv" href="${href}"`), `navigation link ${href}`);
    }
    assert.match(p, /action="\/logout"/);
    assert.equal((p.match(/class="nv" href="[^"]*" aria-current="page"/g) ?? []).length, 1, 'exactly one section is marked as the current one');
  }
});

test('asking for a free preview from the overview comes back to the overview with the news, and the request is listed there', async () => {
  await signIn();
  const res = await postForm('/account/previews', { back: 'overview', who: 'mine', company: 'Acme Sdn Bhd', country: 'Singapore' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/account?n=requested');
  assert.equal(store.previewsFor('buyer@example.com')[0].country, 'Singapore');
  const page = await (await get('/account?n=requested')).text();
  assert.match(page, /Request received/);
  assert.match(page, /Acme Sdn Bhd/);
  // a mistake comes back to the same page, told in the same place
  assert.equal((await postForm('/account/previews', { back: 'overview', company: '  ' })).headers.get('location'), '/account?n=company');
  assert.match(await (await get('/account?n=company')).text(), /Enter the company name/);
  // and the previews page still answers where it used to
  assert.equal((await postForm('/account/previews', { company: 'Other Co' })).headers.get('location'), '/account/previews?n=requested');
});

test('asking for a free preview saves it, emails the buyer, tells the team, and lists it as being prepared', async () => {
  await signIn();
  const res = await postForm('/account/previews', { who: 'rival', company: '  Acme   Sdn Bhd ', country: 'Malaysia', website: 'acme.com.my' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/account/previews?n=requested');

  const [toBuyer] = sentTo('buyer@example.com', 'preview-requested');
  assert.match(toBuyer.Subject, /preparing your free preview of Acme Sdn Bhd/);
  const [toTeam] = sentTo('team@example.com', 'preview-alert');
  assert.match(toTeam.TextPart, /Company: Acme Sdn Bhd/);
  assert.match(toTeam.TextPart, /For: a competitor/);
  assert.match(toTeam.TextPart, /Website: acme\.com\.my/);
  assert.match(toTeam.TextPart, /POST .*\/api\/previews\/1\/ready/);

  const page = await (await get('/account/previews?n=requested')).text();
  assert.match(page, /Request received/);
  assert.match(page, /Acme Sdn Bhd/);
  assert.match(page, /badge wait">In line</);
  assert.match(page, /Request received/);
  assert.match(page, /Waiting to start/);
  assert.match(page, /You are next in line/);
  assert.doesNotMatch(page, /No previews yet/);
});

test('asking twice for the same open company does not send or save a second one; blank names are told so', async () => {
  await signIn();
  await postForm('/account/previews', { company: 'Acme Sdn Bhd' });
  const again = await postForm('/account/previews', { company: 'ACME sdn bhd' });
  assert.equal(again.headers.get('location'), '/account/previews?n=duplicate');
  assert.equal(store.previewsFor('buyer@example.com').length, 1);
  assert.equal(sentTo('team@example.com', 'preview-alert').length, 1);
  assert.equal((await postForm('/account/previews', { company: '   ' })).headers.get('location'), '/account/previews?n=company');
});

test('one account can have 10 previews waiting, and is told when it asks for an eleventh', async () => {
  await signIn();
  for (let i = 1; i <= 10; i++) await postForm('/account/previews', { company: `Company ${i}` });
  const res = await postForm('/account/previews', { company: 'Company 11' });
  assert.equal(res.headers.get('location'), '/account/previews?n=limit');
  assert.equal(store.previewsFor('buyer@example.com').length, 10);
  assert.match(await (await get('/account/previews?n=limit')).text(), /10 previews being prepared/);
});

test('a preview request is saved even when the emails cannot be sent', async () => {
  await signIn();
  mailjetFails = true;
  const res = await postForm('/account/previews', { company: 'Acme Sdn Bhd' });
  assert.equal(res.headers.get('location'), '/account/previews?n=requested');
  assert.equal(store.previewsFor('buyer@example.com').length, 1);
  assert.equal(store.recentMail().filter((m) => m.status === 'failed').length, 2);
});

test('the report factory marks a preview ready: the buyer is emailed the link and the dashboard opens it', async () => {
  await signIn();
  await postForm('/account/previews', { company: 'Acme Sdn Bhd' });
  const ready = (headers, body) => fetch(`${origin}/api/previews/1/ready`, { method: 'POST', headers, body: JSON.stringify(body) });

  assert.equal((await ready({}, { report_id: REPORT })).status, 401, 'no token');
  assert.equal((await ready({ authorization: 'Bearer wrong' }, { report_id: REPORT })).status, 401, 'wrong token');
  const auth = { authorization: 'Bearer admin-token' };
  assert.equal((await ready(auth, { report_id: 'not-a-uuid' })).status, 400);
  assert.equal((await fetch(`${origin}/api/previews/99/ready`, { method: 'POST', headers: auth, body: JSON.stringify({ report_id: REPORT }) })).status, 404);
  assert.equal(store.previewById(1).status, 'requested', 'nothing changed by the refused calls');

  const ok = await ready(auth, { report_id: REPORT.toUpperCase() });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, id: 1, status: 'ready', report_id: REPORT, emailed: true });
  const [m] = sentTo('buyer@example.com', 'preview-ready');
  assert.match(m.TextPart, new RegExp(`${origin.replace(/[.]/g, '\\.')}/p/${REPORT}`));

  const again = await (await ready(auth, { report_id: REPORT })).json();
  assert.equal(again.emailed, true);
  assert.equal(sentTo('buyer@example.com', 'preview-ready').length, 1, 'the buyer is emailed once');

  const page = await (await get('/account/previews')).text();
  assert.match(page, /<span class="badge ok">Ready<\/span><a class="btn sm" href="\/p\/0f8fad5b/);
});

test('"already have a preview link" sends people to the right page', async () => {
  const to = async (link) => (await get(`/account/open?link=${encodeURIComponent(link)}`)).headers.get('location');
  assert.equal(await to(`https://mirrormirror.cloud/p/${REPORT.toUpperCase()}`), `/p/${REPORT}`);
  assert.equal(await to(REPORT), `/p/${REPORT}`);
  assert.equal(await to(`${HUB}/dp/${DIVE}`), `/order?dive=${DIVE}`);
  assert.equal(await to('https://example.com/nothing'), '/account/previews?n=bad_link');
});

test('bought reports show where they stand, and a status that cannot be read never hides the report', async () => {
  const runs = { [REPORT]: [{ run_id: 'r1', status: 'done', has_html: true }], [REPORT_2]: [{ run_id: 'r2', status: 'running', has_html: false }] };
  await start({ reportDb: createReportDb({ query: async (sql, params) => {
    if (params[0] === 'ffffffff-ffff-4fff-8fff-ffffffffffff') throw new Error('database down');
    if (params[0] === 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') return { rows: [{ run_id: 'r3', status: 'failed', has_html: false }] };
    return { rows: runs[params[0]] ?? [] };
  } }) });
  const buy = (n, reportId) => store.recordOrder({ stripeSessionId: `cs_${n}`, email: 'buyer@example.com', company: `Company ${n}`, amountCents: 8900, currency: 'usd', paidAt: clock + n, reportId });
  buy(1, REPORT); buy(2, REPORT_2); buy(3, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'); buy(4, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
  store.recordOrder({ stripeSessionId: 'cs_5', email: 'buyer@example.com', company: 'Hub Company', amountCents: 8900, currency: 'usd', paidAt: clock + 5, reportUrl: 'https://hub.test/dd/run9' });
  await signIn();
  const page = await (await get('/account/reports')).text();
  const row = (company) => page.split('<div class="row">').find((r) => r.includes(company));
  assert.match(row('Company 1'), /badge ok">Ready</);
  assert.match(row('Company 1'), new RegExp(`href="/r/${REPORT}">Open report`));
  assert.match(row('Company 2'), /badge wait">Being written</);
  assert.match(row('Company 2'), /Report started <small>[^<]*run r2/, 'it says a run exists and which one');
  assert.match(row('Company 3'), /badge bad">Hit a problem</);
  assert.match(row('Company 4'), /badge bad">Status unavailable</, 'database down: it says so');
  assert.match(row('Company 4'), /database down/, 'and says why');
  assert.match(row('Company 4'), /href="\/r\/ffffffff-ffff-4fff-8fff-ffffffffffff">Open report/, 'but the report is still one click away');
  assert.match(row('Hub Company'), /href="https:\/\/hub\.test\/dd\/run9">Open report/);
  assert.match(row('Company 1'), /Invoice/);
});

test('a free preview shows its step once the factory has started the company, and still shows its place in line when the factory cannot be read', async () => {
  const made = new Date(clock + 60_000).toISOString();
  await start({ reportDb: createReportDb({ query: async () => ({ rows: [
    { company: 'ACME SDN. BHD.', website: 'https://www.acme.com.my/', created_at: made, updated_at: made, step1_status: 'done', step1_5_status: 'done', step2_status: 'running', step3_status: 'none' },
  ] }) }) });
  await signIn();
  await postForm('/account/previews', { company: 'Acme Sdn Bhd', website: 'acme.com.my' });
  clock += 5 * 60_000;
  let page = await (await get('/account/previews')).text();
  assert.match(page, /badge wait">Working on it</);
  assert.match(page, /Analysing what we found <small>working on it now/);
  assert.match(page, /Writing your preview/);
  await stop();
  await start({ reportDb: createReportDb({ query: async () => { throw new Error('database down'); } }) });
  await signIn();
  await postForm('/account/previews', { company: 'Acme Sdn Bhd', website: 'acme.com.my' });
  page = await (await get('/account/previews')).text();
  assert.match(page, /badge wait">In line</, 'factory unreadable: still shows the row with its place in line');
  assert.match(page, /Acme Sdn Bhd/);
});

test('auto start: a new request starts on the factory, the report id is kept on it, and the status uses that exact id', async () => {
  const calls = [];
  const factory = { startReport: async () => ({}), startPreview: async (x) => { calls.push(x); return { reportId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }; } };
  const made = new Date(clock + 1000).toISOString();
  await start({ autoStart: true, factory, reportDb: createReportDb({ query: async () => ({ rows: [
    { report_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company: 'A totally different name', website: '', created_at: made, updated_at: made, step1_status: 'done', step1_5_status: 'done', step2_status: 'done', step3_status: 'running' },
  ] }) }) });
  await signIn();
  await postForm('/account/previews', { company: 'Acme Sdn Bhd', country: 'Malaysia', website: 'acme.com.my' });
  assert.deepEqual(calls, [{ company: 'Acme Sdn Bhd', country: 'Malaysia', industry: 'General business', website: 'acme.com.my' }]);
  const [r] = store.previewsFor('buyer@example.com');
  assert.equal(r.factory_report_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(r.status, 'requested', 'still waits for the team to mark it ready');
  assert.equal((await app.sweepPreviews()), 0, 'an already started request is not started twice');
  const page = await (await get('/account/previews')).text();
  assert.match(page, /badge wait">Working on it</, 'matched by id although the name differs');
  assert.match(page, /Writing your preview <small>working on it now/);
});

test('auto start: when the factory has written the preview, the request becomes ready by itself and the buyer is emailed once', async () => {
  const RID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  let s3 = 'running';
  const factory = { startReport: async () => ({}), startPreview: async () => ({ reportId: RID }) };
  await start({ autoStart: true, factory, reportDb: createReportDb({ query: async () => ({ rows: [
    { report_id: RID, company: 'Acme', website: '', created_at: new Date(clock + 1000).toISOString(), updated_at: null, step1_status: 'done', step1_5_status: 'done', step2_status: 'done', step3_status: s3 },
  ] }) }) });
  await signIn();
  await postForm('/account/previews', { company: 'Acme Sdn Bhd', country: 'Malaysia' });
  let page = await (await get('/account/previews')).text();
  assert.match(page, /badge wait">Working on it</);
  assert.equal(sentTo('buyer@example.com', 'preview-ready').length, 0);
  s3 = 'done';
  page = await (await get('/account/previews')).text();
  assert.match(page, /badge ok">Ready</);
  assert.match(page, new RegExp(`href="/p/${RID}">Open preview`));
  assert.equal(store.previewsFor('buyer@example.com')[0].status, 'ready');
  assert.equal(sentTo('buyer@example.com', 'preview-ready').length, 1);
  await get('/account/previews'); await app.sweepPreviews();
  assert.equal(sentTo('buyer@example.com', 'preview-ready').length, 1, 'emailed once, not on every visit');
});

test('auto start: a failed start is recorded and shown, the request stays, and the sweeper retries it', async () => {
  let fail = true; const calls = [];
  const factory = { startReport: async () => ({}), startPreview: async () => { calls.push(1); if (fail) throw new Error('factory POST /api/v21/step1 -> 401: bad or missing token'); return { reportId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }; } };
  await start({ autoStart: true, factory });
  await signIn();
  await postForm('/account/previews', { company: 'Acme Sdn Bhd', country: 'Malaysia' });
  let [r] = store.previewsFor('buyer@example.com');
  assert.equal(r.factory_report_id, null);
  assert.match(r.factory_error, /401/);
  assert.equal(sentTo('team@example.com', 'preview-alert').length, 1, 'the team is still told');
  let page = await (await get('/account/previews')).text();
  assert.match(page, /Acme Sdn Bhd/);
  assert.match(page, /Starting it automatically did not work/);
  fail = false;
  assert.equal(await app.sweepPreviews(), 1);
  [r] = store.previewsFor('buyer@example.com');
  assert.equal(r.factory_report_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(r.factory_error, null);
  fail = true; calls.length = 0;
  await postForm('/account/previews', { company: 'Other Co', country: 'Malaysia' });
  for (let i = 0; i < 5; i++) await app.sweepPreviews();
  assert.ok(calls.length <= 3, `tries at most 3 times, tried ${calls.length}`);
});

test('auto start: no country means no automatic start, said plainly, and it is off unless switched on', async () => {
  const calls = [];
  const factory = { startReport: async () => ({}), startPreview: async (x) => { calls.push(x); return { reportId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }; } };
  await start({ autoStart: true, factory });
  await signIn();
  await postForm('/account/previews', { company: 'No Country Co' });
  assert.equal(calls.length, 0);
  assert.match(store.previewsFor('buyer@example.com')[0].factory_error, /no country/);
  await start({ autoStart: false, factory });
  await signIn();
  await postForm('/account/previews', { company: 'Switched Off Co', country: 'Malaysia' });
  assert.equal(calls.length, 0, 'PREVIEW_AUTO_START off: nothing starts');
});

test('the preview endpoint is off when no admin token is set', async () => {
  await start({ previewAdminToken: '' });
  const res = await fetch(`${origin}/api/previews/1/ready`, { method: 'POST', headers: { authorization: 'Bearer ' }, body: JSON.stringify({ report_id: REPORT }) });
  assert.equal(res.status, 404);
});

// ---- Team page ----

test('the office opens only with its key: without it every office page goes to the key page, a signed-in account is not enough', async () => {
  const out = await get('/myoffice/previews');
  assert.equal(out.status, 303);
  assert.match(out.headers.get('location'), /^\/myoffice\/login\?next=%2Fmyoffice%2Fpreviews/);
  await signIn('buyer@example.com');
  for (const p of ['/myoffice/previews', '/myoffice/users', '/myoffice/visitors', '/myoffice/reports/full']) {
    assert.match((await get(p)).headers.get('location') ?? '', /^\/myoffice\/login/, p);
  }
  assert.match((await postForm('/myoffice/previews/1/ready', { report: REPORT })).headers.get('location'), /^\/myoffice\/login/);
  assert.equal(store.previewById(1), null);
  assert.doesNotMatch(await (await get('/account')).text(), /href="\/myoffice\/previews"/, 'no office link outside the office');
  // The old address is gone.
  assert.equal((await get('/admin/previews')).status, 404);

  const wrong = await officeIn('nope');
  assert.equal(wrong.status, 401);
  assert.match(await wrong.text(), /not the office key/);
  for (let i = 0; i < 9; i++) await officeIn('nope');
  assert.equal((await officeIn()).status, 429, 'too many wrong keys: even the right one waits');
  clock += 16 * 60 * 1000;
  const ok = await officeIn();
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/myoffice/previews');
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await get('/myoffice/previews')).status, 200);
  assert.match(await (await get('/account')).text(), /href="\/myoffice\/previews"/);
  // Only office pages can be the place to go after the key.
  assert.equal((await post('/myoffice/login', 'key=office-key-test&next=https%3A%2F%2Fevil.example', FORM)).headers.get('location'), '/myoffice/previews');
});

test('without OFFICE_KEY the office cannot be opened, and says why', async () => {
  const res = await fetch(`${origin}/myoffice/login`);
  assert.equal(res.status, 200);
  stop();
  // A server with no key.
  const app = createApp({ stripe: fakeStripe, hub: createHub({ url: HUB, token: 'hub-token', fetchImpl: fakeHubFetch, log: () => {} }),
    config: { stripeKey: 'sk_test_fake', webhookSecret: SECRET, priceCents: 8900, currency: 'usd', siteDir: '.', seller: {} },
    store, mailer: createMailer({ store, log: () => {} }), log: () => {} });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(`${origin}/myoffice/login`)).text(), /OFFICE_KEY/);
  const r = await post('/myoffice/login', 'key=anything', FORM);
  assert.equal(r.status, 503);
  assert.equal((await get('/myoffice/previews')).headers.get('location'), '/myoffice/login?next=%2Fmyoffice%2Fpreviews');
});

test('an admin sees every request and the mail log, and marks one ready: the buyer is emailed their link', async () => {
  await signIn('buyer@example.com');
  await postForm('/account/previews', { company: 'Acme Sdn Bhd', who: 'rival', country: 'Singapore', website: 'acme.sg' });
  cookie = '';
  clock += 31_000;
  await signIn('team@example.com');
  await officeIn();
  assert.match(await (await get('/account')).text(), /href="\/myoffice\/previews"/, 'the office gets the link');

  const page = await (await get('/myoffice/previews')).text();
  assert.match(page, /Waiting for a preview \(1\)/);
  assert.match(page, /Acme Sdn Bhd/);
  assert.match(page, /a competitor · Singapore · acme\.sg/);
  assert.match(page, /asked by buyer@example\.com/);
  assert.match(page, /Recent email/);
  assert.match(page, /preview-requested/);

  const bad = await postForm('/myoffice/previews/1/ready', { report: 'nonsense' });
  assert.equal(bad.headers.get('location'), '/myoffice/previews?n=bad_report');
  assert.equal(store.previewById(1).status, 'requested');
  assert.match(await (await get('/myoffice/previews?n=bad_report')).text(), /not a report id/);

  // The preview link can be pasted as it is.
  const ok = await postForm('/myoffice/previews/1/ready', { report: `https://mirrormirror.cloud/p/${REPORT.toUpperCase()}` });
  assert.equal(ok.headers.get('location'), '/myoffice/previews?n=ready');
  assert.equal(store.previewById(1).report_id, REPORT);
  assert.equal(sentTo('buyer@example.com', 'preview-ready').length, 1);
  const after = await (await get('/myoffice/previews?n=ready')).text();
  assert.match(after, /Waiting for a preview \(0\)/);
  assert.match(after, /Ready \(1\)/);
  assert.match(after, /Buyer emailed/);
  assert.match(after, /The buyer was emailed/);
  assert.equal((await postForm('/myoffice/previews/99/ready', { report: REPORT })).headers.get('location'), '/myoffice/previews?n=missing');
});

test('if the buyer cannot be emailed the request is still ready, the page says so, and "Email again" sends it; a different report is emailed again', async () => {
  await signIn('buyer@example.com');
  await postForm('/account/previews', { company: 'Acme Sdn Bhd' });
  cookie = '';
  clock += 31_000;
  await officeIn();
  mailjetFails = true;
  const res = await postForm('/myoffice/previews/1/ready', { report: REPORT });
  assert.equal(res.headers.get('location'), '/myoffice/previews?n=ready_not_emailed');
  assert.equal(store.previewById(1).status, 'ready', 'ready even though the email failed');
  const page = await (await get('/myoffice/previews')).text();
  assert.match(page, /Buyer not emailed yet/);
  assert.match(page, /Email again/);
  assert.match(page, /status[^>]*>failed|badge bad">failed/, 'the failed email is in the log, with its reason');
  assert.match(page, /sender not validated/);

  mailjetFails = false;
  await postForm('/myoffice/previews/1/ready', { report: REPORT });
  assert.equal(sentTo('buyer@example.com', 'preview-ready').length, 1);
  await postForm('/myoffice/previews/1/ready', { report: REPORT });
  assert.equal(sentTo('buyer@example.com', 'preview-ready').length, 1, 'same report: not emailed twice');
  await postForm('/myoffice/previews/1/ready', { report: REPORT_2 });
  assert.equal(sentTo('buyer@example.com', 'preview-ready').length, 2, 'a different report is a new link, so the buyer is told');
  assert.match(sentTo('buyer@example.com', 'preview-ready')[1].TextPart, new RegExp(REPORT_2));
});

// ---- Team pages: every report ----

test('the all-reports pages are admin only, list every report with its link, and show a database problem instead of failing', async () => {
  const ID_A = 'aaaaaaaa-1111-4111-8111-111111111111', ID_B = 'bbbbbbbb-2222-4222-8222-222222222222';
  let down = false;
  const query = async (text) => {
    if (down) throw new Error('connection refused');
    if (/from v21_report r order by/.test(text)) return { rows: [
      { report_id: ID_A, company: 'Alpha Solar', country: 'Malaysia', industry: 'Solar', created_at: '2026-11-11T00:00:00Z', has_preview: true },
      { report_id: ID_B, company: 'Beta <Works>', country: 'Malaysia', industry: null, created_at: null, has_preview: false }] };
    if (/from v21_deeper_run d left join/.test(text)) return { rows: [
      { report_id: ID_A, run_id: 'r2', status: 'running', stage: 'lanes', created_at: '2026-11-12T00:00:00Z', has_html: false, company: 'Alpha Solar' },
      { report_id: ID_B, run_id: 'r9', status: 'failed', created_at: '2026-11-11T05:00:00Z', has_html: false, company: 'Beta <Works>' },
      { report_id: ID_A, run_id: 'r1', status: 'done', created_at: '2026-11-11T00:00:00Z', has_html: true, company: 'Alpha Solar' }] };
    throw new Error(`unexpected query: ${text}`);
  };
  await start({ reportDb: createReportDb({ query }) });

  const out = await get('/myoffice/reports/full');
  assert.equal(out.status, 303);
  assert.match(out.headers.get('location'), /^\/myoffice\/login\?next=%2Fmyoffice%2Freports%2Ffull/);
  await officeIn();
  const p = await get('/myoffice/reports/previews');
  assert.equal(p.status, 200);
  const ptext = await p.text();
  assert.match(ptext, new RegExp(`href="/p/${ID_A}"`));
  assert.match(ptext, new RegExp(`href="/p/${ID_B}"`), 'a report without a preview is still listed');
  assert.match(ptext, /Beta &lt;Works&gt;/, 'names are escaped');
  assert.match(ptext, /Not written yet/);
  assert.equal((await get('/myoffice/reports')).status, 200);

  const f = await (await get('/myoffice/reports/full')).text();
  assert.match(f, new RegExp(`href="/r/${ID_A}"`));
  assert.match(f, new RegExp(`href="/r/${ID_B}"`), 'a failed report is still listed');
  assert.match(f, /Ready, with a note/, 'a newer run is building: the older finished page is ready');
  assert.match(f, /Failed/);
  assert.match(f, /2 runs/);

  down = true;
  const broken = await get('/myoffice/reports/full');
  assert.equal(broken.status, 200, 'a database problem is shown on the page, not as an error');
  assert.match(await broken.text(), /could not be read just now: connection refused/);
});

test('running jobs are highlighted on top of the overview page', async () => {
  await signIn();

  // 1. Initial state: no running jobs
  let p = await (await get('/account')).text();
  assert.equal(p.includes('class="running-jobs"'), false);
  assert.equal(p.includes('http-equiv="refresh"'), false);

  // 2. Request a preview: it becomes an open/running job
  await postForm('/account/previews', { back: 'overview', who: 'mine', company: 'Solana Tec Sdn Bhd', country: 'Malaysia' });
  p = await (await get('/account?n=requested')).text();
  assert.match(p, /class="running-jobs"/);
  assert.match(p, /Running Free preview/);
  assert.match(p, /Solana Tec Sdn Bhd/);
  assert.match(p, /What is running now/);
  assert.match(p, /Waiting to start/);
  assert.match(p, /href="\/account\/previews"/);
  assert.match(p, /See preview progress/);
  assert.match(p, /<meta http-equiv="refresh" content="20">/);

  // 3. If there is ALSO a ready preview (toBuy), the running job is highlighted on top, and toBuy is below it
  store.markPreviewReady(store.previewsFor('buyer@example.com')[0].id, '3cbab088-9b9f-4ed4-825c-84e01dc7db70', clock);
  // Now add another open preview
  await postForm('/account/previews', { back: 'overview', who: 'mine', company: 'Next Venture Ltd', country: 'Singapore' });
  p = await (await get('/account')).text();
  assert.match(p, /class="running-jobs"/);
  assert.match(p, /Next Venture Ltd/);
  assert.match(p, /Your preview of Solana Tec Sdn Bhd is ready/);
  // Running jobs section comes BEFORE the toBuy (.next) box
  const runningIdx = p.indexOf('class="running-jobs"');
  const nextIdx = p.indexOf('class="next"');
  assert.ok(runningIdx !== -1 && nextIdx !== -1 && runningIdx < nextIdx, 'running jobs must be on top of .next');
});

test('running full reports are highlighted on top of the overview page', async () => {
  const query = async (text) => {
    if (text.includes('from v21_report where report_id =')) {
      return { rows: [{ company: 'Fenice Media Ltd', country: 'UK', industry: 'Media', website: '', created_at: new Date().toISOString() }] };
    }
    if (text.includes('from v21_deeper_run where report_id =')) {
      return {
        rows: [{
          run_id: 'c10ba5a8-0021-4ace-bd8f-08152c765afe',
          status: 'running',
          stage: 'analysing research',
          created_at: new Date(clock - 600_000).toISOString(),
          finished_at: null,
          error: null,
          has_html: false,
        }],
      };
    }
    return { rows: [] };
  };
  await start({ reportDb: createReportDb({ query }) });
  await signIn('buyer@example.com');
  store.recordOrder({
    stripeSessionId: 'cs_1',
    email: 'buyer@example.com',
    company: 'Fenice Media Ltd',
    amountCents: 8900,
    currency: 'usd',
    paidAt: clock - 600_000,
    reportId: 'c10ba5a8-0021-4ace-bd8f-08152c765afe',
  });

  const p = await (await get('/account')).text();
  assert.match(p, /class="running-jobs"/);
  assert.match(p, /Running Full report/);
  assert.match(p, /Fenice Media Ltd/);
  assert.match(p, /What is running now/);
  assert.match(p, /analysing research/);
  assert.match(p, /See report progress/);
  assert.match(p, /href="\/account\/reports"/);
  assert.match(p, /<meta http-equiv="refresh" content="20">/);
});
