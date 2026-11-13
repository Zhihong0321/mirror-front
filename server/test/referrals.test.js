// The referral program (docs/referrals.md): referral codes, the commission setting, USDT wallets, attribution from the
// preview link / cookie / requester, the commission recorded when a referred buyer pays, the visitor tracker a referrer
// sees, and the team's page to pay out. Fake Stripe, fake report database, fake factory. Nothing leaves the machine.

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
import {
  checkWallet, readership, dollarsToCents, commissionFromSetting, newCode, cleanCode, COMMISSION_DEFAULT_CENTS, READ_MS,
} from '../referrals.js';

const SECRET = 'whsec_test_secret';
const REPORT = '0b6f3f1e-8f0a-4c52-9a53-0d1f6e0c7a11';
const OTHER = '11111111-2222-4333-8444-555555555555';
const FACTORY = 'https://factory.test';
const TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';          // Tether's own contract on TRON: a real, checksum-valid address
const ERC20 = '0xdAC17F958D2ee523a2206206994597C13D831ec7';  // Tether's contract on Ethereum
const realStripe = new Stripe('sk_test_fake');
const clock = Date.parse('2026-11-11T10:00:00Z');

let runs, posts, sessions, sent, server, origin, store, cookie, logs, hooks;

const fakeStripe = {
  webhooks: realStripe.webhooks,
  checkout: { sessions: {
    async create(params) { const s = { id: `cs_test_${sessions.size + 1}`, url: `https://checkout.stripe.test/${sessions.size + 1}`, payment_status: 'unpaid', ...params }; sessions.set(s.id, s); return s; },
    async retrieve(id) { if (!sessions.has(id)) throw new Error('No such checkout session'); return sessions.get(id); },
  } },
};

const s2 = { input: { company: 'Eternalgy Sdn Bhd', country: 'Malaysia', industry: 'Solar' }, baseline: { websites: [] }, contradictions: [], take_note: [], suggestions: [],
  conclusive_findings: [{ id: 'f1', kind: 'problem', topic: 'email', title: 'T', statement: 'No DMARC record', evidence: [{ evidence_id: 'E1', quoted_text: 'Q', source_url: 'https://r.example/1' }], why_it_matters: 'W', identity: 'x', confidence: 'high' }] };
function fakeQuery(text, params) {
  if (/from v21_report /.test(text)) return Promise.resolve({ rows: params[0] === REPORT ? [{ company: 'Eternalgy Sdn Bhd', country: 'Malaysia', industry: 'Solar' }] : [] });
  if (/select run_id, status/.test(text)) return Promise.resolve({ rows: params[0] === REPORT ? structuredClone(runs) : [] });
  if (/kind = 'report'/.test(text)) return Promise.resolve({ rows: [{ payload: { language: 'en', created_at: '2026-11-08T00:00:00Z', summary: [], step2_row_id: 7 } }] });
  if (/where report_id = \$1 and id = \$2/.test(text)) return Promise.resolve({ rows: params[1] === 7 ? [{ payload: s2 }] : [] });
  if (/hub_setting/.test(text)) return Promise.resolve({ rows: [{ value: '59' }] });
  return Promise.reject(new Error(`unexpected query: ${text}`));
}

async function fakeFactoryFetch(url, init) {
  posts.push(JSON.parse(init.body));
  runs.unshift({ run_id: `run-${posts.length}`, status: 'queued', stage: '' });
  return new Response(JSON.stringify({ run_id: `run-${posts.length}` }), { status: 202 });
}

async function start() {
  server?.closeAllConnections(); server?.close(); store?.close();
  store = openStore(':memory:');
  const reportDb = createReportDb({ query: fakeQuery });
  const factory = createFactory({ url: FACTORY, token: 'factory-token', db: reportDb, dryRun: false, fetchImpl: fakeFactoryFetch, log: (m) => logs.push(m) });
  const config = { stripeKey: 'sk_test_fake', webhookSecret: SECRET, priceCents: 8900, currency: 'usd', reportHubUrl: FACTORY, officeKey: 'office-key-test',
    previewAdminToken: 'admin-token', siteDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site'), seller: { name: 'Test Seller', address: '1 St', note: '' }, analyticsTz: 'UTC' };
  const mailer = { configured: true, send: async (m) => { sent.push(m); return { ok: !hooks.mailFails?.includes(m.kind) }; } };
  server = http.createServer(createApp({ stripe: fakeStripe, hub: {}, config, store, mailer, reportDb, factory, now: () => clock, log: (m) => logs.push(m) }));
  await new Promise((r) => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(async () => { runs = []; posts = []; sessions = new Map(); sent = []; cookie = ''; logs = []; hooks = {}; await start(); });
after(() => { server?.closeAllConnections(); server?.close(); });

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const get = (p, headers = {}) => fetch(origin + p, { redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...headers } });
const post = (p, body, headers = {}) => fetch(origin + p, { method: 'POST', body, headers: { ...(cookie ? { cookie } : {}), ...FORM, ...headers }, redirect: 'manual' });

function signInAs(email) {
  const token = crypto.randomBytes(24).toString('base64url');
  store.upsertUser(email, clock);
  store.createSession(crypto.createHash('sha256').update(token).digest('hex'), email, clock, 3_600_000);
  cookie = `mm_session=${token}`;
  return token;
}
async function officeIn() {
  const res = await post('/myoffice/login', `key=office-key-test&next=%2Fmyoffice%2Freferrals`);
  assert.equal(res.status, 303);
  cookie = [cookie, res.headers.get('set-cookie').split(';')[0]].filter(Boolean).join('; ');
}
// Checks out the report as `email`, optionally with a form `ref` or an extra cookie. Returns the Stripe session id.
async function checkout(email, { ref, extraCookie } = {}) {
  signInAs(email);
  if (extraCookie) cookie = `${cookie}; ${extraCookie}`;
  const res = await post('/order/checkout', `report=${REPORT}${ref ? `&ref=${ref}` : ''}`);
  assert.equal(res.status, 303);
  return [...sessions.keys()].at(-1);
}
async function pay(id) {
  const s = sessions.get(id); s.payment_status = 'paid';
  const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: s } });
  const sig = realStripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return fetch(`${origin}/stripe/webhook`, { method: 'POST', body: payload, headers: { 'stripe-signature': sig, 'content-type': 'application/json' } });
}
const mailTo = (to, kind) => sent.filter((m) => m.to === to && (!kind || m.kind === kind));

// A page view of /p/<REPORT> as the tracker records it, with what the browser reports afterwards.
let viewNo = 0;
function visit({ at = clock - 3_600_000, ms = 0, scroll = null, visitor = null, bot = false, email = null, path = `/p/${REPORT}`, ip = '203.0.113.9' } = {}) {
  viewNo += 1;
  const viewId = `view-${viewNo}-${Math.random().toString(36).slice(2, 8)}`;
  store.visits.record({ viewId, at, path, pageKey: path.split('?')[0], status: 200, accountEmail: email, ip, ua: bot ? 'WhatsApp/2' : 'Mozilla/5.0', browser: bot ? 'WhatsApp' : 'Chrome 130', os: 'Windows', device: bot ? 'bot' : 'desktop', isBot: bot, city: 'Kuala Lumpur', countryCode: 'MY' });
  if (ms || scroll != null || visitor) store.visits.beacon(viewId, { visitorId: visitor, ms, scroll, touch: 0 }, at + ms);
  return viewId;
}

// ---- Pure rules ----

test('wallet check: a real TRON address passes, a typo is caught by its checksum, a wrong network or shape is refused', () => {
  assert.deepEqual(checkWallet('trc20', TRC20), { ok: true, address: TRC20 });
  assert.deepEqual(checkWallet('trc20', `  ${TRC20}  `), { ok: true, address: TRC20 }, 'spaces around a pasted address are trimmed');
  const typo = `${TRC20.slice(0, -1)}7`;
  assert.deepEqual(checkWallet('trc20', typo), { ok: false, reason: 'checksum' });
  assert.deepEqual(checkWallet('trc20', ERC20), { ok: false, reason: 'format' }, 'an Ethereum address on the TRON network');
  assert.deepEqual(checkWallet('erc20', TRC20), { ok: false, reason: 'format' }, 'a TRON address on Ethereum');
  assert.deepEqual(checkWallet('erc20', ERC20), { ok: true, address: ERC20 });
  assert.deepEqual(checkWallet('bep20', ERC20), { ok: true, address: ERC20 });
  assert.deepEqual(checkWallet('bep20', `0x${'0'.repeat(40)}`), { ok: false, reason: 'format' }, 'the zero address burns money');
  assert.deepEqual(checkWallet('bep20', '0x123'), { ok: false, reason: 'format' });
  assert.deepEqual(checkWallet('trc20', ''), { ok: false, reason: 'empty' });
  assert.deepEqual(checkWallet('btc', TRC20), { ok: false, reason: 'network' });
});

test('commission setting: USD 20 by default, any bad value falls back to it, the team form reads dollars', () => {
  assert.equal(COMMISSION_DEFAULT_CENTS, 2000);
  assert.equal(commissionFromSetting(null), 2000);
  assert.equal(commissionFromSetting(''), 2000);
  assert.equal(commissionFromSetting('abc'), 2000);
  assert.equal(commissionFromSetting('-5'), 2000);
  assert.equal(commissionFromSetting('1500'), 1500);
  assert.equal(commissionFromSetting('0'), 0, 'zero is allowed: a pause on commission');
  assert.equal(dollarsToCents('20'), 2000);
  assert.equal(dollarsToCents('$12.50'), 1250);
  assert.equal(dollarsToCents('12.345'), null);
  assert.equal(dollarsToCents('twenty'), null);
  assert.equal(store.commissionCents(), 2000);
  store.setSetting('referral_commission_cents', 'garbage', clock);
  assert.equal(store.commissionCents(), 2000, 'a bad value in the database never stops a sale');
});

test('referral codes: random, unique per account, made once, and the same code opens the same account', () => {
  assert.match(newCode(), /^[a-z2-9]{8}$/);
  assert.equal(cleanCode(' ABCD2345 '), 'abcd2345');
  assert.equal(cleanCode('a b'), null);
  store.upsertUser('a@example.com', clock);
  store.upsertUser('b@example.com', clock);
  const a = store.referralCode('a@example.com');
  const b = store.referralCode('b@example.com');
  assert.notEqual(a, b);
  assert.equal(store.referralCode('a@example.com'), a, 'the same code every time');
  assert.equal(store.emailForReferralCode(a), 'a@example.com');
  assert.equal(store.emailForReferralCode(a.toUpperCase()), 'a@example.com');
  assert.equal(store.emailForReferralCode('nope1234'), null);
  assert.equal(store.referralCode('nobody@example.com'), null, 'no account, no code');
  assert.doesNotMatch(a, /a@|example/, 'the code says nothing about the person');
});

test('did the client read it: not opened, only a bot, opened, read, and opened but not measured', () => {
  const row = (o) => ({ id: Math.random(), is_bot: 0, js: 1, active_ms: 0, scroll_pct: 0, created_at: 1000, ...o });
  assert.equal(readership([]).state, 'none');
  assert.equal(readership(null).state, 'none');
  const bots = readership([row({ is_bot: 1 }), row({ is_bot: 1 })]);
  assert.equal(bots.state, 'bots');
  assert.equal(bots.bots, 2);
  assert.equal(bots.views, 0);
  assert.equal(readership([row({ active_ms: 8_000, scroll_pct: 30, visitor_id: 'v1' })]).state, 'opened');
  const read = readership([row({ active_ms: READ_MS + 1, scroll_pct: 85, visitor_id: 'v1', created_at: 5000 }), row({ active_ms: 2000, scroll_pct: 10, visitor_id: 'v1', created_at: 9000 })]);
  assert.equal(read.state, 'read');
  assert.equal(read.views, 2);
  assert.equal(read.people, 1, 'two visits by one browser are one person');
  assert.equal(read.lastAt, 9000);
  assert.equal(read.maxScroll, 85);
  assert.equal(readership([row({ active_ms: 120_000, scroll_pct: 20 })]).state, 'opened', 'long but never scrolled is not a read');
  assert.equal(readership([row({ active_ms: 5_000, scroll_pct: 95 })]).state, 'opened', 'scrolled through in seconds is not a read');
  const unmeasured = readership([row({ js: 0, active_ms: null, scroll_pct: null })]);
  assert.equal(unmeasured.state, 'opened');
  assert.equal(unmeasured.unmeasured, true);
});

// ---- The program end to end ----

test('a referrer asks for a preview; the ready email and the referral page carry their code, and nothing is opened yet', async () => {
  signInAs('ref@example.com');
  assert.equal((await post('/account/previews', 'company=Eternalgy+Sdn+Bhd&country=Malaysia')).status, 303);
  const code = store.referralCode('ref@example.com');

  let page = await (await get('/account/referrals')).text();
  assert.match(page, /Links and tracker/);
  assert.match(page, /you earn USD 20/);
  assert.match(page, /Being prepared/, 'the preview is not ready: no link yet');

  const ready = await fetch(`${origin}/api/previews/1/ready`, { method: 'POST', headers: { authorization: 'Bearer admin-token' }, body: JSON.stringify({ report_id: REPORT }) });
  assert.equal(ready.status, 200);
  const [mail] = mailTo('ref@example.com', 'preview-ready');
  assert.match(mail.text, new RegExp(`${origin.replace(/\./g, '\\.')}/p/${REPORT}\\?ref=${code}`), 'the link in the ready email has the code');

  page = await (await get('/account/referrals')).text();
  assert.match(page, new RegExp(`value="${origin.replace(/\./g, '\\.')}/p/${REPORT}\\?ref=${code}"`));
  assert.match(page, /Not opened yet/);
});

test('the preview page: its order button carries the referral code, and opening it with ?ref= leaves a cookie for that report only', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  cookie = '';
  const res = await get(`/p/${REPORT}?ref=${code}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, new RegExp(`order\\?report=${REPORT}&amp;ref=${code}|order\\?report=${REPORT}&ref=${code}`), 'the order button has the code');
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(`^mm_ref=${code}~${REPORT};`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Max-Age=2592000/, '30 days');

  const plain = await get(`/p/${REPORT}`);
  assert.equal(plain.headers.get('set-cookie'), null, 'no ref, no cookie');
  const forged = await get(`/p/${REPORT}?ref=zzzzzzzz`);
  assert.equal(forged.headers.get('set-cookie'), null, 'a code nobody owns is ignored');
  assert.equal(forged.status, 200, 'and the page still shows');
});

test('a referred buyer pays: one commission of USD 20 is recorded, the referrer is emailed once, however often Stripe notifies', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  const id = await checkout('buyer@example.com', { ref: code });
  assert.equal(sessions.get(id).metadata.referrer_code, code);
  assert.equal(sessions.get(id).metadata.referrer_source, 'link');

  assert.equal((await pay(id)).status, 200);
  const [c] = store.commissionsFor('ref@example.com');
  assert.equal(c.amount_cents, 2000);
  assert.equal(c.status, 'pending');
  assert.equal(c.report_id, REPORT);
  assert.equal(c.buyer_email, 'buyer@example.com');
  assert.equal(c.source, 'link');
  assert.equal(mailTo('ref@example.com', 'referral-earned').length, 1);
  assert.match(mailTo('ref@example.com', 'referral-earned')[0].subject, /You earned 20 USDT/);

  assert.equal((await pay(id)).status, 200);
  assert.equal((await get(`/order/done?session_id=${id}`)).status, 200);
  assert.equal(store.commissionsFor('ref@example.com').length, 1, 'one commission per order');
  assert.equal(mailTo('ref@example.com', 'referral-earned').length, 1, 'one email per commission');
  assert.equal(posts.length, 1, 'the report was started once as before');

  signInAs('ref@example.com');
  const page = await (await get('/account/referrals/earnings')).text();
  assert.match(page, /Earned: to be paid/);
  assert.match(page, /<b>20 USDT<\/b>/);
});

test('the cookie alone is enough: a buyer who saw the referral link and pays later from another page still counts', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  const id = await checkout('buyer@example.com', { extraCookie: `mm_ref=${code}~${REPORT}` });
  assert.equal(sessions.get(id).metadata.referrer_source, 'cookie');
  await pay(id);
  assert.equal(store.commissionsFor('ref@example.com')[0].source, 'cookie');

  // a cookie left for another report does not count for this one
  const id2 = await checkout('buyer2@example.com', { extraCookie: `mm_ref=${code}~${OTHER}` });
  assert.equal(sessions.get(id2).metadata.referrer_code, undefined);
});

test('a plain link still pays the account that asked for the preview, and an explicit referral code wins over that', async () => {
  signInAs('asker@example.com');
  await post('/account/previews', 'company=Eternalgy+Sdn+Bhd&country=Malaysia');
  store.markPreviewReady(1, REPORT, clock);
  const askerCode = store.referralCode('asker@example.com');

  const id = await checkout('buyer@example.com');
  assert.equal(sessions.get(id).metadata.referrer_code, askerCode);
  assert.equal(sessions.get(id).metadata.referrer_source, 'requester');
  await pay(id);
  assert.equal(store.commissionsFor('asker@example.com')[0].source, 'requester');

  signInAs('friend@example.com');
  const friend = store.referralCode('friend@example.com');
  const id2 = await checkout('buyer2@example.com', { ref: friend });
  assert.equal(sessions.get(id2).metadata.referrer_code, friend, 'the link they were sent wins');
});

test('no referrer at all: nothing is recorded, nothing is sent, the sale goes through as before', async () => {
  const id = await checkout('buyer@example.com');
  assert.equal(sessions.get(id).metadata.referrer_code, undefined);
  assert.equal((await pay(id)).status, 200);
  assert.equal(store.allCommissions().length, 0);
  assert.deepEqual(sent.map((m) => m.kind), ['invoice', 'payment-signin']);
});

test('the commission is the setting at the time of the sale: changing it later does not change old commissions', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  await pay(await checkout('buyer@example.com', { ref: code }));
  store.setSetting('referral_commission_cents', 3500, clock);
  await pay(await checkout('buyer2@example.com', { ref: code }));
  assert.deepEqual(store.commissionsFor('ref@example.com').map((c) => c.amount_cents).sort(), [2000, 3500]);
});

test('buying through your own link earns the fee like any sale, labelled "Own purchase"; the team can still put one on hold, approve or cancel it', async () => {
  signInAs('me@example.com');
  const code = store.referralCode('me@example.com');
  await pay(await checkout('me@example.com', { ref: code }));
  const [c] = store.commissionsFor('me@example.com');
  assert.equal(c.status, 'pending');
  assert.equal(c.amount_cents, 2000);
  assert.match(c.note, /Own purchase/);
  assert.equal(mailTo('me@example.com', 'referral-earned').length, 1, 'told, like any other sale');
  const page = await (await get('/account/referrals/earnings')).text();
  assert.match(page, /Earned: to be paid/);

  await officeIn();
  assert.match(await (await get('/myoffice/referrals')).text(), /Own purchase/);
  store.setCommissionStatus(c.id, 'held', c.note); // the team's own decision to hold one
  assert.equal((await post(`/myoffice/referrals/${c.id}/approve`, '')).headers.get('location'), '/myoffice/referrals?n=approved');
  assert.equal(store.commissionById(c.id).status, 'pending');
  assert.equal((await post(`/myoffice/referrals/${c.id}/void`, '')).headers.get('location'), '/myoffice/referrals?n=voided');
  assert.equal(store.commissionById(c.id).status, 'void');
});

test('zero kill gates: a referral that cannot be recorded never stops the payment, the invoice or the report', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  const id = await checkout('buyer@example.com', { ref: code });
  store.recordCommission = () => { throw new Error('disk full'); };
  assert.equal((await pay(id)).status, 200);
  assert.equal(posts.length, 1, 'the report started');
  assert.equal(store.ordersFor('buyer@example.com').length, 1, 'the order is recorded');
  assert.deepEqual(sent.map((m) => m.kind), ['invoice', 'payment-signin']);
  assert.ok(logs.some((l) => /could not record the referral commission: .*disk full/.test(l)), 'and the problem is in the log');
});

test('a code nobody owns on a paid order is logged and does not stop the order', async () => {
  const id = await checkout('buyer@example.com');
  sessions.get(id).metadata.referrer_code = 'ghost999';
  assert.equal((await pay(id)).status, 200);
  assert.equal(store.ordersFor('buyer@example.com').length, 1);
  assert.equal(store.allCommissions().length, 0);
  assert.ok(logs.some((l) => /no account owns that code/.test(l)));
});

test('the referrer sees who opened the preview: their own visits and other previews are left out, bots are named, reading is judged', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  await post('/account/previews', 'company=Eternalgy+Sdn+Bhd&country=Malaysia');
  store.markPreviewReady(1, REPORT, clock);
  const read = async () => (await (await get('/account/referrals')).text());

  assert.match(await read(), /Not opened yet/);

  visit({ bot: true });
  assert.match(await read(), /Not opened by a person yet/);
  assert.match(await read(), /fetched 1 time by a bot or a chat app/);

  visit({ email: 'ref@example.com', visitor: 'refbrowser', ms: 90_000, scroll: 100 }); // the referrer looking at their own preview
  visit({ visitor: 'refbrowser', ms: 90_000, scroll: 100 }); // the same browser, signed out
  visit({ path: `/p/${OTHER}`, visitor: 'x', ms: 90_000, scroll: 100 }); // somebody else's preview
  let page = await read();
  assert.match(page, /Not opened by a person yet/, 'none of those counts');

  visit({ visitor: 'client1', ms: 8_000, scroll: 25, at: clock - 7_200_000 });
  page = await read();
  assert.match(page, /badge wait">Opened</);
  assert.match(page, /1 view by 1 person/);
  assert.match(page, /scrolled up to 25%/);

  visit({ visitor: 'client1', ms: 95_000, scroll: 90, at: clock - 60_000 });
  page = await read();
  assert.match(page, /badge ok">Read it</);
  assert.match(page, /2 views by 1 person/);
  assert.match(page, /last 1 min ago/);
  assert.match(page, /best visit 1m 35s on the page/);
  assert.match(page, /Kuala Lumpur, MY/, 'where, by city');
  assert.doesNotMatch(page, /203\.0\.113\.9/, 'a referrer never sees an IP address');
});

test('the Free previews list shows the read status of each ready preview, so the referrer sees it without opening the tracker', async () => {
  signInAs('ref@example.com');
  await post('/account/previews', 'company=Eternalgy+Sdn+Bhd&country=Malaysia');
  const list = async () => (await (await get('/account/previews')).text());
  assert.doesNotMatch(await list(), /class="readline"/, 'a preview that is not ready has no read line');

  store.markPreviewReady(1, REPORT, clock);
  let page = await list();
  assert.match(page, /class="readline"[^]*Not opened yet[^]*Nobody has opened this link yet/);

  visit({ bot: true });
  assert.match(await list(), /Not opened by a person yet/);

  visit({ email: 'ref@example.com', visitor: 'refbrowser', ms: 90_000, scroll: 100 }); // their own look does not count
  assert.match(await list(), /Not opened by a person yet/);

  visit({ visitor: 'client1', ms: 8_000, scroll: 25, at: clock - 7_200_000 });
  page = await list();
  assert.match(page, /badge wait">Opened</);
  assert.match(page, /1 view by 1 person/);

  visit({ visitor: 'client1', ms: 95_000, scroll: 90, at: clock - 60_000 });
  page = await list();
  assert.match(page, /badge ok">Read it</);
  assert.match(page, /2 views by 1 person/);
  assert.match(page, /href="\/account\/referrals#previews">Every view</);
  assert.doesNotMatch(page, /203\.0\.113\.9/, 'no IP address on this page either');

  // A tracker that cannot be read leaves a label, and the page still shows.
  store.visits.referrerViews = () => { throw new Error('db locked'); };
  const res = await get('/account/previews');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Visitor activity:<\/b> could not be read just now/);
  assert.ok(logs.some((l) => /could not read the tracker for ref@example.com: db locked/.test(l)));
});

test('a preview someone else asked for shows to a referrer only through views that came in on their own link', async () => {
  signInAs('owner@example.com');
  await post('/account/previews', 'company=Eternalgy+Sdn+Bhd&country=Malaysia');
  store.markPreviewReady(1, REPORT, clock);
  signInAs('friend@example.com');
  const code = store.referralCode('friend@example.com');

  visit({ visitor: 'p1', ms: 60_000, scroll: 90 }); // came in on the owner's link, not the friend's
  assert.doesNotMatch(await (await get('/account/referrals')).text(), /Other previews opened through your link/);

  visit({ visitor: 'p2', ms: 60_000, scroll: 90, path: `/p/${REPORT}?ref=${code}` });
  const page = await (await get('/account/referrals')).text();
  assert.match(page, /Other previews opened through your link/);
  assert.match(page, /Eternalgy Sdn Bhd/);
  assert.match(page, /1 view by 1 person/, 'only the view that carried their code');
});

test('"get your link for any preview": a pasted preview link or id becomes a link with your code; junk is told so', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  const base = `${origin}/p/${REPORT}?ref=${code}`;
  for (const given of [`https://mirrormirror.cloud/p/${REPORT.toUpperCase()}`, REPORT, `https://x.test/p/${REPORT}?utm=1`]) {
    const page = await (await get(`/account/referrals?link=${encodeURIComponent(given)}`)).text();
    assert.ok(page.includes(`value="${base}"`), given);
  }
  const bad = await (await get('/account/referrals?link=https%3A%2F%2Fexample.com%2Fnothing')).text();
  assert.match(bad, /does not look like a preview link/);
});

test('"already have a preview link" keeps the referral code on the link it opens', async () => {
  const loc = (await get(`/account/open?link=${encodeURIComponent(`https://mirrormirror.cloud/p/${REPORT}?ref=abcd2345`)}`)).headers.get('location');
  assert.equal(loc, `/p/${REPORT}?ref=abcd2345`);
});

test('wallets: a valid USDT address is saved, a wrong one is refused with the reason, and it can be removed', async () => {
  signInAs('ref@example.com');
  const save = (network, address) => post('/account/referrals/wallet', `network=${network}&address=${encodeURIComponent(address)}`);

  assert.equal((await save('trc20', TRC20)).headers.get('location'), '/account/referrals/wallet?n=wallet_saved');
  assert.deepEqual(store.payoutWallet('ref@example.com').address, TRC20);
  let page = await (await get('/account/referrals/wallet?n=wallet_saved')).text();
  assert.match(page, /TRON \(TRC20\)/);
  assert.ok(page.includes(TRC20));

  assert.equal((await save('trc20', `${TRC20.slice(0, -1)}7`)).headers.get('location'), '/account/referrals/wallet?n=wallet_checksum');
  assert.equal((await save('trc20', ERC20)).headers.get('location'), '/account/referrals/wallet?n=wallet_format');
  assert.equal((await save('btc', TRC20)).headers.get('location'), '/account/referrals/wallet?n=wallet_network');
  assert.equal((await save('trc20', '')).headers.get('location'), '/account/referrals/wallet?n=wallet_empty');
  assert.equal(store.payoutWallet('ref@example.com').address, TRC20, 'a refused address changes nothing');
  assert.match(await (await get('/account/referrals/wallet?n=wallet_checksum')).text(), /checksum does not match/);

  assert.equal((await save('erc20', ERC20)).headers.get('location'), '/account/referrals/wallet?n=wallet_saved');
  assert.equal(store.payoutWallet('ref@example.com').network, 'erc20');
  assert.equal((await post('/account/referrals/wallet', 'clear=1')).headers.get('location'), '/account/referrals/wallet?n=wallet_cleared');
  assert.equal(store.payoutWallet('ref@example.com'), null);
});

test('without a wallet a commission is still earned, and the referrer is told to add one', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  await pay(await checkout('buyer@example.com', { ref: code }));
  assert.match(mailTo('ref@example.com', 'referral-earned')[0].text, /no USDT wallet saved yet/);
  signInAs('ref@example.com');
  assert.match(await (await get('/account/referrals')).text(), /earned commission but no wallet is saved yet/);
});

test('referral pages need an account, and the team page needs the office key', async () => {
  assert.equal((await get('/account/referrals')).headers.get('location'), '/login?next=%2Faccount%2Freferrals');
  assert.equal((await post('/account/referrals/wallet', `network=trc20&address=${TRC20}`)).headers.get('location'), '/login?next=%2Faccount%2Freferrals%2Fwallet');
  for (const p of ['/account', '/account/previews', '/account/reports', '/account/referrals/earnings', '/account/referrals/wallet']) assert.match((await get(p)).headers.get('location'), /^\/login\?next=/, p);
  assert.match((await get('/myoffice/referrals')).headers.get('location'), /^\/myoffice\/login/);
  signInAs('ref@example.com'); // an account is not the office
  assert.match((await get('/myoffice/referrals')).headers.get('location'), /^\/myoffice\/login/);
  assert.match((await post('/myoffice/referrals/commission', 'usd=99')).headers.get('location'), /^\/myoffice\/login/);
  assert.equal(store.getSetting('referral_commission_cents'), null, 'a refused call changed nothing');
});

test('the team sets the commission in dollars, and pays by hand: marking paid records the transaction and the wallet, and emails the referrer once', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  await post('/account/referrals/wallet', `network=trc20&address=${TRC20}`);
  await pay(await checkout('buyer@example.com', { ref: code }));
  const [c] = store.commissionsFor('ref@example.com');

  await officeIn();
  let page = await (await get('/myoffice/referrals')).text();
  assert.match(page, /Now <b>USD 20<\/b>/);
  assert.match(page, /ref@example\.com/);
  assert.ok(page.includes(TRC20), 'the team sees the wallet to pay');

  assert.equal((await post('/myoffice/referrals/commission', 'usd=abc')).headers.get('location'), '/myoffice/referrals?n=commission_bad');
  assert.equal((await post('/myoffice/referrals/commission', 'usd=25.50')).headers.get('location'), '/myoffice/referrals?n=commission_saved');
  assert.equal(store.commissionCents(), 2550);
  assert.equal(store.commissionById(c.id).amount_cents, 2000, 'the commission already earned keeps its amount');
  page = await (await get('/myoffice/referrals')).text();
  assert.match(page, /Now <b>USD 25\.50<\/b>/);

  const paid = await post(`/myoffice/referrals/${c.id}/paid`, `tx=${'a'.repeat(64)}`);
  assert.equal(paid.headers.get('location'), '/myoffice/referrals?n=paid');
  const row = store.commissionById(c.id);
  assert.equal(row.status, 'paid');
  assert.equal(row.paid_tx, 'a'.repeat(64));
  assert.equal(row.paid_wallet, TRC20);
  assert.equal(row.paid_network, 'trc20');
  assert.equal(mailTo('ref@example.com', 'referral-paid').length, 1);

  await post(`/myoffice/referrals/${c.id}/paid`, 'tx=again'); // pressed twice
  assert.equal(store.commissionById(c.id).paid_tx, 'a'.repeat(64), 'the first record stands');
  assert.equal(mailTo('ref@example.com', 'referral-paid').length, 1);
  assert.equal((await post(`/myoffice/referrals/999/paid`, 'tx=x')).headers.get('location'), '/myoffice/referrals?n=missing');

  signInAs('ref@example.com');
  const mine = await (await get('/account/referrals/earnings')).text();
  assert.match(mine, /badge ok">Paid</);
  assert.ok(mine.includes('a'.repeat(64)), 'the referrer sees the transaction');
});

test('old databases are upgraded in place: the referral columns and tables are added without touching accounts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-ref-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec('CREATE TABLE users (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_login_at INTEGER); INSERT INTO users VALUES (\'old@example.com\', 1, 2);');
  old.close();
  const s = openStore(file);
  assert.equal(s.userByEmail('old@example.com').created_at, 1);
  assert.ok(s.referralCode('old@example.com'));
  assert.equal(s.commissionCents(), 2000);
  s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- Checkout records the referrer ----

test('checkout records whether a referrer was detected, paid or not, with who and how', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');

  const withRef = await checkout('buyer@example.com', { ref: code });
  let k = store.checkoutReferral(withRef);
  assert.equal(k.detected, 1);
  assert.equal(k.referrer_code, code);
  assert.equal(k.referrer_email, 'ref@example.com');
  assert.equal(k.source, 'link');
  assert.equal(k.report_id, REPORT);
  assert.equal(k.buyer_email, 'buyer@example.com');
  assert.equal(store.allCommissions().length, 0, 'nothing is paid yet, so no commission, but the checkout is on record');
  assert.ok(logs.some((l) => l.includes(`checkout ${withRef}`) && /referrer detected/.test(l)));

  const without = await checkout('other@example.com');
  k = store.checkoutReferral(without);
  assert.equal(k.detected, 0);
  assert.equal(k.referrer_code, null);
  assert.ok(logs.some((l) => l.includes(`checkout ${without}`) && /no referrer/.test(l)));

  await officeIn();
  const page = await (await get('/myoffice/referrals')).text();
  assert.match(page, /Referrer detected/);
  assert.match(page, /No referrer/);
  assert.match(page, /Not paid \(yet\)/);

  await pay(withRef);
  signInAs('x@example.com'); await officeIn();
  const after = await (await get('/myoffice/referrals')).text();
  assert.match(after, /badge ok">Paid</);
});

test('the commission follows our own checkout record even when Stripe\'s metadata has lost the referrer', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  const id = await checkout('buyer@example.com', { ref: code });
  delete sessions.get(id).metadata.referrer_code;
  delete sessions.get(id).metadata.referrer_source;
  await pay(id);
  const [c] = store.commissionsFor('ref@example.com');
  assert.equal(c.status, 'pending');
  assert.equal(c.source, 'link');
});

test('zero kill gates: if the checkout record cannot be written, the buyer still goes to Stripe and the referral still counts', async () => {
  signInAs('ref@example.com');
  const code = store.referralCode('ref@example.com');
  store.recordCheckoutReferral = () => { throw new Error('disk full'); };
  const id = await checkout('buyer@example.com', { ref: code });
  assert.equal(sessions.get(id).metadata.referrer_code, code);
  assert.ok(logs.some((l) => /could not record the referrer: disk full/.test(l)));
  await pay(id);
  assert.equal(store.commissionsFor('ref@example.com').length, 1);
});
