// Tests of the report pages: the free preview pass-through, the full report by run status, and the payment check.
// A fake report database and a fake factory stand in for Postgres and the hub. Nothing leaves the machine.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { openStore } from '../store.js';
import { createReportDb } from '../reportdb.js';
import { chooseView } from '../reports.js';

const REPORT = '0b6f3f1e-8f0a-4c52-9a53-0d1f6e0c7a11';
const OTHER = '11111111-2222-4333-8444-555555555555';
const FACTORY = 'https://factory.test';
const REPORT_PAGE = '<!doctype html><html><head><title>Full</title></head><body><h1>The stored report</h1><script>window.x=1</script></body></html>';

let runs, htmlByRun, queries, factory, dbDown, server, origin, store, cookie;
const clock = Date.parse('2026-11-11T10:00:00Z');

let fakeQueryHook = null; // a test may answer the preview's v21_raw and price queries; null = "unexpected query"
function fakeQuery(text, params) {
  queries.push(text);
  if (dbDown) return Promise.reject(new Error('connection refused'));
  if (fakeQueryHook) {
    try { const out = fakeQueryHook(text, params); if (out) return Promise.resolve(out); } catch (e) { return Promise.reject(e); }
  }
  if (/from v21_report /.test(text)) return Promise.resolve({ rows: params[0] === REPORT ? [{ company: 'Eternalgy Sdn Bhd', country: 'Malaysia', industry: 'Solar', website: 'https://eternalgy.me' }] : [] });
  if (/select run_id, status/.test(text)) return Promise.resolve({ rows: params[0] === REPORT ? runs : [] });
  if (/select report_html/.test(text)) {
    const [runId, reportId] = params;
    return Promise.resolve({ rows: reportId === REPORT && htmlByRun[runId] ? [{ report_html: htmlByRun[runId] }] : [] });
  }
  return Promise.reject(new Error(`unexpected query: ${text}`));
}

const run = (status, extra = {}) => ({ run_id: `run-${status}`, status, stage: '', created_at: '', finished_at: null, has_html: false, ...extra });

async function start() {
  server?.closeAllConnections(); server?.close(); store?.close();
  store = openStore(':memory:');
  const config = { stripeKey: 'sk_test_fake', webhookSecret: 'x', priceCents: 8900, currency: 'usd', reportHubUrl: FACTORY,
    siteDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site') };
  const app = createApp({ stripe: {}, hub: {}, config, store, mailer: { send: async () => ({ ok: true }) }, reportDb: createReportDb({ query: fakeQuery }),
    reportFetch: (url) => factory(String(url)), now: () => clock, log: () => {} });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(async () => {
  runs = []; htmlByRun = {}; queries = []; dbDown = false; cookie = '';
  factory = async () => new Response('<html><body>FACTORY PREVIEW</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  await start();
});
after(() => { server?.closeAllConnections(); server?.close(); });

const get = (p) => fetch(origin + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });

// Signs the account in without email: a session straight in the store, the way accounts.js stores one.
async function signInAs(email) {
  const { createHash, randomBytes } = await import('node:crypto');
  const token = randomBytes(24).toString('base64url');
  store.upsertUser(email, clock);
  store.createSession(createHash('sha256').update(token).digest('hex'), email, clock, 3_600_000);
  cookie = `mm_session=${token}`;
}
const buy = (email, reportId = REPORT) => store.recordOrder({ stripeSessionId: `cs_${email}_${reportId}`, email, amountCents: 8900, currency: 'usd', paidAt: clock, reportId });

test('chooseView picks the right run for every status', () => {
  assert.equal(chooseView([]).kind, 'none');
  assert.deepEqual(chooseView([run('done', { has_html: true })]).label, null);
  assert.match(chooseView([run('incomplete', { has_html: true })]).label, /could not be completed/);
  assert.equal(chooseView([run('running')]).kind, 'progress');
  assert.equal(chooseView([run('queued')]).kind, 'progress');
  assert.equal(chooseView([run('failed')]).kind, 'failed');
  assert.equal(chooseView([run('weird')]).kind, 'unknown');
  // a page stored under an odd status is still shown, with a label
  const odd = chooseView([run('weird', { has_html: true })]);
  assert.equal(odd.kind, 'report'); assert.match(odd.label, /weird/);
  // a newer run that failed or is still going falls back to an older finished page
  const older = run('done', { run_id: 'old', has_html: true });
  assert.equal(chooseView([run('failed'), older]).run.run_id, 'old');
  assert.match(chooseView([run('failed'), older]).label, /could not be completed/);
  assert.match(chooseView([run('running'), older]).label, /being prepared/);
});

test('free preview: the factory page is passed through as is, noindex and not cached', async () => {
  const res = await get(`/p/${REPORT}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<html><body>FACTORY PREVIEW</body></html>');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(res.headers.get('cache-control'), /no-store/);
});

test('free preview: a factory 404, 503 or crash shows a friendly page, never a blank or raw error', async () => {
  for (const make of [() => new Response('nope', { status: 404 }), () => new Response('busy', { status: 503 }), () => { throw new Error('boom'); }]) {
    factory = async () => make();
    const res = await get(`/p/${REPORT}`);
    assert.ok([404, 503].includes(res.status));
    const body = await res.text();
    assert.match(body, /being prepared/);
    assert.doesNotMatch(body, /boom|nope|busy/);
  }
});

test('free preview: a link that is not a report id is not sent to the factory', async () => {
  let called = false; factory = async () => { called = true; return new Response('x'); };
  assert.equal((await get('/p/not-a-uuid')).status, 404);
  assert.equal(called, false);
});

test('full report is public (owner, 2026-11-12): no sign-in and no order needed, on the page and on /raw', async () => {
  runs = [run('done', { has_html: true })]; htmlByRun['run-done'] = REPORT_PAGE;
  for (const p of [`/r/${REPORT}`, `/r/${REPORT}/raw?run=run-done`]) {
    const res = await get(p); // not signed in
    assert.equal(res.status, 200, p);
    assert.equal(await res.text(), REPORT_PAGE);
  }
  await signInAs('stranger@example.com'); // signed in, no order for this report
  assert.equal((await get(`/r/${REPORT}`)).status, 200);
});

test('free preview: the banner states the Preview Scan total and the Full Scan total as two separate numbers, and never sizes the full report from the preview', async () => {
  const c = (id) => ({ evidence_id: `E-${id}`, quoted_text: `QUOTE-${id}`, source_url: `https://register.example/${id}` });
  const f = (id) => ({ id, kind: 'problem', topic: 'email', title: `T${id}`, statement: 'No DMARC record', evidence: [c(id)], why_it_matters: 'W', identity: 'x', confidence: 'high' });
  const s2 = { input: { company: 'Beispiel GmbH', country: 'Malaysia', industry: 'Solar' }, baseline: { websites: [] }, contradictions: [], take_note: [], suggestions: [],
    conclusive_findings: [f('f1'), f('f2'), f('f3')] };
  const report = { language: 'en', created_at: '2026-11-08T00:00:00Z', summary: [], step2_row_id: 7 };
  fakeQueryHook = (text, params) => {
    if (/kind = 'report'/.test(text)) return { rows: [{ payload: report }] };
    if (/where report_id = \$1 and id = \$2/.test(text)) return { rows: params[1] === 7 ? [{ payload: s2 }] : [] };
    if (/hub_setting/.test(text)) return { rows: [{ value: '59' }] };
    return null;
  };
  try {
    const body = await (await get(`/p/${REPORT}`)).text();
    assert.match(body, /3 findings: Preview Scan \(this page\)<br>\?\? findings: Full Scan \(the Full Report\)/);
    assert.match(body, /2 Preview Scan findings are listed above by title only/);
    assert.match(body, /its total is not yet known and is expected to be higher/);
    assert.match(body, />Order the Full Report&nbsp;→</);
    assert.doesNotMatch(body, /Get all \d+ in full|three things missing/);
  } finally { fakeQueryHook = null; }
});

test('free preview: drawn from the database rows with the exported template; falls back to the factory when it cannot be', async () => {
  const c = (id) => ({ evidence_id: `E-${id}`, quoted_text: `QUOTE-${id}`, source_url: `https://register.example/${id}` });
  const s2 = { input: { company: 'Beispiel GmbH', country: 'Malaysia', industry: 'Solar' }, baseline: { websites: [] }, contradictions: [], take_note: [], suggestions: [],
    conclusive_findings: [{ id: 'f1', kind: 'problem', topic: 'email', title: 'T', statement: 'No DMARC record', evidence: [c('f1')], why_it_matters: 'W', identity: 'x', confidence: 'high' }] };
  const report = { language: 'en', created_at: '2026-11-08T00:00:00Z', summary: [], step2_row_id: 7 };
  fakeQueryHook = (text, params) => {
    if (/kind = 'report'/.test(text)) return { rows: [{ payload: report }] };
    if (/where report_id = \$1 and id = \$2/.test(text)) return { rows: params[1] === 7 ? [{ payload: s2 }] : [] };
    if (/hub_setting/.test(text)) return { rows: [{ value: '59' }] };
    return null;
  };
  try {
    const res = await get(`/p/${REPORT}`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /Beispiel GmbH/);
    assert.match(body, /class="legalrow"/); // the standard legal notice and links are on the preview too
    assert.match(body, /href="\/terms"/);
    assert.match(body, /\$89/); // the site price (what checkout charges) wins over the report database setting, which says 59 here
    assert.doesNotMatch(body, /full report, \$59/);
    assert.match(body, new RegExp(`order\\?report=${REPORT}`));
    assert.doesNotMatch(body, /FACTORY PREVIEW/);
    // the rows cannot be read: the factory's page is shown instead
    fakeQueryHook = () => { throw new Error('boom'); };
    assert.match(await (await get(`/p/${REPORT}`)).text(), /FACTORY PREVIEW/);
  } finally { fakeQueryHook = null; }
});

test('full report: a done run is returned exactly as stored, alone, noindex and private', async () => {
  runs = [run('done', { has_html: true })]; htmlByRun['run-done'] = REPORT_PAGE;
  buy('buyer@example.com'); await signInAs('buyer@example.com');
  const res = await get(`/r/${REPORT.toUpperCase()}`); // the id is accepted in either case
  assert.equal(res.status, 200);
  assert.equal(await res.text(), REPORT_PAGE);
  assert.match(res.headers.get('content-type'), /text\/html; charset=utf-8/);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const list = queries.find((q) => /order by/.test(q));
  assert.match(list, /report_html is not null/);
  assert.doesNotMatch(list.replace(/\(report_html is not null[^)]*\)/, ''), /report_html/, 'the page body is never read in the run list');
});

test('full report: an incomplete run shows its label above the stored page', async () => {
  runs = [run('incomplete', { has_html: true })]; htmlByRun['run-incomplete'] = REPORT_PAGE;
  buy('buyer@example.com'); await signInAs('buyer@example.com');
  const frame = await (await get(`/r/${REPORT}`)).text();
  assert.match(frame, /Some parts of this report could not be completed/);
  const src = /<iframe src="([^"]+)"/.exec(frame)[1].replaceAll('&amp;', '&');
  const raw = await get(src);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get('content-security-policy'), 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox');
  assert.equal(await raw.text(), REPORT_PAGE);
});

test('full report: running shows progress and refreshes; failed says so without the raw error; no row says not started', async () => {
  buy('buyer@example.com'); await signInAs('buyer@example.com');
  runs = [run('running', { stage: 'Chapter 2' })];
  let body = await (await get(`/r/${REPORT}`)).text();
  assert.match(body, /being prepared/); assert.match(body, /Chapter 2/); assert.match(body, /http-equiv="refresh" content="20"/);

  runs = [run('failed')];
  body = await (await get(`/r/${REPORT}`)).text();
  assert.match(body, /Something went wrong with your report/); assert.match(body, /Eternalgy Sdn Bhd/);

  runs = [];
  body = await (await get(`/r/${REPORT}`)).text();
  assert.match(body, /has not started yet/);
});

test('full report: a newer failed or running run falls back to the older finished page with a note', async () => {
  runs = [run('failed'), run('done', { run_id: 'old', has_html: true })]; htmlByRun.old = REPORT_PAGE;
  buy('buyer@example.com'); await signInAs('buyer@example.com');
  const frame = await (await get(`/r/${REPORT}`)).text();
  assert.match(frame, /last finished version/);
  assert.match(frame, /run=old/);
});

test('full report: the raw page only serves a run of this report', async () => {
  runs = [run('done', { has_html: true })]; htmlByRun['run-done'] = REPORT_PAGE;
  buy('buyer@example.com'); buy('buyer@example.com', OTHER); await signInAs('buyer@example.com');
  assert.equal((await get(`/r/${OTHER}/raw?run=run-done`)).status, 404); // that run belongs to REPORT, not OTHER
  assert.equal((await get(`/r/${REPORT}/raw`)).status, 404);
});

test('full report: when the report database is down the buyer gets a friendly page, and the site does not crash', async () => {
  dbDown = true;
  buy('buyer@example.com'); await signInAs('buyer@example.com');
  const res = await get(`/r/${REPORT}`);
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.match(body, /cannot load your report right now/);
  assert.doesNotMatch(body, /connection refused/);
  dbDown = false; runs = [run('done', { has_html: true })]; htmlByRun['run-done'] = REPORT_PAGE;
  assert.equal((await get(`/r/${REPORT}`)).status, 200);
});

test('the report database connection is read only and never reads the factory\'s internal tables', async () => {
  runs = [run('done', { has_html: true })]; htmlByRun['run-done'] = REPORT_PAGE;
  buy('buyer@example.com'); await signInAs('buyer@example.com');
  await get(`/r/${REPORT}`);
  for (const q of queries) {
    assert.match(q.trim(), /^select/i);
    assert.doesNotMatch(q, /v21_raw|v21_deeper_lane|\blog\b|\berror\b|blocked_html|gate_failures/);
  }
});

test('an order records the report it bought and the account page links to it', async () => {
  buy('buyer@example.com');
  await signInAs('buyer@example.com');
  const body = await (await get('/account/reports')).text();
  assert.match(body, new RegExp(`href="/r/${REPORT}"`));
});
