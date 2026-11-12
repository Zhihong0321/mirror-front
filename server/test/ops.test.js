// Tests of the ops API (ops.js): token check, log buffer, read-only SQL guards and row limits.
// Nothing leaves the machine: the report database is a fake, the site database is in memory.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createOps, createLogBuffer, checkReadSql } from '../ops.js';
import { openStore } from '../store.js';
import { createReportDb } from '../reportdb.js';

const TOKEN = 'ops-test-token-0123456789';
const store = openStore(':memory:');
const reportRows = [];
const reportDb = createReportDb({ query: async (text, params) => { reportRows.push(text); return { rows: [{ text, params }] }; } });
const logs = createLogBuffer();

const ops = createOps({ token: TOKEN, store, reportDb, logs, info: { build: { commit: 'abc' }, settingsSet: { OPS_TOKEN: true } } });
const offOps = createOps({ token: '', store, reportDb, logs });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const handler = url.pathname.startsWith('/off') ? offOps : ops;
  handler.handle(req, res, url);
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, path, { body, token = TOKEN } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

const sql = (db, text, extra = {}) => call('POST', '/ops/api/sql', { body: { db, sql: text, ...extra } });

test('ops is off without OPS_TOKEN: every route answers 503', async () => {
  const res = await fetch(`${base}/off/ops/api/status`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /OPS_TOKEN/);
});

test('ops needs the bearer token: missing or wrong gives 401, the right one works', async () => {
  assert.equal((await call('GET', '/ops/api/status', { token: '' })).status, 401);
  assert.equal((await call('GET', '/ops/api/status', { token: 'nope' })).status, 401);
  const ok = await call('GET', '/ops/api/status');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.build.commit, 'abc');
  assert.ok(ok.body.site_db.tables.some((t) => t.name === 'users'));
  assert.equal(ok.body.report_db.configured, true);
});

test('status never shows setting values, only whether they are set', async () => {
  const text = JSON.stringify((await call('GET', '/ops/api/status')).body);
  assert.ok(!text.includes(TOKEN));
});

test('logs: keeps what was printed, filters by level, text and seq', () => {
  const buf = createLogBuffer();
  const printed = [];
  const fake = { log: (...a) => printed.push(['log', a]), warn: (...a) => printed.push(['warn', a]), error: (...a) => printed.push(['error', a]), info() {}, debug() {} };
  buf.install(fake);
  fake.log('hello', { a: 1 });
  fake.warn('careful');
  fake.error(new Error('boom'));
  assert.equal(printed.length, 3, 'the original console still prints');
  assert.equal(buf.query().count, 3);
  assert.equal(buf.query({ level: 'warn' }).count, 2);
  assert.equal(buf.query({ level: 'error' }).lines[0].text.startsWith('Error: boom'), true);
  assert.equal(buf.query({ match: 'HELLO' }).lines[0].text, 'hello {"a":1}');
  const since = buf.query({ since: 1 });
  assert.deepEqual(since.lines.map((l) => l.seq), [2, 3]);
});

test('logs: the ring keeps only the newest lines', () => {
  const buf = createLogBuffer({ max: 3 });
  for (let i = 0; i < 10; i++) buf.push('info', [`line ${i}`]);
  const q = buf.query({ limit: 50 });
  assert.equal(q.kept, 3);
  assert.deepEqual(q.lines.map((l) => l.text), ['line 7', 'line 8', 'line 9']);
});

test('logs route: level must be a known level', async () => {
  assert.equal((await call('GET', '/ops/api/logs?level=loud')).status, 400);
  const ok = await call('GET', '/ops/api/logs?limit=5');
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.body.lines));
});

test('sql on the site database: a select works and returns its columns', async () => {
  const r = await sql('site', 'select count(*) as n from users');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.columns, ['n']);
  assert.equal(r.body.rows[0].n, 0);
  assert.equal(r.body.truncated, false);
});

test('sql on the site database: writes are refused and change nothing', async () => {
  const before = store.tables().find((t) => t.name === 'users').rows;
  for (const bad of [
    'delete from users',
    'insert into users (email, created_at) values (\'a@b.c\', 1)',
    'pragma query_only = off',
    'select 1; delete from users',
    'with x as (select 1) delete from users',
    'drop table users',
    '-- note\ninsert into users (email, created_at) values (\'x\', 1)',
  ]) {
    const r = await sql('site', bad);
    assert.equal(r.status, 400, `should refuse: ${bad}`);
  }
  assert.equal(store.tables().find((t) => t.name === 'users').rows, before);
  const again = await sql('site', 'select count(*) as n from users');
  assert.equal(again.body.rows[0].n, 0);
});

test('sql: a semicolon inside a string is fine, a leading comment is fine', async () => {
  const r = await sql('site', "-- counting\nselect 'a;b' as s");
  assert.equal(r.status, 200);
  assert.equal(r.body.rows[0].s, 'a;b');
});

test('sql: row limit keeps the first rows and says the result was cut', async () => {
  const r = await sql('site', 'with n(x) as (values (1),(2),(3)) select x from n order by x', { limit: 2 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rows.map((x) => x.x), [1, 2]);
  assert.equal(r.body.truncated, true);
  const all = await sql('site', 'with n(x) as (values (1),(2),(3)) select x from n', { limit: 3 });
  assert.equal(all.body.truncated, false);
  assert.equal(all.body.row_count, 3);
});

test('sql: long cell values are cut and say how much was cut', async () => {
  const r = await sql('site', `select '${'x'.repeat(9000)}' as big`);
  assert.equal(r.status, 200);
  assert.ok(r.body.rows[0].big.length < 4200);
  assert.match(r.body.rows[0].big, /more chars\]$/);
});

test('sql: params are passed to the statement', async () => {
  const r = await sql('site', 'select ? as v', { params: ['hi'] });
  assert.equal(r.body.rows[0].v, 'hi');
  const bad = await sql('site', 'select ? as v', { params: 'hi' });
  assert.equal(bad.status, 400);
});

test('sql: database errors come back as 400 with the message', async () => {
  const r = await sql('site', 'select * from no_such_table');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no such table/);
});

test('sql: db must be site or report', async () => {
  assert.equal((await sql('mail', 'select 1')).status, 400);
});

test('report database: runs one read through the read-only path and returns its rows', async () => {
  const r = await sql('report', 'select report_id from v21_report', { limit: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.body.db, 'report');
  assert.ok(reportRows.at(-1).includes('select * from (\nselect report_id from v21_report\n) as q limit 11'));
});

test('report database: when not configured, answers 503', async () => {
  const none = createOps({ token: TOKEN, store, reportDb: createReportDb({}), logs });
  const server2 = http.createServer((req, res) => none.handle(req, res, new URL(req.url, 'http://local')));
  await new Promise((resolve) => server2.listen(0, resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server2.address().port}/ops/api/schema?db=report`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 503);
  } finally {
    await new Promise((resolve) => server2.close(resolve));
  }
});

test('checkReadSql: only single reads pass, and explain is not wrapped', () => {
  assert.throws(() => checkReadSql('update users set x = 1', 10), /only one SELECT/);
  assert.throws(() => checkReadSql('select 1; select 2', 10), /one statement only/);
  assert.throws(() => checkReadSql('   ', 10), /empty/);
  assert.equal(checkReadSql('explain query plan select 1', 10), 'explain query plan select 1');
  assert.match(checkReadSql('select 1;', 10), /limit 11$/);
});

test('schema route: site lists tables with columns', async () => {
  const r = await call('GET', '/ops/api/schema?db=site');
  assert.equal(r.status, 200);
  const orders = r.body.tables.find((t) => t.name === 'orders');
  assert.ok(orders.columns.some((c) => c.name === 'stripe_session_id'));
});

test('unknown ops route: 404 and the list of routes', async () => {
  const r = await call('GET', '/ops/api/nope');
  assert.equal(r.status, 404);
  assert.ok(r.body.routes.length >= 4);
});
