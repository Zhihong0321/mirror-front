// Starts the MirrorMirror website server. All settings come from the environment (see .env.example).

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { createApp } from './app.js';
import { createHub } from './hub.js';
import { openStore } from './store.js';
import { createMailer } from './mailer.js';
import { createReportDb } from './reportdb.js';
import { createGeo } from './geo.js';
import { createLogBuffer } from './ops.js';

// Keep the last log lines in memory for the ops API (/ops/api/logs). Console output still prints as before.
const logs = createLogBuffer();
logs.install();

const env = process.env;
const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'HUB_URL', 'HUB_TOKEN'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing settings: ${missing.join(', ')}. See server/.env.example.`);
  process.exit(1);
}
// Live keys take real money. They only run when switched on on purpose.
if (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY) && env.STRIPE_ALLOW_LIVE !== '1') {
  console.error('STRIPE_SECRET_KEY is a live key. Set STRIPE_ALLOW_LIVE=1 to take real payments.');
  process.exit(1);
}

const config = {
  stripeKey: env.STRIPE_SECRET_KEY,
  webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  priceCents: Number(env.PRICE_CENTS ?? 8900),
  currency: (env.PRICE_CURRENCY ?? 'usd').toLowerCase(),
  publicUrl: env.PUBLIC_URL?.replace(/\/+$/, ''),
  // The company-diver report factory's public address, for the free preview (/p/<id>). Not the old ee-auto hub.
  // REPORT_HUB_URL wins; else Railway's own address of the company-diver service in this project.
  reportHubUrl: (env.REPORT_HUB_URL
    || (env.RAILWAY_SERVICE_COMPANY_DIVER_URL ? `https://${env.RAILWAY_SERVICE_COMPANY_DIVER_URL.replace(/^https?:\/\//, '')}` : ''))
    .replace(/\/+$/, '') || undefined,
  // Operator token of that factory, to start a paid full report (POST /api/v21/deeper). Server side only. A real
  // run costs money, so HUB_DRY_RUN=1 logs it instead.
  reportHubToken: env.REPORT_HUB_TOKEN || env.HUB_TOKEN || '',
  reportDryRun: env.HUB_DRY_RUN === '1',
  // Free preview requests: who is told about a new one, and the token that lets the report factory mark one ready.
  previewAlertEmail: env.PREVIEW_ALERT_EMAIL || '',
  // PREVIEW_AUTO_START=1: a new free-preview request starts its research on the report factory by itself (real LLM cost).
  // The site does not ask who the company is, so the factory is told this industry unless the request says otherwise.
  previewAutoStart: env.PREVIEW_AUTO_START === '1',
  previewIndustry: env.PREVIEW_INDUSTRY || 'General business',
  previewAdminToken: env.PREVIEW_ADMIN_TOKEN || '',
  // The office key: every team page (/myoffice/*) opens with it. Empty = the office cannot be opened.
  officeKey: env.OFFICE_KEY || '',
  // Times on the visitors page (/myoffice/visitors) are shown in this time zone.
  analyticsTz: env.ANALYTICS_TZ || 'Asia/Kuala_Lumpur',
  siteDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), env.SITE_DIR ?? '../site'),
  // Who the invoice says the money was paid to. Set these once the company behind MirrorMirror is decided.
  seller: { name: env.INVOICE_SELLER_NAME ?? 'MirrorMirror', address: env.INVOICE_SELLER_ADDRESS ?? '', note: env.INVOICE_NOTE ?? '' },
};

const stripe = new Stripe(config.stripeKey);
const hub = createHub({ url: env.HUB_URL, token: env.HUB_TOKEN, dryRun: env.HUB_DRY_RUN === '1' });
const port = Number(env.PORT ?? 8080);

// The site's own database (accounts, orders, mail log). On Railway, point DATA_DIR at a mounted volume.
const dataDir = path.resolve(env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'));
const store = openStore(path.join(dataDir, 'mirrormirror.db'));

// Ops API (ops.js). Build info comes from Railway's own variables; settings are reported as set/unset, never as values.
const SETTINGS_SEEN = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_ALLOW_LIVE', 'HUB_URL', 'HUB_TOKEN', 'HUB_DRY_RUN',
  'MAILJET_API_KEY', 'MAILJET_SECRET_KEY', 'MAIL_DRY_RUN', 'REPORT_DB_URL', 'DATABASE_URL', 'REPORT_HUB_URL', 'REPORT_HUB_TOKEN',
  'PREVIEW_ADMIN_TOKEN', 'PREVIEW_ALERT_EMAIL', 'PREVIEW_AUTO_START', 'OFFICE_KEY', 'PUBLIC_URL', 'DATA_DIR', 'OPS_TOKEN', 'GEOIP_DB'];
config.logs = logs;
config.opsToken = env.OPS_TOKEN ?? '';
config.opsInfo = {
  build: {
    commit: env.RAILWAY_GIT_COMMIT_SHA ?? null,
    branch: env.RAILWAY_GIT_BRANCH ?? null,
    service: env.RAILWAY_SERVICE_NAME ?? null,
    environment: env.RAILWAY_ENVIRONMENT_NAME ?? null,
  },
  stripeMode: /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? '') ? 'test' : /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? '') ? 'live' : 'unset',
  settingsSet: Object.fromEntries(SETTINGS_SEEN.map((k) => [k, Boolean(env[k])])),
  dataDir,
  siteDbFile: path.join(dataDir, 'mirrormirror.db'),
};

// Email goes through Mailjet. Missing keys do not stop the server: each email is logged as failed instead.
const mailer = createMailer({
  apiKey: env.MAILJET_API_KEY, secretKey: env.MAILJET_SECRET_KEY,
  from: env.MAIL_FROM ?? 'admin@mirrormirror.cloud', fromName: env.MAIL_FROM_NAME ?? 'MirrorMirror',
  dryRun: env.MAIL_DRY_RUN === '1', store,
});
if (!mailer.configured && !mailer.dryRun) console.warn('MAILJET_API_KEY / MAILJET_SECRET_KEY not set: sign-in and invoice emails will fail (and be logged as failed).');
if (!config.publicUrl) console.warn('PUBLIC_URL not set: links in emails are built from the request address. Set it to the site address (https://mirrormirror.cloud).');

// Reports are read from the company-diver Postgres, read only. Without it the site still runs: /r/ pages say the
// report cannot be loaded, and /p/ needs REPORT_HUB_URL.
// REPORT_DB_URL wins; else DATABASE_URL (the variable set on Railway). Connections are read only either way.
const reportDbUrl = env.REPORT_DB_URL || env.DATABASE_URL;
const reportDb = createReportDb({ url: reportDbUrl });
if (reportDbUrl) console.log(`Report database: ${env.REPORT_DB_URL ? 'REPORT_DB_URL' : 'DATABASE_URL'} (${reportDbUrl.replace(/^.*@/, '')})`);
if (!reportDb.configured) console.warn('REPORT_DB_URL not set: full reports (/r/<id>) cannot be loaded.');
if (!config.reportHubUrl) console.warn('REPORT_HUB_URL not set: free previews (/p/<id>) cannot be shown.');

// Visitor locations come from a local GeoIP file (geo.js), downloaded at build time by geo-fetch.js.
const geo = createGeo(path.resolve(env.GEOIP_DB ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'geo', 'dbip-city.mmdb')));

const app = createApp({ stripe, hub, config, store, mailer, reportDb, geo });
if (config.previewAutoStart) {
  setTimeout(() => app.sweepPreviews(), 20_000).unref();
  setInterval(() => app.sweepPreviews(), 60_000).unref();
}
http.createServer(app).listen(port, () => {
  const mode = /^(sk|rk)_test_/.test(config.stripeKey) ? 'TEST' : 'LIVE';
  const mail = mailer.dryRun ? 'mail dry run' : mailer.configured ? 'mail on' : 'MAIL NOT CONFIGURED';
  console.log(`MirrorMirror on :${port} · Stripe ${mode} mode · ${config.currency.toUpperCase()} ${config.priceCents / 100}${env.HUB_DRY_RUN === '1' ? ' · hub dry run' : ''} · ${mail} · data ${dataDir}`);
});
