// Visitor analytics: the page hook records a view and adds the script; the beacon fills in time on page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openStore } from '../store.js';
import { createTracker, parseUA, safePath, addScript } from '../visits.js';
import { visitorsPage, duration } from '../visitors-page.js';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

test('user agents', () => {
  assert.deepEqual(parseUA(CHROME_WIN), { browser: 'Chrome 131', os: 'Windows', device: 'desktop', isBot: false });
  assert.deepEqual(parseUA(IPHONE), { browser: 'Safari 18', os: 'iOS', device: 'mobile', isBot: false });
  const bot = parseUA('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
  assert.equal(bot.isBot, true);
  assert.equal(bot.device, 'bot');
  assert.equal(parseUA('').isBot, true);
});

test('secrets never stored from a URL', () => {
  assert.equal(safePath(new URL('http://x/login/verify?token=abc&next=%2Faccount')), '/login/verify?token=%28hidden%29&next=%2Faccount');
  assert.equal(safePath(new URL('http://x/p/1')), '/p/1');
});

test('script goes before </body>, or at the end when there is none', () => {
  assert.match(addScript('<html><body>hi</body></html>', 'abcdefgh12'), /hi<script>.*"abcdefgh12".*<\/script><\/body><\/html>$/s);
  assert.match(addScript('plain', 'abcdefgh12'), /^plain<script>/);
});

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('a page view is recorded with location and device, and the beacon adds time on page', async () => {
  const store = openStore(':memory:');
  let clock = 1_000_000;
  const geo = { configured: true, lookup: (ip) => (ip === '175.139.1.1' ? { country: 'Malaysia', countryCode: 'MY', city: 'Kuala Lumpur', region: 'Kuala Lumpur' } : {}) };
  const tracker = createTracker({ visits: store.visits, geo, currentEmail: () => 'me@example.com', now: () => clock, log: () => {} });
  const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => r(s)); });
  const app = await serve(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    tracker.wrap(req, res, url);
    if (req.method === 'POST' && url.pathname === '/api/v') return tracker.beacon(req, res, readBody);
    if (url.pathname === '/myoffice/x') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<body>admin</body>'); }
    if (url.pathname === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (url.pathname === '/stored') { res.asStored = true; res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<body>exact</body>'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(Buffer.from('<html><body>Hello</body></html>'));
  });
  try {
    const page = await (await fetch(`${app.origin}/?utm_source=li`, { headers: { 'user-agent': MAC_SAFARI, 'x-forwarded-for': '175.139.1.1, 10.0.0.1', referer: 'https://www.linkedin.com/feed/' } })).text();
    const viewId = /var v="([^"]+)"/.exec(page)?.[1];
    assert.ok(viewId, 'script added');
    assert.match(page, /^<html><body>Hello<script>/);

    // Not recorded or changed: admin pages, non-HTML. Recorded but unchanged: a page sent as stored.
    assert.equal(await (await fetch(`${app.origin}/myoffice/x`)).text(), '<body>admin</body>');
    assert.equal(await (await fetch(`${app.origin}/json`)).text(), '{}');
    assert.equal(await (await fetch(`${app.origin}/stored`)).text(), '<body>exact</body>');

    clock += 5000;
    const beacon = (b) => fetch(`${app.origin}/api/v`, { method: 'POST', body: JSON.stringify(b) });
    assert.equal((await beacon({ v: viewId, vid: 'abc123xyz', ms: 0, sw: 1024, sh: 1366, tp: 5, lang: 'en-MY', tz: 'Asia/Kuala_Lumpur', title: 'Home' })).status, 204);
    await beacon({ v: viewId, ms: 42_000 });
    await beacon({ v: viewId, ms: 10 }); // an earlier, smaller report never lowers the time
    assert.equal((await beacon({ v: 'nope' })).status, 204);
    assert.equal((await fetch(`${app.origin}/api/v`, { method: 'POST', body: 'not json' })).status, 204);

    const rows = store.visits.log({ since: 0 });
    assert.equal(rows.length, 2);
    const v = rows.find((r) => r.view_id === viewId);
    assert.equal(v.ip, '175.139.1.1');
    assert.equal(v.city, 'Kuala Lumpur');
    assert.equal(v.country_code, 'MY');
    assert.equal(v.os, 'iPadOS'); // Mac user agent + touch screen
    assert.equal(v.device, 'tablet');
    assert.equal(v.active_ms, 42_000);
    assert.equal(v.screen, '1024x1366');
    assert.equal(v.visitor_id, 'abc123xyz');
    assert.equal(v.referrer_host, 'linkedin.com');
    assert.equal(v.path, '/?utm_source=li');
    assert.equal(v.account_email, 'me@example.com');
    assert.equal(v.js, 1);
    assert.equal(rows.find((r) => r.path === '/stored').js, 0);

    const s = store.visits.summary({ since: 0 });
    assert.equal(s.views, 2);
    assert.equal(store.visits.top({ since: 0 }, 'country')[0].k, 'Malaysia');

    const html = visitorsPage({ email: 'me@example.com', days: 7, filter: {}, geoOn: true,
      data: { summary: s, top: { path: store.visits.top({ since: 0 }, 'path') }, rows } });
    assert.match(html, /175\.139\.1\.1/);
    assert.match(html, /Kuala Lumpur/);
    assert.match(html, /42s/);
    assert.match(html, /no script/);
  } finally { app.close(); store.close(); }
});

test('the visitors page still renders when the log cannot be read', () => {
  const html = visitorsPage({ email: 'a@b.c', days: 7, data: null, error: 'disk gone' });
  assert.match(html, /could not be read just now: disk gone/);
});

test('durations', () => {
  assert.equal(duration(400), '<1s');
  assert.equal(duration(83_000), '1m 23s');
  assert.equal(duration(3_720_000), '1h 2m');
  assert.equal(duration(null), '');
});

test('per page: one key per page, its own numbers and people, scroll depth kept at its furthest', async () => {
  const { pageKey } = await import('../visits.js');
  assert.equal(pageKey('/P/0F0E0D0C-0000-4000-8000-00000000ABCD/'), '/p/0f0e0d0c-0000-4000-8000-00000000abcd');
  assert.equal(pageKey('/order/'), '/order');
  assert.equal(pageKey(''), '/');

  const store = openStore(':memory:');
  const v = store.visits;
  const P = '/p/0f0e0d0c-0000-4000-8000-00000000abcd';
  const rec = (viewId, pageKeyV, visitorIp, at) => v.record({ viewId, at, path: pageKeyV, pageKey: pageKeyV, ip: visitorIp, ua: CHROME_WIN, browser: 'Chrome 131', os: 'Windows', device: 'desktop', city: 'Ipoh', countryCode: 'MY' });
  rec('aaaaaaaa1', P, '1.1.1.1', 1000);
  rec('aaaaaaaa2', P, '1.1.1.1', 2000);
  rec('aaaaaaaa3', P, '2.2.2.2', 3000);
  rec('aaaaaaaa4', '/', '2.2.2.2', 4000);
  v.beacon('aaaaaaaa1', { visitorId: 'vis1aaaa', ms: 30_000, scroll: 80 }, 1500);
  v.beacon('aaaaaaaa1', { ms: 31_000, scroll: 40 }, 1600); // scrolling back up never lowers the depth
  v.beacon('aaaaaaaa2', { visitorId: 'vis1aaaa', ms: 10_000, scroll: 100 }, 2500);

  const pages = v.pages({ since: 0 });
  const p = pages.find((x) => x.page === P);
  assert.equal(p.views, 3);
  assert.equal(p.visitors, 2);
  assert.equal(p.total_ms, 41_000);
  assert.equal(v.pages({ since: 0, prefix: '/p/' }).length, 1);
  assert.equal(v.log({ since: 0, page: P }).length, 3);
  assert.equal(v.log({ since: 0, page: P }).find((r) => r.view_id === 'aaaaaaaa1').scroll_pct, 80);

  const people = v.people({ since: 0, page: P });
  assert.equal(people.length, 2);
  const one = people.find((x) => x.visitor_id === 'vis1aaaa');
  assert.equal(one.views, 2);
  assert.equal(one.max_scroll, 100);
  assert.equal(one.place, 'Ipoh, MY');

  const html = visitorsPage({ view: 'page', email: 'a@b.c', days: 0, filter: { page: P }, pageInfo: { company: 'Acme Sdn Bhd', sub: 'Free preview' },
    data: { summary: v.summary({ since: 0, page: P }), people, top: {}, rows: v.log({ since: 0, page: P }) } });
  assert.match(html, /Acme Sdn Bhd: tracker log/);
  assert.match(html, /People who viewed it/);
  assert.match(html, /scrolled 80%/);

  const list = visitorsPage({ view: 'previews', email: 'a@b.c', days: 0, filter: {},
    data: { previews: [{ ...p, label: 'Acme Sdn Bhd' }, { page: '/p/11111111-0000-4000-8000-000000000000', label: 'Never Opened Bhd' }] } });
  assert.match(list, /Never Opened Bhd/);
  assert.match(list, /never viewed/);
  assert.equal((list.match(/Tracker log/g) ?? []).length, 2);
  store.close();
});

test('an icon or image request that gets an HTML error page is not a page view', async () => {
  const store = openStore(':memory:');
  const tracker = createTracker({ visits: store.visits, geo: null, log: () => {} });
  const app = await serve((req, res) => {
    tracker.wrap(req, res, new URL(req.url, 'http://local'));
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<body>not found</body>');
  });
  try {
    assert.equal(await (await fetch(`${app.origin}/favicon.ico`)).text(), '<body>not found</body>');
    assert.equal(await (await fetch(`${app.origin}/x`, { headers: { 'sec-fetch-dest': 'image' } })).text(), '<body>not found</body>');
    await (await fetch(`${app.origin}/p/not-ready`, { headers: { 'sec-fetch-dest': 'document' } })).text();
    const rows = store.visits.log({ since: 0 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 404);
  } finally { app.close(); store.close(); }
});

test('users: the list counts each account, the profile shows its visits from before sign-in too', async () => {
  const { usersListPage, userPage } = await import('../users-page.js');
  const store = openStore(':memory:');
  store.upsertUser('a@x.com', 1000);
  store.upsertUser('b@x.com', 2000);
  store.addPreviewRequest({ email: 'a@x.com', company: 'Acme', who: 'mine' }, 1100);
  const v = store.visits;
  v.record({ viewId: 'bbbbbbbb1', at: 900, path: '/', pageKey: '/', ip: '1.1.1.1' }); // before sign-in
  v.beacon('bbbbbbbb1', { visitorId: 'browserA1' }, 950);
  v.record({ viewId: 'bbbbbbbb2', at: 1200, path: '/account', pageKey: '/account', ip: '1.1.1.1', accountEmail: 'a@x.com' });
  v.beacon('bbbbbbbb2', { visitorId: 'browserA1', ms: 5000 }, 1300);
  v.record({ viewId: 'bbbbbbbb3', at: 1300, path: '/', pageKey: '/', ip: '9.9.9.9' }); // someone else

  const users = store.allUsers();
  assert.equal(users.length, 2);
  const a = users.find((u) => u.email === 'a@x.com');
  assert.equal(a.previews, 1);
  assert.equal(a.open_previews, 1);
  assert.equal(a.views, 1);
  assert.match(usersListPage({ email: 'me@x.com', users, total: 2 }), /a@x\.com[\s\S]*1 waiting/);

  const rows = v.log({ since: 0, account: 'a@x.com' });
  assert.deepEqual(rows.map((r) => r.view_id).sort(), ['bbbbbbbb1', 'bbbbbbbb2']);
  const html = userPage({ email: 'me@x.com', who: 'a@x.com', tz: 'UTC', d: {
    user: store.userByEmail('a@x.com'), previews: store.previewsFor('a@x.com'), orders: [], mail: [], sessions: 0,
    visits: { summary: v.summary({ since: 0, account: 'a@x.com' }), rows, visitorIds: ['browserA1'] } } });
  assert.match(html, /before sign-in/);
  assert.match(html, /Acme/);
  assert.match(html, /visitor browserA1/);
  // An email that never signed in still gets a page, labelled.
  assert.match(userPage({ email: 'me@x.com', who: 'nobody@x.com', d: {} }), /never signed in/);
  store.close();
});
