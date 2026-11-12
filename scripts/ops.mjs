#!/usr/bin/env node
// Terminal client for the live site's ops API (server/ops.js, docs/ops.md). Read only.
//
//   MM_OPS_URL    the site, e.g. https://mirrormirror.cloud
//   MM_OPS_TOKEN  the OPS_TOKEN set on the Railway service (vault: MIRRORMIRROR_OPS_TOKEN)
//
//   node scripts/ops.mjs status
//   node scripts/ops.mjs logs [--limit 200] [--level warn|error|info|debug] [--match text] [--since 123]
//   node scripts/ops.mjs schema site|report
//   node scripts/ops.mjs sql site|report "select ..." [--params '["x"]'] [--limit 500]
//
// The site database (SQLite) uses ? placeholders. The report database (Postgres) uses $1, $2.
// Output is JSON, except logs, which print one line per log line.

const [, , command, ...argv] = process.argv;

function die(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) die(`${a} needs a value`);
      flags[a.slice(2)] = value;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const base = (process.env.MM_OPS_URL ?? '').replace(/\/+$/, '');
const token = process.env.MM_OPS_TOKEN ?? '';

async function call(method, path, body) {
  if (!base || !token) die('Set MM_OPS_URL (the site address) and MM_OPS_TOKEN (the OPS_TOKEN of the service) first.');
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 2000) };
  }
  if (!res.ok) die(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const { positional, flags } = parseArgs(argv);

switch (command) {
  case 'status':
    console.log(JSON.stringify(await call('GET', '/ops/api/status'), null, 2));
    break;

  case 'logs': {
    const q = new URLSearchParams();
    for (const k of ['limit', 'level', 'match', 'since']) if (flags[k] !== undefined) q.set(k, flags[k]);
    const data = await call('GET', `/ops/api/logs?${q}`);
    for (const l of data.lines) console.log(`${l.seq} ${l.at} ${l.level.toUpperCase().padEnd(5)} ${l.text}`);
    console.error(`(${data.lines.length} shown of ${data.count} matching; last seq ${data.last_seq}; ${data.kept} kept in memory)`);
    break;
  }

  case 'schema': {
    const db = positional[0];
    if (db !== 'site' && db !== 'report') die('usage: schema site|report');
    console.log(JSON.stringify(await call('GET', `/ops/api/schema?db=${db}`), null, 2));
    break;
  }

  case 'sql': {
    const [db, text] = positional;
    if ((db !== 'site' && db !== 'report') || !text) die('usage: sql site|report "select ..." [--params \'[...]\'] [--limit N]');
    let params = [];
    if (flags.params !== undefined) {
      try {
        params = JSON.parse(flags.params);
      } catch {
        die('--params must be a JSON array, e.g. \'["x", 3]\'');
      }
    }
    const body = { db, sql: text, params };
    if (flags.limit !== undefined) body.limit = Number(flags.limit);
    console.log(JSON.stringify(await call('POST', '/ops/api/sql', body), null, 2));
    break;
  }

  default:
    console.error('usage: node scripts/ops.mjs status | logs [--limit N] [--level L] [--match T] [--since S] | schema site|report | sql site|report "SQL" [--params JSON] [--limit N]');
    process.exit(command ? 1 : 0);
}
