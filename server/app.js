// The website server's routes: the static site, the order pages, Stripe Checkout and the Stripe webhook,
// and email accounts (sign in by emailed link, orders, invoices).
// Paid flow: /order?dive=<id> or /order?report=<uuid> -> sign in -> POST /order/checkout -> Stripe -> webhook + /order/done
//            -> full report started (hub for a dive, report factory for a report) + the invoice emailed to the account.

import fs from 'node:fs/promises';
import path from 'node:path';
import * as pages from './pages.js';
import * as emails from './emails.js';
import { loadLegal } from './legal.js';
import { RESEARCHED_COUNTRIES } from './countries.js';
import { createAccounts, normalizeEmail, LINK_MINUTES } from './accounts.js';
import crypto from 'node:crypto';
import { createReports, chooseView, REPORT_ID } from './reports.js';
import { createReportDb } from './reportdb.js';
import { createFactory } from './factory.js';
import { dashboardPage, adminPreviewsPage } from './dashboard.js';
import { previewsListPage, fullListPage } from './admin-reports.js';
import { createTracker, pageKey } from './visits.js';
import { visitorsPage, pageLogUrl } from './visitors-page.js';
import { usersListPage, userPage } from './users-page.js';
import { createOffice, officeLoginPage, safeNext, OFFICE } from './office.js';
import { createOps } from './ops.js';

const PUBLIC_ID = /^[A-Za-z0-9_-]{20}$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

export function createApp({ stripe, hub, config, store, mailer, reportDb = createReportDb(), reportFetch = fetch, factory: factoryOverride, geo = null, now = Date.now, log = console.log }) {
  const testMode = /^(sk|rk)_test_/.test(config.stripeKey);
  const priceLabel = `${config.currency.toUpperCase()} ${(config.priceCents / 100).toFixed(config.priceCents % 100 ? 2 : 0)}`;
  const locks = new Map(); // dive id -> the fulfilment in flight, so the webhook and the done page never start two reports
  const accounts = createAccounts({ store, mailer, now, log });
  const seller = config.seller ?? {};
  // Company-diver reports: the free preview (/p/<id>) and the paid full report (/r/<id>). See reports.js.
  const reports = createReports({ db: reportDb, hubUrl: config.reportHubUrl, store, accounts, siteOrigin: (req) => base(req), fetchImpl: reportFetch, log });
  // Starts the paid full report on the report factory (factory.js). Dry run follows HUB_DRY_RUN: a real run costs money.
  const factory = factoryOverride ?? createFactory({ url: config.reportHubUrl, token: config.reportHubToken, db: reportDb, dryRun: config.reportDryRun, log });
  // Visitor analytics (visits.js): every HTML page sent is recorded, with a small script for time on page.
  // The team's office (/myoffice): one shared key, OFFICE_KEY. See office.js.
  const office = createOffice({ key: config.officeKey, now });
  const tracker = createTracker({ visits: store.visits, geo, currentEmail: (req) => accounts.currentEmail(req), now, log });
  // Operator tools for the developer: logs, read-only database queries, status (ops.js, docs/ops.md). Off without OPS_TOKEN.
  const ops = createOps({ token: config.opsToken ?? '', store, reportDb, logs: config.logs, info: config.opsInfo ?? {}, now });

  // Emails the invoice for a recorded order. Never throws. Returns true when it went out.
  async function sendInvoice(order, origin) {
    const sent = await mailer.send({
      to: order.email,
      kind: 'invoice',
      ...emails.invoice({ order, seller, accountUrl: `${origin}/account`, invoiceUrl: `${origin}/account/invoices/${order.id}` }),
    });
    if (sent.ok) {
      try { store.markInvoiceEmailed(order.id, now()); } catch (e) { log(`order ${order.id}: could not mark invoice emailed: ${e.message}`); }
    }
    return sent.ok;
  }

  // Emails a sign-in link after payment (once per order, retried on every later notification until it goes out).
  // Never throws: a failed email is logged and shown on the done page, and the report still starts.
  async function sendPaymentSignIn(order, origin) {
    try {
      const ok = await accounts.sendAfterPayment({ email: order.email, base: origin, company: order.company, invoiceNo: order.invoice_no });
      if (ok) {
        try { store.markSigninEmailed(order.id, now()); } catch (e) { log(`order ${order.id}: could not mark sign-in emailed: ${e.message}`); }
      }
      return ok;
    } catch (e) {
      log(`order ${order.id}: could not send the sign-in link: ${e.message}`);
      return false;
    }
  }

  // Records the paid order (once per Stripe session), emails its invoice and a sign-in link (once each, retried on
  // every later notification until they go out). A problem here is logged and shown, never allowed to stop the report.
  async function recordPaid(session, out, origin) {
    try {
      const email = normalizeEmail(session.metadata?.account_email) ?? normalizeEmail(session.customer_details?.email)
        ?? normalizeEmail(session.customer_email) ?? '';
      const order = store.recordOrder({
        stripeSessionId: session.id, email,
        diveId: Number(session.metadata?.dive_id) || null, divePublicId: session.metadata?.dive_public_id,
        company: session.metadata?.company, amountCents: session.amount_total ?? config.priceCents,
        currency: session.currency ?? config.currency, paidAt: now(), reportUrl: out.reportUrl,
        reportId: session.metadata?.report_id, // set once checkout is keyed on a company-diver report
      });
      if (!email) {
        log(`order ${session.id}: paid but no email address on it. Invoice ${order.invoice_no} was NOT emailed.`);
        return { email: '', sent: false, signIn: false };
      }
      const sent = order.invoice_emailed_at ? true : await sendInvoice(order, origin);
      const signIn = order.signin_emailed_at ? true : await sendPaymentSignIn(order, origin);
      return { email, sent, signIn };
    } catch (e) {
      log(`order ${session.id}: could not record the order or send the invoice: ${e.stack ?? e.message}`);
      return null;
    }
  }

  // Starts (or finds) the full report for a paid Checkout Session. Safe to call any number of times:
  // calls for one company run one after another, and the hub reuses a report that already exists.
  function fulfil(session, origin) {
    // An order for a company-diver report (v21): start (or find) its run on the report factory.
    const reportId = String(session.metadata?.report_id ?? '').toLowerCase();
    if (reportId) {
      if (!REPORT_ID.test(reportId)) return Promise.reject(new Error(`session ${session.id} has a bad report id in its metadata`));
      return inFlight(`report:${reportId}`, async () => {
        const out = await factory.startReport(reportId);
        log(`order ${session.id}: ${out.reused ? 'reused' : 'started'} full report run ${out.runId ?? '(dry run)'} for report ${reportId}`);
        const reportUrl = `${origin}/r/${reportId}`;
        return { ...out, reportUrl, invoice: await recordPaid(session, { reportUrl }, origin) };
      });
    }
    const diveId = Number(session.metadata?.dive_id);
    const publicId = session.metadata?.dive_public_id;
    if (!diveId || !PUBLIC_ID.test(publicId ?? '')) return Promise.reject(new Error(`session ${session.id} has no dive or report in its metadata`));
    return inFlight(`dive:${diveId}`, async () => {
      const out = await hub.startReport(diveId, publicId);
      log(`order ${session.id}: ${out.reused ? 'reused' : 'started'} full report ${out.runId ?? '(dry run)'} for dive #${diveId}`);
      return { ...out, invoice: await recordPaid(session, out, origin) };
    });
  }

  // One fulfilment at a time per company or report, so the webhook and the done page never start two.
  function inFlight(key, work) {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    locks.set(key, next);
    next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
    return next;
  }

  const legalPages = loadLegal(); // the footer's legal pages, read once

  const base = (req) => config.publicUrl
    || `${String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0]}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;

  // A company-diver report to order: its id from ?report=<uuid>, or from any preview link that holds one
  // (.../p/<uuid>, .../v21/r/<uuid>). The company comes from the report database, read only.
  const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  async function reportCompany(id) {
    if (!reportDb.configured) throw new Error('REPORT_DB_URL is not set');
    return (await reportDb.card(id))?.company ?? null;
  }

  async function orderReportPage(req, res, id) {
    if (!REPORT_ID.test(id)) return html(res, 404, pages.notFound());
    const email = accounts.currentEmail(req);
    if (email && store.hasReportOrder(email, id)) return redirect(res, `/r/${id}`); // already bought: never pay twice
    const company = await reportCompany(id);
    if (!company) return html(res, 404, pages.notFound());
    return html(res, 200, pages.orderPage({ dive: { publicId: id, company }, field: 'report', price: priceLabel, testMode, email }));
  }

  async function orderPage(req, res, url) {
    const reportParam = url.searchParams.get('report') ?? UUID_IN.exec(url.searchParams.get('preview') ?? '')?.[0] ?? '';
    if (reportParam) return orderReportPage(req, res, reportParam.toLowerCase());
    let id = url.searchParams.get('dive') ?? '';
    const preview = url.searchParams.get('preview');
    if (!id && preview) id = /\/dp\/([A-Za-z0-9_-]{20})/.exec(preview)?.[1] ?? '';
    if (!id) return html(res, preview ? 400 : 200, pages.chooseCompany({ error: preview ? 'That is not a preview link. It should contain /dp/.' : null, testMode }));
    if (!PUBLIC_ID.test(id)) return html(res, 404, pages.notFound());
    const dive = await hub.findDive(id);
    if (!dive) return html(res, 404, pages.notFound());
    if (!['done', 'partial'].includes(dive.diveStatus)) return html(res, 200, pages.notReady({ dive, testMode }));
    return html(res, 200, pages.orderPage({ dive, price: priceLabel, testMode, email: accounts.currentEmail(req) }));
  }

  async function checkoutReport(req, res, id) {
    if (!REPORT_ID.test(id)) return html(res, 404, pages.notFound());
    const email = accounts.currentEmail(req);
    if (!email) return redirect(res, `/login?next=${encodeURIComponent(`/order?report=${id}`)}`);
    if (store.hasReportOrder(email, id)) return redirect(res, `/r/${id}`);
    const company = await reportCompany(id);
    if (!company) return html(res, 404, pages.notFound());
    const metadata = { report_id: id, company: company.slice(0, 500), account_email: email };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: { currency: config.currency, unit_amount: config.priceCents, product_data: { name: `MirrorMirror full report: ${company}`.slice(0, 250) } },
      }],
      client_reference_id: id,
      customer_email: email,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${base(req)}/order/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base(req)}/order?report=${id}`,
    });
    res.writeHead(303, { location: session.url, 'cache-control': 'no-store' });
    res.end();
  }

  async function checkout(req, res) {
    const f = new URLSearchParams(await readBody(req));
    if (f.get('report')) return checkoutReport(req, res, f.get('report').toLowerCase());
    const id = f.get('dive') ?? '';
    // A purchase belongs to an email account: sign in first, then pay.
    const email = accounts.currentEmail(req);
    if (!email) return redirect(res, `/login?next=${encodeURIComponent(`/order?dive=${id}`)}`);
    const dive = PUBLIC_ID.test(id) ? await hub.findDive(id) : null;
    if (!dive) return html(res, 404, pages.notFound());
    if (!['done', 'partial'].includes(dive.diveStatus)) return html(res, 409, pages.notReady({ dive, testMode }));
    const metadata = { dive_id: String(dive.diveId), dive_public_id: dive.publicId, company: dive.company.slice(0, 500), account_email: email };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: { currency: config.currency, unit_amount: config.priceCents, product_data: { name: `MirrorMirror full report: ${dive.company}`.slice(0, 250) } },
      }],
      client_reference_id: dive.publicId,
      customer_email: email,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${base(req)}/order/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base(req)}/order?dive=${dive.publicId}`,
    });
    res.writeHead(303, { location: session.url, 'cache-control': 'no-store' });
    res.end();
  }

  async function webhook(req, res) {
    const raw = await readBody(req, true);
    let event;
    try {
      event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'] ?? '', config.webhookSecret);
    } catch {
      return json(res, 400, { error: 'bad signature' });
    }
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        try {
          await fulfil(session, base(req));
        } catch (e) {
          log(`order ${session.id}: could not start the report: ${e.message}`);
          return json(res, 500, { error: 'could not start the report' }); // Stripe retries the webhook
        }
      }
    }
    return json(res, 200, { received: true });
  }

  // Where Stripe sends the buyer back. Fulfils too, in case it arrives before the webhook.
  async function done(req, res, url) {
    const id = url.searchParams.get('session_id') ?? '';
    if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return html(res, 404, pages.notFound());
    let session;
    try { session = await stripe.checkout.sessions.retrieve(id); } catch { return html(res, 404, pages.notFound()); }
    const paid = session.payment_status === 'paid';
    const report = paid ? await fulfil(session, base(req)) : null;
    return html(res, 200, pages.donePage({ paid, company: session.metadata?.company, report, testMode, invoice: report?.invoice }));
  }

  // ---- Accounts: sign in by emailed link, orders, invoices ----

  const secure = (req) => base(req).startsWith('https');
  const ipOf = (req) => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  const form = async (req) => new URLSearchParams(await readBody(req));

  async function loginPage(req, res, url) {
    return html(res, 200, pages.loginPage({ next: url.searchParams.get('next') ?? '', testMode }));
  }

  async function requestLink(req, res) {
    const f = await form(req);
    const next = f.get('next') ?? '';
    const email = f.get('email') ?? '';
    const r = await accounts.requestLink({ email, next, base: base(req), ip: ipOf(req) });
    if (r.status === 'sent') return html(res, 200, pages.checkEmailPage({ email: r.email, minutes: LINK_MINUTES, next, testMode }));
    if (r.status === 'failed') return html(res, 503, pages.mailFailedPage());
    const error = {
      invalid: 'Enter a valid email address.',
      busy: 'Too many sign-in requests from your network. Please try again in a few minutes.',
      wait: `We sent you a link a moment ago. Use it, or ask for a new one in ${r.wait} seconds. A new link cancels the earlier one.`,
    }[r.status];
    return html(res, r.status === 'invalid' ? 400 : 429, pages.loginPage({ next, email, error, testMode }));
  }

  async function verifyPage(req, res, url) {
    const token = url.searchParams.get('token') ?? '';
    const link = accounts.peek(token);
    if (!link) return html(res, 410, pages.linkInvalidPage());
    return html(res, 200, pages.verifyPage({ token, email: link.email }));
  }

  async function verify(req, res) {
    const r = accounts.consume((await form(req)).get('token') ?? '');
    if (!r) return html(res, 410, pages.linkInvalidPage());
    res.writeHead(303, { location: r.next, 'set-cookie': accounts.sessionCookie(r.sessionToken, secure(req)), 'cache-control': 'no-store' });
    res.end();
  }

  async function logout(req, res) {
    accounts.logout(req);
    res.writeHead(303, { location: '/', 'set-cookie': accounts.clearCookie(secure(req)), 'cache-control': 'no-store' });
    res.end();
  }

  // What state is a bought report in? Read from the report database (statuses only, never the page). Never
  // throws and never waits long: when it cannot tell, the row just has no label and the report link still works.
  // The line under a report that is still being made: how long it takes, and how long ago it was paid.
  function prepHint(order) {
    const took = `Takes about ${emails.REPORT_MINUTES} minutes from payment.`;
    const mins = Math.floor((now() - Number(order.paid_at)) / 60_000);
    if (!Number.isFinite(mins) || mins < 0) return took;
    return `${took} Paid ${mins < 1 ? 'just now' : `${mins} minute${mins === 1 ? '' : 's'} ago`}.`;
  }

  async function reportStatus(order) {
    if (!order.report_id || !reportDb.configured) return null;
    try {
      let timer;
      const runs = await Promise.race([reportDb.runs(order.report_id), new Promise((_, no) => { timer = setTimeout(() => no(new Error('timed out')), 4000); })]);
      clearTimeout(timer);
      const v = chooseView(runs);
      if (v.kind === 'report') return v.label ? { label: 'Ready, with a note', tone: 'ok' } : { label: 'Ready', tone: 'ok' };
      if (v.kind === 'progress') return { label: 'Being prepared', tone: 'wait', hint: prepHint(order) };
      if (v.kind === 'failed') return { label: 'Problem: we are looking into it', tone: 'bad' };
      if (v.kind === 'none') return { label: 'Not started yet', tone: 'wait', hint: prepHint(order) };
      return null;
    } catch (e) {
      log(`dashboard: could not read the status of report ${order.report_id}: ${e.message}`);
      return null;
    }
  }

  // The dashboard. `n` picks a notice (see dashboard.js); company, who, country and website prefill the request form
  // (the landing page sends people here with them).
  async function account(req, res, url) {
    const email = accounts.currentEmail(req);
    if (!email) return redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    const q = url.searchParams;
    const mail = q.get('mail');
    const notice = mail === 'sent' ? 'sent' : mail === 'failed' ? 'failed' : (q.get('n') ?? null);
    const orders = store.ordersFor(email);
    const statuses = {};
    await Promise.all(orders.slice(0, 30).map(async (o) => { statuses[o.id] = await reportStatus(o); }));
    return html(res, 200, dashboardPage({
      email, orders, statuses, notice, price: priceLabel, previews: store.previewsFor(email), isAdmin: office.isIn(req),
      prefill: { company: q.get('company') ?? '', who: q.get('who') ?? '', country: q.get('country') ?? undefined, website: q.get('website') ?? '' },
    }));
  }

  // ---- Free previews ----

  const clean = (v, max) => String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  async function requestPreview(req, res) {
    const email = accounts.currentEmail(req);
    if (!email) return redirect(res, `/login?next=${encodeURIComponent('/account')}`);
    const f = await form(req);
    const company = clean(f.get('company'), 200);
    if (!company) return redirect(res, '/account?n=company#request');
    const who = ['mine', 'rival', 'supplier'].includes(f.get('who')) ? f.get('who') : 'mine';
    const out = store.addPreviewRequest({ email, company, who, country: clean(f.get('country_other') || f.get('country'), 80), website: clean(f.get('website'), 200) }, now());
    if (out.limited) return redirect(res, '/account?n=limit#request');
    if (out.duplicate) return redirect(res, '/account?n=duplicate#previews');
    const origin = base(req);
    const { request } = out;
    // Tell the buyer we have it, and tell the team there is work. Neither can stop the request: it is already saved.
    await Promise.all([
      mailer.send({ to: email, kind: 'preview-requested', ...emails.previewRequested({ request, accountUrl: `${origin}/account` }) }),
      config.previewAlertEmail
        ? mailer.send({ to: config.previewAlertEmail, kind: 'preview-alert', ...emails.previewAlert({ request, adminUrl: `${origin}/api/previews/${request.id}/ready` }) })
        : log(`preview request #${request.id} (${request.company}) saved, but PREVIEW_ALERT_EMAIL is not set so nobody was told.`),
    ]);
    return redirect(res, '/account?n=requested#previews');
  }

  // "I already have a preview link": send them to the right page.
  function openLink(req, res, url) {
    const link = url.searchParams.get('link') ?? '';
    const uuid = /\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-z-])/i.exec(link) ?? (REPORT_ID.test(link.trim()) ? [null, link.trim()] : null);
    if (uuid) return redirect(res, `/p/${uuid[1].toLowerCase()}`);
    const dive = /\/dp\/([A-Za-z0-9_-]{20})(?![A-Za-z0-9_-])/.exec(link);
    if (dive) return redirect(res, `/order?dive=${dive[1]}`);
    return redirect(res, '/account?n=bad_link#request');
  }

  // For the report factory or the team: the preview exists. Marks the request ready and emails the buyer the link.
  // Off unless PREVIEW_ADMIN_TOKEN is set.
  async function previewReady(req, res, id) {
    if (!config.previewAdminToken) return json(res, 404, { error: 'not found' });
    const presented = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? '').trim())?.[1] ?? '';
    const digest = (s) => crypto.createHash('sha256').update(s).digest();
    if (!crypto.timingSafeEqual(digest(presented), digest(config.previewAdminToken))) return json(res, 401, { error: 'unauthorized' });
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { error: 'body must be JSON' }); }
    const reportId = String(body.report_id ?? '').toLowerCase();
    if (!REPORT_ID.test(reportId)) return json(res, 400, { error: 'report_id must be a report uuid' });
    const request = store.previewById(Number(id));
    if (!request) return json(res, 404, { error: 'no such request' });
    const { ready, emailed } = await readyPreview(request, reportId, base(req));
    return json(res, 200, { ok: true, id: ready.id, status: ready.status, report_id: reportId, emailed });
  }

  // Marks a request ready for this report and emails the buyer the preview link, once per report. Used by the
  // endpoint above and by the team page. Never throws on a mail problem: the request is ready either way, and
  // `emailed: false` says the buyer has not been told yet (the team page then offers "Email again").
  async function readyPreview(request, reportId, origin) {
    const ready = store.markPreviewReady(request.id, reportId, now());
    let emailed = Boolean(ready.ready_emailed_at);
    if (!emailed) {
      const sent = await mailer.send({ to: ready.email, kind: 'preview-ready', ...emails.previewReady({ request: ready, previewUrl: `${origin}/p/${reportId}`, accountUrl: `${origin}/account` }) });
      if (sent.ok) { store.markPreviewReadyEmailed(ready.id, now()); emailed = true; }
    }
    return { ready, emailed };
  }

  // ---- Team page: /myoffice/previews (in the office: the OFFICE_KEY cookie, office.js) ----

  // In the office? Returns who to show as signed in (the account email if this browser is also signed in), or null.
  function officeWho(req) {
    return office.isIn(req) ? (accounts.currentEmail(req) ?? 'the office key') : null;
  }
  // Not in the office: sends the browser to the office key page and returns null.
  function officeGate(req, res, url) {
    const who = officeWho(req);
    if (!who) redirect(res, `${OFFICE}/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    return who;
  }

  async function officeLoginForm(req, res, url) {
    const next = safeNext(url.searchParams.get('next'));
    if (office.isIn(req)) return redirect(res, next);
    return html(res, 200, officeLoginPage({ next, configured: office.configured }));
  }

  async function officeLogin(req, res) {
    const f = await form(req);
    const next = safeNext(f.get('next'));
    const r = office.check(f.get('key') ?? '', ipOf(req));
    if (r === 'ok') {
      res.writeHead(303, { location: next, 'set-cookie': office.cookie(secure(req)), 'cache-control': 'no-store' });
      return res.end();
    }
    log(`office: key ${r} from ${ipOf(req)}`);
    const error = { wrong: 'That is not the office key.', wait: 'Too many wrong keys from your network. Try again in 15 minutes.', off: 'The office key is not set on this server.' }[r];
    return html(res, r === 'wait' ? 429 : r === 'off' ? 503 : 401, officeLoginPage({ next, error, configured: office.configured }));
  }

  async function officeLogout(req, res) {
    res.writeHead(303, { location: `${OFFICE}/login`, 'set-cookie': office.clearCookie(secure(req)), 'cache-control': 'no-store' });
    res.end();
  }

  async function adminPreviews(req, res, url) {
    const email = officeGate(req, res, url);
    if (!email) return;
    return html(res, 200, adminPreviewsPage({ email, requests: store.allPreviews(300), mail: store.recentMail(25), notice: url.searchParams.get('n') }));
  }

  // ---- Team pages: every report, /myoffice/reports/previews and /myoffice/reports/full (same sign-in as /myoffice/previews) ----
  async function adminReports(req, res, url, which) {
    const email = officeGate(req, res, url);
    if (!email) return;
    let rows = [], error = null;
    try {
      if (!reportDb.configured) throw new Error('no report database is set (REPORT_DB_URL or DATABASE_URL)');
      rows = which === 'full' ? await reportDb.allRuns() : await reportDb.allReports();
    } catch (e) {
      error = e.message;
      log(`admin reports (${which}): could not read the report database: ${e.message}`);
    }
    // Visits per preview, for the Visitors column (each links to that preview's tracker log). A problem here only
    // leaves the column empty.
    let visits = null;
    if (which !== 'full') {
      try { visits = new Map(store.visits.pages({ since: 0, prefix: '/p/' }).map((p) => [p.page, p])); }
      catch (e) { log(`admin reports: could not read visits: ${e.message}`); }
    }
    return html(res, 200, which === 'full' ? fullListPage({ email, runs: rows, error }) : previewsListPage({ email, rows, error, visits, logUrl: (id) => pageLogUrl(pageKey(`/p/${id}`)), keyOf: (id) => pageKey(`/p/${id}`) }));
  }

  // ---- Team pages: users, /myoffice/users and /myoffice/users/one?email= (same sign-in as /myoffice/previews) ----
  async function adminUsers(req, res, url) {
    const email = officeGate(req, res, url);
    if (!email) return;
    const q = clean(url.searchParams.get('q'), 200).toLowerCase();
    let users = [], total = 0, error = null;
    try {
      const all = store.allUsers();
      total = all.length;
      users = q ? all.filter((u) => String(u.email).includes(q)) : all;
    } catch (e) { error = e.message; log(`admin users: could not read accounts: ${e.stack ?? e.message}`); }
    return html(res, 200, usersListPage({ email, users, total, q, error, tz: config.analyticsTz }));
  }

  async function adminUser(req, res, url) {
    const email = officeGate(req, res, url);
    if (!email) return;
    const who = normalizeEmail(url.searchParams.get('email')) ?? clean(url.searchParams.get('email'), 200).toLowerCase();
    if (!who) return redirect(res, '/myoffice/users');
    // Each part is read on its own: one that fails is named on the page, the others still show.
    const d = {};
    const problems = [];
    const part = (name, read) => { try { d[name] = read(); } catch (e) { problems.push(`${name} could not be read: ${e.message}`); log(`admin user ${who}: ${name}: ${e.message}`); } };
    part('user', () => store.userByEmail(who));
    part('previews', () => store.previewsFor(who));
    part('orders', () => store.ordersFor(who));
    part('mail', () => store.mailTo(who));
    part('sessions', () => store.activeSessions(who, now()));
    part('visits', () => {
      const f = { since: 0, account: who };
      const rows = store.visits.log(f, { limit: 200 });
      return { summary: store.visits.summary(f), rows, visitorIds: [...new Set(rows.map((r) => r.visitor_id).filter(Boolean))] };
    });
    return html(res, 200, userPage({ email, who, d, problems, tz: config.analyticsTz }));
  }

  // ---- Team pages: visitors (same sign-in as /myoffice/previews). See visitors-page.js for the four views. ----
  async function adminVisitors(req, res, url, view) {
    const email = officeGate(req, res, url);
    if (!email) return;
    const q = url.searchParams;
    // days: 0 = all time. The overview starts at 7 days; a page's own log and the lists start at all time.
    const asked = q.get('days') === 'all' ? 0 : Number(q.get('days'));
    const days = [0, 1, 7, 30, 90, 365].includes(asked) && q.has('days') ? asked : view === 'overview' ? 7 : 0;
    const key = view === 'page' ? pageKey(q.get('key') || '/') : null;
    const filter = { since: days ? now() - days * 86400000 : 0, page: key, ip: q.get('ip') || null, visitor: q.get('visitor') || null, humans: q.get('humans') === '1' };
    const before = q.get('before');
    let data = null, error = null, pageInfo = null;
    try {
      const v = store.visits;
      if (view === 'pages') data = { pages: v.pages(filter) };
      else if (view === 'previews') {
        const stats = new Map(v.pages({ ...filter, prefix: '/p/' }).map((p) => [p.page, p]));
        // Every preview report gets a row (and its log), viewed or not. The report list is read only; if it cannot be
        // read, the previews in the visit log are still listed and the page says what is missing.
        let reports = [];
        try {
          if (!reportDb.configured) throw new Error('no report database is set (REPORT_DB_URL or DATABASE_URL)');
          reports = await reportDb.allReports();
        } catch (e) { error = e.message; log(`admin visitors (previews): could not read the report list: ${e.message}`); }
        const rows = [];
        for (const r of reports ?? []) {
          if (!r?.report_id) continue;
          const page = pageKey(`/p/${r.report_id}`);
          rows.push({ ...(stats.get(page) ?? {}), page, label: r.company || '(no company name)', sub: [r.industry, r.country, page].filter(Boolean).join(' · ') });
          stats.delete(page);
        }
        // Viewed but not in the report list: say so, unless the list itself could not be read.
        for (const p of stats.values()) rows.push({ ...p, label: p.title || p.page, sub: p.page, unknown: !error });
        rows.sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
        data = { previews: rows };
      } else if (view === 'page') {
        data = {
          summary: v.summary(filter),
          people: v.people(filter),
          top: Object.fromEntries(['referrer', 'country', 'city', 'device', 'browser'].map((g) => [g, v.top(filter, g)])),
          rows: v.log(filter, { before, limit: 100 }),
        };
        // A report page: name the company. Read only; without it the log still shows.
        const id = /^\/(p|r)\/([0-9a-f-]{36})$/.exec(key);
        if (id && reportDb.configured) {
          try {
            const card = await reportDb.card(id[2]);
            if (card) pageInfo = { company: card.company, sub: `${id[1] === 'p' ? 'Free preview' : 'Full report'} · ${[card.industry, card.country].filter(Boolean).join(' · ')}` };
          } catch (e) { log(`admin visitors: could not read report ${id[2]}: ${e.message}`); }
        }
        if (id?.[1] === 'r' || (id?.[1] === 'p' && !pageInfo)) pageInfo = { ...pageInfo, note: id[1] === 'r' ? 'The stored full report is sent exactly as stored, so its views are counted but time on page and scroll are not measured.' : null };
      } else {
        data = {
          summary: v.summary(filter),
          top: Object.fromEntries(['page', 'referrer', 'country', 'city', 'device', 'os', 'browser'].map((g) => [g, v.top(filter, g)])),
          rows: v.log(filter, { before, limit: 100 }),
        };
      }
    } catch (e) {
      error = e.message;
      log(`admin visitors (${view}): could not read visits: ${e.stack ?? e.message}`);
    }
    return html(res, 200, visitorsPage({ view, email, days, filter, data, error, pageInfo, geoOn: Boolean(geo?.configured), tz: config.analyticsTz, before }));
  }

  async function adminMarkReady(req, res, id) {
    if (!officeWho(req)) return redirect(res, `${OFFICE}/login?next=${encodeURIComponent(`${OFFICE}/previews`)}`);
    const request = store.previewById(Number(id));
    if (!request) return redirect(res, '/myoffice/previews?n=missing');
    // A report id, or the preview link (https://…/p/<id>) pasted as it is.
    const given = String((await form(req)).get('report') ?? '').trim();
    const reportId = (/\/p\/([0-9a-f-]{36})(?![0-9a-z-])/i.exec(given)?.[1] ?? given).toLowerCase();
    if (!REPORT_ID.test(reportId)) return redirect(res, '/myoffice/previews?n=bad_report');
    const { emailed } = await readyPreview(request, reportId, base(req));
    return redirect(res, `/myoffice/previews?n=${emailed ? 'ready' : 'ready_not_emailed'}`);
  }

  // Orders are only ever shown to the email they belong to.
  function ownOrder(req, id) {
    const email = accounts.currentEmail(req);
    const order = email ? store.orderById(Number(id)) : null;
    return { email, order: order && order.email === email ? order : null };
  }

  async function invoicePage(req, res, id) {
    const { email, order } = ownOrder(req, id);
    if (!email) return redirect(res, `/login?next=${encodeURIComponent(`/account/invoices/${id}`)}`);
    if (!order) return html(res, 404, pages.notFound());
    return html(res, 200, pages.invoicePage({ order, seller }));
  }

  async function resendInvoice(req, res, id) {
    const { email, order } = ownOrder(req, id);
    if (!email) return redirect(res, `/login?next=${encodeURIComponent('/account')}`);
    if (!order) return html(res, 404, pages.notFound());
    const ok = await sendInvoice(order, base(req));
    return redirect(res, `/account?mail=${ok ? 'sent' : 'failed'}`);
  }

  async function staticFile(req, res, url) {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(config.siteDir, rel);
    if (!file.startsWith(path.resolve(config.siteDir) + path.sep)) return html(res, 404, pages.notFound());
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      html(res, 404, pages.notFound());
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/ops/api/')) return await ops.handle(req, res, url);
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;
    tracker.wrap(req, res, url);
    try {
      if (route === 'POST /api/v') return await tracker.beacon(req, res, readBody);
      if (route === 'GET /myoffice') return redirect(res, `${OFFICE}/previews`);
      if (route === 'GET /myoffice/login') return await officeLoginForm(req, res, url);
      if (route === 'POST /myoffice/login') return await officeLogin(req, res);
      if (route === 'POST /myoffice/logout') return await officeLogout(req, res);
      if (route === 'GET /myoffice/users') return await adminUsers(req, res, url);
      if (route === 'GET /myoffice/users/one') return await adminUser(req, res, url);
      if (route === 'GET /myoffice/visitors') return await adminVisitors(req, res, url, 'overview');
      if (route === 'GET /myoffice/visitors/pages') return await adminVisitors(req, res, url, 'pages');
      if (route === 'GET /myoffice/visitors/previews') return await adminVisitors(req, res, url, 'previews');
      if (route === 'GET /myoffice/visitors/page') return await adminVisitors(req, res, url, 'page');
      if (route === 'GET /api/countries') return json(res, 200, { countries: RESEARCHED_COUNTRIES });
      if (req.method === 'GET' && legalPages.has(url.pathname)) return html(res, 200, pages.legalPage(legalPages.get(url.pathname), [...legalPages.values()]));
      if (route === 'GET /order') return await orderPage(req, res, url);
      if (route === 'POST /order/checkout') return await checkout(req, res);
      if (route === 'GET /order/done') return await done(req, res, url);
      if (route === 'POST /stripe/webhook') return await webhook(req, res);
      if (route === 'GET /login') return await loginPage(req, res, url);
      if (route === 'POST /login') return await requestLink(req, res);
      if (route === 'GET /login/verify') return await verifyPage(req, res, url);
      if (route === 'POST /login/verify') return await verify(req, res);
      if (route === 'POST /logout') return await logout(req, res);
      if (route === 'GET /account') return await account(req, res, url);
      if (route === 'POST /account/previews') return await requestPreview(req, res);
      if (route === 'GET /account/open') return openLink(req, res, url);
      const ready = /^POST \/api\/previews\/(\d+)\/ready$/.exec(route);
      if (ready) return await previewReady(req, res, ready[1]);
      if (route === 'GET /myoffice/previews') return await adminPreviews(req, res, url);
      if (route === 'GET /myoffice/reports' || route === 'GET /myoffice/reports/previews') return await adminReports(req, res, url, 'previews');
      if (route === 'GET /myoffice/reports/full') return await adminReports(req, res, url, 'full');
      const adminReady = /^POST \/myoffice\/previews\/(\d+)\/ready$/.exec(route);
      if (adminReady) return await adminMarkReady(req, res, adminReady[1]);
      const inv = /^(GET|POST) \/account\/invoices\/(\d+)(\/resend)?$/.exec(route);
      if (inv && inv[1] === 'GET' && !inv[3]) return await invoicePage(req, res, inv[2]);
      if (inv && inv[1] === 'POST' && inv[3]) return await resendInvoice(req, res, inv[2]);
      const reportRoute = reports.match(route, url);
      if (reportRoute) return await reportRoute(req, res);
      if (req.method === 'GET' || req.method === 'HEAD') return await staticFile(req, res, url);
      return json(res, 405, { error: 'method not allowed' });
    } catch (e) {
      log(`${route} failed: ${e.stack ?? e.message}`);
      if (!res.headersSent) html(res, 500, pages.errorPage('We could not reach our report service. Please try again in a minute.'));
    }
  };
}

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(303, { location, 'cache-control': 'no-store' });
  res.end();
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// The webhook needs the exact bytes Stripe signed, so `raw` returns a Buffer.
function readBody(req, raw = false) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(raw ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
