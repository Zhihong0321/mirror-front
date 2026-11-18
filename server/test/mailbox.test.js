// The mailbox: Mailjet posts inbound email to POST /mail/inbound?key=..., the team reads it at /myoffice/mail.
// Every post is kept: a wrong key or an odd body is labelled, never refused.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { openStore } from '../store.js';
import { parseInbound, inboundKeyFrom, keyMatches } from '../mailbox.js';

const KEY = inboundKeyFrom('mj-secret');
let server, origin, store, cookie = '';

const stop = () => { server?.closeAllConnections(); server?.close(); };
after(stop);

beforeEach(async () => {
  stop();
  store?.close();
  store = openStore(':memory:');
  const config = { stripeKey: 'sk_test_fake', webhookSecret: 'whsec_x', priceCents: 8900, currency: 'usd', officeKey: 'office-key-test',
    siteDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site'), seller: {}, mailInboundKey: KEY };
  const mailer = { configured: true, dryRun: false, send: async () => ({ ok: true }) };
  const app = createApp({ stripe: {}, hub: {}, config, store, mailer, now: () => Date.parse('2026-11-18T09:00:00Z'), log: () => {} });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
  cookie = '';
});

const get = (p) => fetch(origin + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const post = (p, body, headers = {}) => fetch(origin + p, { method: 'POST', body, redirect: 'manual', headers: { ...headers, ...(cookie ? { cookie } : {}) } });
async function officeIn() {
  const res = await post('/myoffice/login', 'key=office-key-test&next=%2Fmyoffice%2Fmail', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(res.status, 303);
  cookie = res.headers.get('set-cookie').split(';')[0];
}

const PDF = Buffer.from('%PDF-1.4 fake pdf bytes');
const payload = (over = {}) => ({
  Sender: 'bounce@client.example',
  Recipient: 'hello@mirrormirror.cloud',
  Date: '20261118T090000',
  From: 'Pat Client <pat@client.example>',
  Subject: 'Question about my report',
  Headers: { To: 'hello@mirrormirror.cloud', 'Reply-To': 'pat.reply@client.example', Subject: 'Question about my report' },
  Parts: [
    { Headers: { 'Content-Type': 'text/plain; charset=utf-8' }, ContentRef: 'Text-part' },
    { Headers: { 'Content-Type': 'text/html; charset=utf-8' }, ContentRef: 'Html-part' },
    { Headers: { 'Content-Type': 'application/pdf; name="brief.pdf"', 'Content-Disposition': 'attachment; filename="brief.pdf"' }, ContentRef: 'Attachment1' },
  ],
  'Text-part': 'Hi, when will my report be ready?',
  'Html-part': '<p>Hi, <b>when</b> will my report be ready?</p><script>alert(1)</script>',
  SpamAssassinScore: '0.4',
  Attachment1: PDF.toString('base64'),
  ...over,
});

test('a post from our Mailjet route is stored with its attachment and shown in the office mailbox', async () => {
  const res = await post(`/mail/inbound?key=${KEY}`, JSON.stringify(payload()), { 'content-type': 'application/json' });
  assert.equal(res.status, 200);
  const { id } = await res.json();
  const m = store.mailbox.get(id);
  assert.equal(m.verified, 1);
  assert.equal(m.recipient, 'hello@mirrormirror.cloud');
  assert.equal(m.mail_from, 'Pat Client <pat@client.example>');
  assert.equal(m.subject, 'Question about my report');
  assert.equal(m.reply_to, 'pat.reply@client.example');
  assert.equal(m.spam_score, 0.4);
  assert.equal(m.problem, null);
  assert.equal(m.read_at, null);
  assert.match(m.raw_json, /stored as an attachment/);
  assert.doesNotMatch(m.raw_json, new RegExp(PDF.toString('base64').slice(0, 20)));

  // The office pages need the office key.
  assert.equal((await get('/myoffice/mail')).status, 303);
  await officeIn();
  const list = await (await get('/myoffice/mail')).text();
  assert.match(list, /Question about my report/);
  assert.match(list, /1 new/);
  assert.match(list, /href="\/myoffice\/mail"[^>]*>Mailbox/);

  const page = await (await get(`/myoffice/mail/${id}`)).text();
  assert.match(page, /Pat Client &lt;pat@client.example&gt;/);
  assert.match(page, /brief\.pdf/);
  assert.match(page, /<iframe sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/); // the message's HTML only exists escaped, inside the sandboxed frame
  assert.match(page, /mailto:pat\.reply@client\.example/);
  assert.ok(store.mailbox.get(id).read_at, 'opening a message marks it read');

  const atts = store.mailbox.attachmentsOf(id);
  assert.equal(atts.length, 1);
  const file = await get(`/myoffice/mail/${id}/att/${atts[0].id}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/octet-stream');
  assert.match(file.headers.get('content-disposition'), /brief\.pdf/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PDF);

  const text = await (await get(`/myoffice/mail/${id}?view=text`)).text();
  assert.match(text, /when will my report be ready/);

  assert.equal((await post(`/myoffice/mail/${id}/unread`, '')).status, 303);
  assert.equal(store.mailbox.get(id).read_at, null);
});

test('a post with a wrong or missing key is still kept, labelled unverified', async () => {
  for (const q of ['?key=wrong', '']) {
    const res = await post(`/mail/inbound${q}`, JSON.stringify(payload({ Subject: `no key ${q}` })), { 'content-type': 'application/json' });
    assert.equal(res.status, 200);
    const m = store.mailbox.get((await res.json()).id);
    assert.equal(m.verified, 0);
    assert.match(m.problem, /unverified/);
  }
  await officeIn();
  const list = await (await get('/myoffice/mail')).text();
  assert.match(list, /unverified/);
  assert.equal((list.match(/no key/g) ?? []).length, 2);
});

test('a body that is not JSON is kept as text, labelled', async () => {
  const res = await post(`/mail/inbound?key=${KEY}`, 'From: someone\n\nplain body', { 'content-type': 'text/plain' });
  assert.equal(res.status, 200);
  const m = store.mailbox.get((await res.json()).id);
  assert.equal(m.verified, 1);
  assert.match(m.problem, /not JSON/);
  assert.match(m.text_body, /plain body/);
});

test('filter by address and search', async () => {
  await post(`/mail/inbound?key=${KEY}`, JSON.stringify(payload()), {});
  await post(`/mail/inbound?key=${KEY}`, JSON.stringify(payload({ Recipient: 'privacy@mirrormirror.cloud', Subject: 'Delete my data' })), {});
  await officeIn();
  const privacy = await (await get('/myoffice/mail?to=privacy%40mirrormirror.cloud')).text();
  assert.match(privacy, /Delete my data/);
  assert.doesNotMatch(privacy, /Question about my report/);
  const found = await (await get('/myoffice/mail?q=question')).text();
  assert.match(found, /Question about my report/);
  assert.doesNotMatch(found, /Delete my data/);
});

test('parseInbound never throws and labels what is odd', () => {
  const big = parseInbound(null, { verified: true, rawSize: 99_000_000, tooLarge: true });
  assert.match(big.problems.join(), /too large/);
  const arr = parseInbound('[1,2]', { verified: true });
  assert.match(arr.problems.join(), /not an object/);
  const bare = parseInbound('{}', { verified: true });
  assert.match(bare.problems.join(), /no text or HTML body/);
  assert.match(bare.problems.join(), /no recipient/);
  const unlisted = parseInbound(JSON.stringify({ Recipient: 'a@b', 'Text-part': 'x', InlineAttachment1: Buffer.from('img').toString('base64') }), { verified: true });
  assert.equal(unlisted.attachments.length, 1);
  assert.equal(unlisted.attachments[0].inline, true);
  assert.ok(keyMatches(KEY, KEY));
  assert.ok(!keyMatches('x', KEY));
  assert.ok(!keyMatches(KEY, ''));
});
