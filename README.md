# mirror-front: the MirrorMirror website

> **Mirror, mirror on the cloud — whose name does AI say out loud?**

The live MirrorMirror site (mirrormirror.cloud): the public pages, the order and payment pages (Stripe), sign-in
by emailed link, invoices, the team office (`/myoffice`), and the ops tools for the developer.

Railway deploys this repo: one service, built from the root `Dockerfile` (it copies `site/` and `server/`).

## Layout

```
Dockerfile          builds the image Railway runs (node server/server.js)
site/               the public static site
server/             the website server (Node 22, no framework)
  app.js            every route
  ops.js            ops tools: /ops/api/* (status, logs, read-only SQL)   docs/ops.md
  server.js         starts the server; reads all settings from the environment
  store.js          the site's own SQLite database (accounts, orders, mail log, visits)
  reportdb.js       read-only access to the company-diver Postgres (reports)
  test/             node --test
scripts/ops.mjs     terminal client for the ops API
docs/               the business, pipeline, website, report, payment, email, analytics notes
```

## Run and test

```bash
cd server
npm ci
npm test              # node --test
```

Local run: copy `server/.env.example` to `server/.env`, fill what you need, then `npm run dev` inside `server/`.
Without a real `REPORT_DB_URL`, the report pages say the report cannot be loaded (nothing crashes).

## Deploy (Railway)

1. Connect the Railway service to this repo (branch `main`). Railway builds the `Dockerfile`.
2. Set the variables listed in `server/.env.example` on the service. Secrets live in the vault
   (`D:\Tools\my-vault\vault.json`), not in this repo.
3. Set **`OPS_TOKEN`** (see [docs/ops.md](docs/ops.md)) to turn the ops tools on.
4. Persistent storage: mount a volume and set `DATA_DIR` to its path, or the site database is lost on redeploy.

## Ops: read production without SSH

Once `OPS_TOKEN` is set:

```bash
export MM_OPS_URL=https://mirrormirror.cloud
export MM_OPS_TOKEN=<OPS_TOKEN>
node scripts/ops.mjs status
node scripts/ops.mjs logs --level error
node scripts/ops.mjs schema site
node scripts/ops.mjs sql site "select count(*) as orders from orders"
```

Read-only by design: one SELECT at a time. Full notes: [docs/ops.md](docs/ops.md).

## Docs

| Read | For |
|---|---|
| [docs/ops.md](docs/ops.md) | Ops tools: routes, token, terminal client |
| [docs/website-guide.md](docs/website-guide.md) | The website, admin panel, hub API |
| [docs/report-display.md](docs/report-display.md) | Company-diver reports: `/p/` preview, `/r/` full report |
| [docs/payments.md](docs/payments.md) | Stripe: order page, checkout, webhook |
| [docs/email.md](docs/email.md) | Mailjet, sign-in by link, accounts, invoices |
| [docs/dashboard.md](docs/dashboard.md) | The signed-in dashboard and free preview requests |
| [docs/analytics.md](docs/analytics.md) | Visitor analytics |
| [docs/business.md](docs/business.md) | The business |
| [docs/pipeline.md](docs/pipeline.md) | The report pipeline (lives in other repos) |
