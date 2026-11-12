# Ops tools: read the live site without SSH

How the developer (and the AI agent) reads production: status, logs, the site database and the report
database. Code: [server/ops.js](../server/ops.js) (the routes), [scripts/ops.mjs](../scripts/ops.mjs) (terminal client),
tests in [server/test/ops.test.js](../server/test/ops.test.js).

## Turn it on (once, on Railway)

1. Make a long random token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. On the Railway service, add the variable **`OPS_TOKEN`** = that token. Redeploy.
3. Keep the token in the vault (`D:\Tools\my-vault\vault.json`, name `MIRRORMIRROR_OPS_TOKEN`). Never in git.

Without `OPS_TOKEN` every `/ops/api/*` route answers **503** and nothing else changes.

## Routes

All need `Authorization: Bearer <OPS_TOKEN>` (missing or wrong: 401). Answers are JSON, `no-store`, `noindex`.

| Route | Gives |
|---|---|
| `GET /ops/api/status` | Build (Railway commit, branch, service, environment), uptime, Stripe mode (`test`/`live`), which settings are **set** (true/false, never the values), site database file size and row counts, whether the report database is configured |
| `GET /ops/api/logs?limit=200&level=warn&match=text&since=SEQ` | Recent log lines kept in memory since this process started (last 3000). `level` is a minimum (`warn` = warn and error). `since` = the `last_seq` of an earlier call, to read only new lines |
| `GET /ops/api/schema?db=site` | The site database: tables with columns and row counts |
| `GET /ops/api/schema?db=report` | The report database (Postgres, schema `public`): tables with columns |
| `POST /ops/api/sql` | One read query. Body: `{"db":"site"\|"report","sql":"select ...","params":[],"limit":500}` |

### What `/ops/api/sql` accepts

- **One** statement that starts with `SELECT`, `WITH`, `VALUES` or `EXPLAIN`. Anything else is refused (400).
- `site` (SQLite) uses `?` placeholders. The statement also runs with the database in `query_only` mode, so a write
  is refused by the database itself even if it slipped past the first check.
- `report` (Postgres) uses `$1, $2`. The statement runs inside a `BEGIN READ ONLY` transaction.
- At most `limit` rows (default 500, max 5000). `truncated: true` means more rows exist.
- A cell longer than 4000 characters is cut, and the cut says how many characters were left out. Binary is shown as its size.
- Database errors come back as 400 with the database's message, so a wrong column name is easy to fix.

Important: the report database (company-diver, `v21_*` tables, see [report-display.md](report-display.md)) is the
factory's data. Read only. Never read `v21_raw` for anything but a quick look: rows are large.

## Terminal client

Set two variables in the terminal, then run from the repo root:

```bash
export MM_OPS_URL=https://mirrormirror.cloud
export MM_OPS_TOKEN=<OPS_TOKEN>
node scripts/ops.mjs status
node scripts/ops.mjs logs --level error --limit 50
node scripts/ops.mjs logs --match "stripe" --since 120
node scripts/ops.mjs schema site
node scripts/ops.mjs sql site "select email, created_at from users order by created_at desc" --limit 20
node scripts/ops.mjs sql site "select * from orders where email = ?" --params '["someone@example.com"]'
node scripts/ops.mjs sql report "select report_id, company from v21_report order by created_at desc" --limit 10
```

Use the live address for `MM_OPS_URL`: the site's public domain, or the Railway address of the `web` service.

## What is in the site database (for reading it)

`server/store.js` creates: `users`, `login_links`, `sessions`, `orders`, `mail_log`, `preview_requests`, and the
visitor analytics table `visits` (`visits.js`). Read the live list with `schema site`; this list may be out of date.

## Limits and safety

- Logs are in memory: a restart clears them. For older history use Railway's log view or `railway logs`.
- Logs and rows can contain emails, IP addresses and order details. The token is the only lock: keep it private,
  and rotate it (change `OPS_TOKEN`, redeploy) if it is pasted anywhere it should not be.
- The token is compared in constant time and never written to a log.
- Nothing on these routes is cached or shown to visitors.
