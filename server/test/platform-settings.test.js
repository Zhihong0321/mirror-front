// Platform settings (/myoffice/settings): the package price set from the office. Fake Stripe, fake report database.
// Nothing leaves the machine.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { createApp } from '../app.js';
import { openStore } from '../store.js';
import { createReportDb } from '../reportdb.js';
import { priceFromSetting, priceLabels, withPrice, STATIC_PRICE, PRICE_KEY } from '../platform-settings.js';

const SECRET = 'whsec_test_secret';
const REPORT = '0b6f3f1e-8f0a-4c52-9a53-0d1f6e0c7a11';
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const realStripe = new Stripe('sk_test_fake');
const clock = Date.parse('2026-11-18T10:00:00Z');

let sessions, server, origin, store, cookie, logs;

const fakeStripe = {
  webhooks: realStripe.webhooks,
  checkout: { sessions: {
    async create(params) { const s = { id: `cs_test_${sessions.size + 1}`, url: `https://checkout.stripe.test/${sessions.size + 1}`, payment_status: 'unpaid', ...params }; sessions.set(s.id, s); return s; },
    async retrieve(id) { if (!sessions.has(id)) throw new Error('No such checkout session'); return sessions.get(id); },
  } },
};

function fakeQuery(text, params) {
  if (/from v21_report /.test(text)) return Promise.resolve({ rows: params[0] === REPORT ? [{ company: 'Eternalgy Sdn Bhd', country: 'Malaysia', industry: 'Solar' }] : [] });
  if (/hub_setting/.test(text)) return Promise.resolve({ rows: [{ value: '59' }] });
  return Promise.resolve({ rows: [] });
}

async function start() {
  server?.closeAllConnections(); server?.close(); store?.close();
  store = openStore(':memory:');
  const reportDb = createReportDb({ query: fakeQuery });
  const config = { stripeKey: 'sk_test_fake', webhookSecret: SECRET, priceCents: 8900, currency: 'usd', reportHubUrl: 'https://factory.test', officeKey: 'office-key-test',
    siteDir: SITE, seller: { name: 'Test Seller', address: '1 St', note: '' }, analyticsTz: 'UTC' };
  const mailer = { configured: true, send: async () => ({ ok: true }) };
  const factory = { start: async () => ({ ok: true }) };
  server = http.createServer(createApp({ stripe: fakeStripe, hub: {}, config, store, mailer, reportDb, factory, now: () => clock, log: (m) => logs.push(m) }));
  await new Promise((r) => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(async () => { sessions = new Map(); cookie = ''; logs = []; await start(); });
after(() => { server?.closeAllConnections(); server?.close(); });

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const get = (p) => fetch(origin + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const post = (p, body) => fetch(origin + p, { method: 'POST', body, headers: { ...(cookie ? { cookie } : {}), ...FORM }, redirect: 'manual' });

function signInAs(email) {
  const token = crypto.randomBytes(24).toString('base64url');
  store.upsertUser(email, clock);
  store.createSession(crypto.createHash('sha256').update(token).digest('hex'), email, clock, 3_600_000);
  cookie = `mm_session=${token}`;
}
async function officeIn() {
  const res = await post('/myoffice/login', 'key=office-key-test&next=%2Fmyoffice%2Fsettings');
  assert.equal(res.status, 303);
  cookie = [cookie, res.headers.get('set-cookie').split(';')[0]].filter(Boolean).join('; ');
}

test('price rules: a saved price in cents wins, anything unusable falls back, labels read like the site', () => {
  assert.equal(priceFromSetting(null, 8900), 8900);
  assert.equal(priceFromSetting('', 8900), 8900);
  assert.equal(priceFromSetting('abc', 8900), 8900);
  assert.equal(priceFromSetting('0', 8900), 8900, 'a zero price would break Stripe: fall back');
  assert.equal(priceFromSetting('12.5', 8900), 8900);
  assert.equal(priceFromSetting('5900', 8900), 5900);
  assert.deepEqual(priceLabels(8900), { label: 'USD 89', short: '$89' });
  assert.deepEqual(priceLabels(8950, 'usd'), { label: 'USD 89.50', short: '$89.50' });
  assert.equal(withPrice('a USD 89 b $89 c $20 d USD 890 e 50–89', priceLabels(5900)), 'a USD 59 b $59 c $20 d USD 890 e 50–89');
  assert.equal(withPrice('USD 89', priceLabels(8900)), 'USD 89', 'same price: page unchanged');
});

test('the public pages still carry the price the server swaps (if this fails, update STATIC_PRICE)', () => {
  for (const f of ['index.html', 'refer.html']) {
    const page = fs.readFileSync(path.join(SITE, f), 'utf8');
    assert.ok(page.includes(STATIC_PRICE.label) || page.includes(STATIC_PRICE.short), `${f} shows ${STATIC_PRICE.label}`);
  }
});

test('settings page: office only, shows the Railway price until one is saved, and is in the office sidebar', async () => {
  let res = await get('/myoffice/settings');
  assert.ok([302, 303].includes(res.status));
  assert.match(res.headers.get('location'), /\/myoffice\/login/);
  await officeIn();
  res = await get('/myoffice/settings');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Platform settings/);
  assert.match(body, /USD 89/);
  assert.match(body, /Not saved here yet/);
  assert.match(body, /href="\/myoffice\/settings"/);
  const home = await (await get('/myoffice/users')).text();
  assert.match(home, /href="\/myoffice\/settings"[^>]*>.*Platform settings/s, 'every office page links to it');
});

test('saving a price: checkout charges it, and the order, home and refer pages show it', async () => {
  await officeIn();
  let res = await post('/myoffice/settings/price', 'usd=59.50');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/myoffice/settings?n=price_saved');
  assert.equal(store.getSetting(PRICE_KEY), '5950');
  const page = await (await get('/myoffice/settings')).text();
  assert.match(page, /USD 59\.50/);
  assert.match(page, /Saved here/);

  signInAs('buyer@example.com');
  res = await post('/order/checkout', `report=${REPORT}`);
  assert.equal(res.status, 303);
  const s = [...sessions.values()].at(-1);
  assert.equal(s.line_items[0].price_data.unit_amount, 5950);

  const order = await (await get(`/order?report=${REPORT}`)).text();
  assert.match(order, /Pay USD 59\.50 with/, 'the pay button (the "worth" values on this page stay as they are)');

  cookie = '';
  const home = await (await get('/')).text();
  assert.match(home, /USD 59\.50/);
  assert.doesNotMatch(home, /USD 89(?![\d.])/);
  const refer = await (await get('/refer')).text();
  assert.match(refer, /\$59\.50/);
  assert.doesNotMatch(refer, /\$89(?![\d.])|USD 89(?![\d.])/);
});

test('a bad price is refused with a message and changes nothing; reset goes back to the Railway price', async () => {
  await officeIn();
  for (const bad of ['abc', '0', '0.50', '-5', '']) {
    const res = await post('/myoffice/settings/price', `usd=${encodeURIComponent(bad)}`);
    assert.equal(res.headers.get('location'), '/myoffice/settings?n=price_bad', bad);
  }
  assert.equal(store.getSetting(PRICE_KEY), null);
  await post('/myoffice/settings/price', 'usd=120');
  assert.equal(store.getSetting(PRICE_KEY), '12000');
  const res = await post('/myoffice/settings/price', 'reset=1');
  assert.equal(res.headers.get('location'), '/myoffice/settings?n=price_reset');
  assert.equal(store.getSetting(PRICE_KEY), null);
  assert.match(await (await get('/myoffice/settings')).text(), /Not saved here yet/);
});

test('a broken saved value never stops a sale: checkout uses the Railway price and the page says so', async () => {
  store.setSetting(PRICE_KEY, 'garbage', clock);
  await officeIn();
  const page = await (await get('/myoffice/settings')).text();
  assert.match(page, /not a usable price/);
  signInAs('buyer@example.com');
  const res = await post('/order/checkout', `report=${REPORT}`);
  assert.equal(res.status, 303);
  assert.equal([...sessions.values()].at(-1).line_items[0].price_data.unit_amount, 8900);
});

test('without the office key the price cannot be changed', async () => {
  const res = await post('/myoffice/settings/price', 'usd=1');
  assert.ok([302, 303].includes(res.status));
  assert.match(res.headers.get('location'), /\/myoffice\/login/);
  assert.equal(store.getSetting(PRICE_KEY), null);
});
