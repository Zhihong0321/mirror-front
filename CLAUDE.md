# CLAUDE.md: working on the MirrorMirror website

Read this before you touch anything here. It was checked against production on 2026-11-12 (live commit `57bfc36`).
Companion docs: [docs/ops.md](docs/ops.md) (ops API reference), [README.md](README.md), [AGENTS.md](AGENTS.md).

## What this repo is

- The **live MirrorMirror website** (mirrormirror.cloud). Repo: https://github.com/Zhihong0321/mirror-front, branch `main`.
  Local folder: `G:\mirror-front`.
- Node 22, no framework. `server/` is the website server (`server/app.js` holds every route), `site/` is the static
  public site, `Dockerfile` at the root is what Railway builds.
- It does: public pages, free-preview requests, Stripe checkout (**test mode** now), sign-in by emailed link (no
  passwords), invoices, the team office at `/myoffice`, visitor analytics, and the ops API for developers.
- The report **pipeline** (company research, the reports themselves) lives in other repos. This site only *reads*
  the report factory's Postgres, and never writes to it.

## Production facts

| Thing | Value |
|---|---|
| Railway project / environment / service | `mirrormirror` / `production` / `web` |
| Public address | https://mirrormirror.cloud (Railway's own: `web-production-3e14a.up.railway.app`) |
| Site database | SQLite file at `/data/mirrormirror.db` (`DATA_DIR=/data`, a Railway volume). Accounts, orders, mail log, visits, previews |
| Report database | Postgres at `DATABASE_URL` (company-diver, shared, 41 tables, the `v21_*` ones are the reports). **Read only** |
| Stripe | Test keys. `STRIPE_ALLOW_LIVE` is not set. Do not switch to live without the owner deciding it |
| Hub | No dry-run switch (removed 2026-11-13, owner rule): a paid order always starts its full report |
| Node | 22 (from the Dockerfile). `node:sqlite` is experimental there, so the log shows a harmless "ExperimentalWarning" line at ERROR level |

Settings live as variables on the Railway service, not in code. The names are listed in `server/.env.example`.
Secrets come from the vault (`D:\Tools\my-vault\vault.json`), never from this repo.

## Deploying

A push to `main` **does not deploy on its own** (observed: `dfd0c95` → `57bfc36` needed a manual redeploy).

```bash
cd G:/mirror-front
cd server && npm test && cd ..            # must pass before you push behaviour changes (93 tests at 57bfc36)
git add <files> && git commit -m "..." && git push origin main
railway redeploy --project mirrormirror --environment production --service web --from-source --yes
```

Then wait about 2 minutes and check that production runs what you pushed:

```bash
node scripts/ops.mjs status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).build.commit))'
git rev-parse HEAD        # the two must match
```

- The Railway CLI is **not linked** in this folder. Always pass `--project`, `--environment` and `--service`.
- Changing a variable: `railway variables --project mirrormirror --environment production --service web --set "NAME=value"`.
  The new value only takes effect after a redeploy. `--skip-deploys` skips the automatic one, so redeploy after it.
- Check the deploy with the status command above. Do not claim a change is live until the commit matches and the
  page or route you changed has been checked on https://mirrormirror.cloud.

## The ops tools: how to read and debug production

These let you read production without SSH or a browser login. The owner does not need to paste logs for you.

### Setup (per terminal)

```bash
cd G:/mirror-front
export MM_OPS_URL=https://mirrormirror.cloud
export MM_OPS_TOKEN="$(cat .ops-token)"
```

- `.ops-token` is a git-ignored local copy. The same value is in the vault as `MIRRORMIRROR_OPS_TOKEN`
  (`D:\Tools\my-vault\vault.json`, read it from there if the file is missing). Never print it, never commit it, never
  paste it into a page, a URL or an external service.
- Without `OPS_TOKEN` set on Railway every ops route answers 503. Without the right token: 401.

### Commands (`node scripts/ops.mjs …`)

| Command | What it does |
|---|---|
| `status` | Live commit, branch, environment, uptime, Stripe mode, which settings are set (true/false only), site-DB table counts, report-DB configured |
| `logs [--limit N] [--level debug\|info\|warn\|error] [--match text] [--since SEQ]` | Recent log lines since the last restart (last 3000 kept). `--level warn` = warn and error. `--since` takes the `last_seq` printed by the previous call, so you only see new lines |
| `schema site\|report` | Tables and columns. Use this before writing a query you have not seen |
| `sql site "SELECT …" [--params '[…]'] [--limit N]` | One read on the site SQLite DB. Placeholders are `?` |
| `sql report "SELECT …" [--params '[…]'] [--limit N]` | One read on the Postgres report DB. Placeholders are `$1, $2` |

The raw API is documented in [docs/ops.md](docs/ops.md): `GET /ops/api/status`, `GET /ops/api/logs`,
`GET /ops/api/schema?db=`, `POST /ops/api/sql` with JSON `{"db","sql","params","limit"}`.

### What the SQL endpoint allows

- Exactly **one** statement starting with `SELECT`, `WITH`, `VALUES` or `EXPLAIN`. Anything else is refused with 400.
- The site DB runs it in `query_only` mode. The report DB runs it inside `BEGIN READ ONLY`. A write is refused by the
  database even if the first check were bypassed. Verified on production: `delete from users` returns 400.
- At most `limit` rows (default 500, max 5000). The response says `truncated: true` when there were more.
- Cells longer than 4000 characters are cut, and the cut says how many characters were dropped.
- Database errors come back as 400 with the database's message. Read it: it usually names the wrong column or table.
- `columns` is taken from the first row, so it is **empty when a query returns no rows**. The query is still right.
  Use `schema` to see the column names.

### Recipes

Health and version:
```bash
node scripts/ops.mjs status
```

Errors and recent activity:
```bash
node scripts/ops.mjs logs --level error --limit 50
node scripts/ops.mjs logs --match "stripe" --limit 20
node scripts/ops.mjs logs --since <last_seq from the previous call>      # poll for new lines
```

Someone reports a problem (replace the email):
```bash
node scripts/ops.mjs sql site "select * from users where email = ?" --params '["buyer@example.com"]'
node scripts/ops.mjs sql site "select * from orders where email = ? order by paid_at desc" --params '["buyer@example.com"]'
node scripts/ops.mjs sql site "select created_at, kind, status, error from mail_log where to_email = ? order by id desc" --params '["buyer@example.com"]'
node scripts/ops.mjs sql site "select * from preview_requests where email = ? order by created_at desc" --params '["buyer@example.com"]'
node scripts/ops.mjs sql site "select created_at, path, status, browser, device from visits where account_email = ? order by id desc" --params '["buyer@example.com"]' --limit 50
```

Emails that did not go out:
```bash
node scripts/ops.mjs sql site "select created_at, to_email, kind, error from mail_log where status <> 'sent' order by id desc"
```

Page views by HTTP status (404 spikes, bots):
```bash
node scripts/ops.mjs sql site "select status, count(*) as views from visits group by status order by views desc"
node scripts/ops.mjs sql site "select path, browser, is_bot, created_at from visits where status = 404 order by id desc"
```

Full reports (report DB; large columns are `report_html`, `payload`, `log`: never select them unless you need one page):
```bash
node scripts/ops.mjs sql report "select report_id, company, country, created_at from v21_report order by created_at desc" --limit 20
node scripts/ops.mjs sql report "select run_id, status, stage, created_at, finished_at from v21_deeper_run where report_id = \$1 order by created_at desc" --params '["<report uuid>"]'
```
Never write to `v21_*` or any table in the report DB from this site.

## Rules for working here

- **Verify, then say so.** Local tests (`cd server && npm test`) and a local run are the first check. Production checks
  come after a deploy, through `status` and the page you changed.
- **Status words** (owner's global rule): **DONE** = live on production and checked there, with the links as proof;
  **DONE, not checked online** = deployed, not yet checked on production; **CODE-READY** = finished and checked locally,
  nothing pushed or deployed; **NOT DONE** = anything less, with what is missing. A pushed-but-not-deployed change is not DONE.
- **Never** put a token, a `.env`, `server/data/` (the live DB copy) or the GeoIP file in git.
- **Never** change Stripe to live mode without the owner deciding it.
- **Never add a gate, block, dry-run or on/off switch that holds output back** (owner rule, see the global ZERO KILL GATES). A problem is logged and labelled; the output is still produced.
- **Never** change the report DB. The factory owns those tables. Reads only.
- **Pages are public by decision** (owner, 2026-11-12): `/r/` and `/p/` report pages have no payment or token check.
  Do not add one unasked.
- **Data fixes on production are not possible through the ops API** (it cannot write). If a data change is needed,
  propose the exact SQL first and wait for the owner's yes, then run it through a reviewed script. Do not improvise.
- Do not add gates that hide output. When something fails, log it, show it, and keep the page working.

## Adding or changing an ops route

1. Edit `server/ops.js` (routes are in `createOps`). Keep every route read-only.
2. Add a test to `server/test/ops.test.js`. `cd server && npm test` must pass.
3. Commit, push, redeploy (see Deploying), then check the route on production with `scripts/ops.mjs` or `curl`.
4. Update [docs/ops.md](docs/ops.md) and the command table above.

## Local runs

- Copy `server/.env.example` to `server/.env` and fill only what you need. Use test keys (`sk_test_…`).
- Pick a free port with `PORT=…`. Port 8099 was already held by another process on 2026-11-12. Check with
  `netstat -ano | grep :<port>` first. Do not kill a process you did not start.
- Run it in the background and read its output file. Stop only your own process (by its PID, from `netstat`).
- The local site DB is `DATA_DIR` (point it at a scratch folder, not `server/data`).

## What is verified and what is not

- Verified on production (2026-11-12): status, logs (`--level`, `--match`, `--since`), schema for both DBs, reads on the
  site DB and the report DB (13 reports, parameterised query), refused write (400).
- Not verified by anyone yet: a full paid order on production (Stripe test mode), live sign-in email delivery through
  Mailjet (the mail log shows "sent" rows), the hub's real full-report run (the dry-run switch was removed 2026-11-13; check the first real run).
