// Operator tools for the live site: read production without SSH. For the developer and the AI agent.
//
//   GET  /ops/api/status                   build, uptime, which settings are set (true/false, never the values), table counts
//   GET  /ops/api/logs                     recent server log lines, kept in memory since this process started
//   GET  /ops/api/schema?db=site|report    tables and their columns
//   POST /ops/api/sql                      {"db":"site"|"report","sql":"select ...","params":[],"limit":500}
//
// Every route needs `Authorization: Bearer <OPS_TOKEN>`. Without OPS_TOKEN on the service they all answer 503.
// Read only, twice over: only ONE SELECT / WITH / VALUES / EXPLAIN statement is accepted, the site database runs
// it in query_only mode, and the report database runs it inside a READ ONLY transaction.
//
// Nothing here is shown to visitors. Logs and rows can hold emails and IP addresses: keep the token private.
// Terminal use: scripts/ops.mjs (see docs/ops.md).

import crypto from 'node:crypto';
import fs from 'node:fs';

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const DEFAULT_ROWS = 500;
const MAX_ROWS = 5000;
const MAX_CELL = 4000; // characters kept per cell; longer values are cut and say how much was cut
const MAX_LINE = 4000; // characters kept per log line
const MAX_SQL = 20000;
const MAX_BODY = 1_000_000;
const ROUTES = [
  'GET /ops/api/status',
  'GET /ops/api/logs?limit=&level=&match=&since=',
  'GET /ops/api/schema?db=site|report',
  'POST /ops/api/sql {"db","sql","params","limit"}',
];

// Keeps the last lines the server printed. install() wraps console so every line still prints as before.
export function createLogBuffer({ max = 3000, now = Date.now } = {}) {
  const lines = [];
  let seq = 0;

  function format(v) {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
    try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
  }

  function push(level, args) {
    try {
      seq += 1;
      let text = args.map(format).join(' ');
      if (text.length > MAX_LINE) text = `${text.slice(0, MAX_LINE)} …[${text.length - MAX_LINE} more chars]`;
      lines.push({ seq, at: new Date(now()).toISOString(), level, text });
      if (lines.length > max) lines.splice(0, lines.length - max);
    } catch {
      // Keeping a log line must never break the request that printed it.
    }
  }

  return {
    push,
    install(target = console) {
      for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error'], ['debug', 'debug']]) {
        const original = target[method];
        if (typeof original !== 'function') continue;
        target[method] = (...args) => {
          push(level, args);
          return original.apply(target, args);
        };
      }
    },
    // Lines after `since` (a seq number), at or above `level`, containing `match` (case-insensitive). Newest last.
    query({ limit = 200, level, match = '', since = 0 } = {}) {
      const min = level ? LEVELS[level] ?? 0 : 0;
      const needle = String(match ?? '').toLowerCase();
      const hits = lines.filter((l) => l.seq > since && LEVELS[l.level] >= min && (!needle || l.text.toLowerCase().includes(needle)));
      return { count: hits.length, kept: lines.length, last_seq: seq, lines: hits.slice(-Math.max(1, limit)) };
    },
    size: () => lines.length,
  };
}

// Checks one statement and returns the text to run. Throws a 400 error for anything that is not a single read.
// Rows are wrapped so the database returns at most limit + 1 (the extra one tells us the result was cut).
export function checkReadSql(sql, limit) {
  if (typeof sql !== 'string' || !sql.trim()) throw httpError(400, 'sql is empty');
  if (sql.length > MAX_SQL) throw httpError(400, `sql is longer than ${MAX_SQL} characters`);
  const body = sql.trim().replace(/;+\s*$/, '');
  const head = body.replace(/^(?:\s+|--[^\n]*|\/\*[\s\S]*?\*\/)*/, '').slice(0, 16).toLowerCase();
  if (!/^(select|with|values|explain)\b/.test(head)) {
    throw httpError(400, 'only one SELECT, WITH, VALUES or EXPLAIN statement is allowed here');
  }
  const unquoted = body.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  if (unquoted.includes(';')) throw httpError(400, 'one statement only: remove the ";" between statements');
  if (/^explain\b/.test(head)) return body; // EXPLAIN returns its own small result
  return `select * from (\n${body}\n) as q limit ${limit + 1}`;
}

export function createOps({ token = '', store = null, reportDb = null, logs = createLogBuffer(), info = {}, now = Date.now } = {}) {
  const startedAt = now();
  const tokenBuf = token ? Buffer.from(String(token)) : null;

  function allowed(req) {
    const m = /^Bearer (.+)$/.exec(String(req.headers?.authorization ?? ''));
    if (!m || !tokenBuf) return false;
    const given = Buffer.from(m[1]);
    return given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf);
  }

  function logsReply(url) {
    const level = url.searchParams.get('level') || undefined;
    if (level && !(level in LEVELS)) throw httpError(400, 'level must be debug, info, warn or error');
    const q = logs.query({
      limit: clampInt(url.searchParams.get('limit'), 200, 1, 2000),
      level,
      match: url.searchParams.get('match') || '',
      since: clampInt(url.searchParams.get('since'), 0, 0, Number.MAX_SAFE_INTEGER),
    });
    return { level: level ?? 'debug', ...q };
  }

  async function status() {
    return {
      ok: true,
      build: info.build ?? {},
      stripe_mode: info.stripeMode ?? 'unset',
      started_at: new Date(startedAt).toISOString(),
      uptime_s: Math.round((now() - startedAt) / 1000),
      node: process.version,
      settings_set: info.settingsSet ?? {},
      data_dir: info.dataDir ?? null,
      site_db: store ? { file: info.siteDbFile ?? null, bytes: fileBytes(info.siteDbFile), tables: store.tables() } : null,
      report_db: { configured: Boolean(reportDb?.configured) },
      kept_log_lines: logs.size(),
    };
  }

  async function schema(which) {
    if (which === 'site') {
      if (!store) throw httpError(503, 'no site database');
      return { db: 'site', tables: store.tables().map((t) => ({ ...t, columns: store.columns(t.name) })) };
    }
    if (which === 'report') {
      if (!reportDb?.configured) throw httpError(503, 'report database not configured: set REPORT_DB_URL or DATABASE_URL');
      const rows = await reportDb.readSql(
        `select table_name, column_name, data_type, is_nullable from information_schema.columns
          where table_schema = 'public' order by table_name, ordinal_position`);
      const tables = new Map();
      for (const r of rows) {
        if (!tables.has(r.table_name)) tables.set(r.table_name, []);
        tables.get(r.table_name).push({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === 'YES' });
      }
      return { db: 'report', tables: [...tables].map(([name, columns]) => ({ name, columns })) };
    }
    throw httpError(400, 'db must be "site" or "report"');
  }

  async function runSql(body) {
    const which = body?.db;
    if (which !== 'site' && which !== 'report') throw httpError(400, 'db must be "site" or "report"');
    const limit = clampInt(body.limit, DEFAULT_ROWS, 1, MAX_ROWS);
    const params = body.params ?? [];
    if (!Array.isArray(params)) throw httpError(400, 'params must be an array');
    const text = checkReadSql(body.sql, limit);
    if (which === 'site' && !store) throw httpError(503, 'no site database');
    if (which === 'report' && !reportDb?.configured) throw httpError(503, 'report database not configured: set REPORT_DB_URL or DATABASE_URL');
    const started = now();
    let rows;
    try {
      rows = which === 'site' ? store.readSql(text, params) : await reportDb.readSql(text, params);
    } catch (e) {
      throw httpError(400, `database error: ${e.message}`);
    }
    const kept = rows.slice(0, limit).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, capValue(v)])));
    return {
      db: which,
      columns: kept[0] ? Object.keys(kept[0]) : [],
      row_count: kept.length,
      truncated: rows.length > limit,
      limit,
      ms: now() - started,
      rows: kept,
    };
  }

  return {
    enabled: Boolean(tokenBuf),
    async handle(req, res, url) {
      const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
      if (!tokenBuf) return send(res, 503, { error: 'ops is off: set OPS_TOKEN on this service' });
      if (!allowed(req)) return send(res, 401, { error: 'send Authorization: Bearer <OPS_TOKEN>' });
      try {
        if (route === 'GET /ops/api/status') return send(res, 200, await status());
        if (route === 'GET /ops/api/logs') return send(res, 200, logsReply(url));
        if (route === 'GET /ops/api/schema') return send(res, 200, await schema(url.searchParams.get('db')));
        if (route === 'POST /ops/api/sql') return send(res, 200, await runSql(await readJson(req)));
        return send(res, 404, { error: `no ops route ${route}`, routes: ROUTES });
      } catch (e) {
        const code = e.status ?? 500;
        if (code === 500) console.error(`ops ${route} failed: ${e.stack ?? e.message}`);
        return send(res, code, { error: e.message });
      }
    },
  };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function clampInt(v, dflt, min, max) {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// Makes any database value safe to send as JSON: long text is cut, binary is described, bigints become strings.
function capValue(v) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v ?? null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `<binary ${v.length} bytes>`;
  const text = typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v));
  if (text.length <= MAX_CELL) return v;
  return `${text.slice(0, MAX_CELL)}…[${text.length - MAX_CELL} more chars]`;
}

function fileBytes(file) {
  if (!file) return null;
  try { return fs.statSync(file).size; } catch { return null; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(httpError(400, 'body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  res.end(JSON.stringify(body, null, 2));
}
