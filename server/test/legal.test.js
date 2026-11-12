// The standard footer and the legal pages. Nothing leaves the machine.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { openStore } from '../store.js';
import { createMailer } from '../mailer.js';
import { loadLegal, markdownToHtml, siteFooter, emailLegal, legalConfig, LEGAL_PAGES, FOOTER_LEGAL_LINKS, SHORT_DISCLAIMER } from '../legal.js';
import * as pages from '../pages.js';
import * as emails from '../emails.js';

test('the markdown reader fills known details, labels unknown ones, and keeps links', () => {
  const cfg = legalConfig({ LEGAL_OPERATOR_NAME: 'Ada Example', LEGAL_UPDATED: '2026-12-01' });
  const { html, unresolved } = markdownToHtml('Last updated: [DATE]\n\nOperated by [OWNER FULL LEGAL NAME], [SSM NO.]. See [Terms](/terms). Reply in [5] days. [DECIDE]', cfg);
  assert.match(html, /2026-12-01/);
  assert.match(html, /Ada Example/);
  assert.match(html, /<span class="tbc">to be confirmed<\/span>/); // SSM number not set: labelled, not hidden
  assert.match(html, /<a href="\/terms">Terms<\/a>/);
  assert.match(html, /in 5 days/);
  assert.doesNotMatch(html, /DECIDE|\[|\u0001/);
  assert.equal(unresolved, 1);
});

test('the markdown reader makes headings, lists, tables and escapes HTML', () => {
  const { html } = markdownToHtml('# Title\n\n## Sub\n\n- one\n- **two**\n\n1. a\n2. b\n\n| K | V |\n|---|---|\n| x | <script> |\n\n> note\n\n---\n', legalConfig({}));
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul><li>one<\/li><li><b>two<\/b><\/li><\/ul>/);
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(html, /<th>K<\/th>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<blockquote>note<\/blockquote>/);
});

test('all five legal pages load from disk and none is empty', () => {
  const all = loadLegal(legalConfig({}));
  assert.equal(all.size, 5);
  for (const p of LEGAL_PAGES) {
    const e = all.get(p.path);
    assert.ok(e.html.length > 500, `${p.path} has text`);
    assert.doesNotMatch(e.html, /<!--|\[OWNER|\[SSM|\[ADDRESS|\[DATE|\[DECIDE|\[CONFIRM/);
  }
  assert.equal(all.get('/legal').draft, true); // details missing: labelled, not hidden
  // every detail given: no label, no lawyer-review flag needed
  const full = loadLegal(legalConfig({ LEGAL_OPERATOR_NAME: 'Ada', LEGAL_SSM_NO: '1', LEGAL_ADDRESS: 'A St', LEGAL_TAX: 'not registered', LEGAL_UPDATED: '2026-12-01' }));
  assert.equal(full.get('/legal').draft, false);
  assert.equal(full.get('/legal').unresolved, 0);
});

test('a missing legal file gives a page that says so, never a crash', () => {
  const all = loadLegal(legalConfig({}), new URL('file:///nonexistent-dir/'));
  assert.match(all.get('/terms').html, /could not be loaded/);
});

test('every server page gets the standard footer with all legal links and the notice', () => {
  const html = pages.loginPage({ next: '/account' });
  assert.match(html, /class="sitefoot"/);
  for (const [href] of FOOTER_LEGAL_LINKS) assert.ok(html.includes(`href="${href}"`), `footer links ${href}`);
  assert.ok(html.includes('Built only from free public sources'));
  assert.ok(html.includes('corrections@mirrormirror.cloud'));
  // the checkout look, the invoice and the error page too
  assert.match(pages.errorPage('x'), /class="sitefoot"/);
  assert.match(pages.notFound(), /class="sitefoot"/);
  assert.match(pages.orderPage({ dive: { publicId: 'a', company: 'Co' }, price: 'USD 59', email: null }), /class="sitefoot"/);
  assert.match(siteFooter(legalConfig({ LEGAL_OPERATOR_NAME: 'Ada Example' })), /Operated by Ada Example/);
});

test('emails carry the notice and absolute legal links', () => {
  const m = emails.magicLink({ link: 'https://x.test/l', minutes: 15 });
  assert.match(m.html, /https:\/\/mirrormirror\.cloud\/terms/);
  assert.ok(m.html.includes(SHORT_DISCLAIMER));
  assert.match(emailLegal().text, /Terms: https:\/\/mirrormirror\.cloud\/terms/);
});

// ---- Through the real routes ----

let server, origin, store;
before(async () => {
  store = openStore(':memory:');
  const config = { stripeKey: 'sk_test_fake', webhookSecret: 'whsec_x', priceCents: 5900, currency: 'usd',
    siteDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site'), seller: { name: 'S', address: 'A', note: '' }, officeKey: 'k' };
  const mailer = createMailer({ apiKey: 'a', secretKey: 'b', from: 'admin@mirrormirror.cloud', store, dryRun: true, log: () => {} });
  server = http.createServer(createApp({ stripe: { webhooks: {}, checkout: { sessions: {} } }, hub: { findDive: async () => null }, config, store, mailer, now: Date.now, log: () => {} }));
  await new Promise((r) => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.closeAllConnections(); server?.close(); store?.close(); });

test('/legal /terms /privacy /disclaimer /corrections are served, public and indexable', async () => {
  for (const p of LEGAL_PAGES) {
    const res = await fetch(origin + p.path);
    assert.equal(res.status, 200, p.path);
    const body = await res.text();
    assert.ok(body.includes(`<title>${p.title} · MirrorMirror</title>`), `${p.path} title`);
    assert.doesNotMatch(body, /noindex/, `${p.path} is indexable`);
    assert.match(body, /class="sitefoot"/);
    assert.match(body, /Also read:/);
  }
});

test('the static homepage footer links to every legal page', async () => {
  const body = await (await fetch(origin + '/')).text();
  for (const [href] of FOOTER_LEGAL_LINKS) assert.ok(body.includes(`href="${href}"`), `homepage footer links ${href}`);
  assert.ok(body.includes('Built only from free public sources'));
});
