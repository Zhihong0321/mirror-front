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
import { overviewPage, previewsPage, reportsPage, adminPreviewsPage } from './dashboard.js';
import { previewProgress, matchFactory } from './preview-progress.js';
import { MAX_START_ATTEMPTS } from './store.js';
import { previewsListPage, fullListPage } from './admin-reports.js';
import { createTracker, pageKey } from './visits.js';
import { visitorsPage, pageLogUrl } from './visitors-page.js';
import { usersListPage, userPage } from './users-page.js';
import { createOffice, officeLoginPage, safeNext, OFFICE } from './office.js';
import { createOps } from './ops.js';
import { referralLinksPage, referralEarningsPage, referralWalletPage, adminReferralsPage } from './referrals-page.js';
import { checkWallet, cleanCode, refFromCookie, refFromUrl, refCookie, dollarsToCents, readership, COMMISSION_KEY, COMMISSION_CURRENCY, networkLabel } from './referrals.js';

const PUBLIC_ID = /^[A-Za-z0-9_-]{20}$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

export function createApp({ stripe, hub, config, store, mailer, reportDb = createReportDb(), reportFetch = fetch, factory: factoryOverride, geo = null, now = Date.now, log = console.log }) {
  const testMode = /^(sk|rk)_test_/.test(config.stripeKey);
  const priceLabel = `${config.currency.toUpperCase()} ${(config.priceCents / 100).toFixed(config.priceCents % 100 ? 2 : 0)}`;
  const priceShort = `$${config.priceCents % 100 ? (config.priceCents / 100).toFixed(2) : config.priceCents / 100}`; // "$89": the preview page's price format
  const locks = new Map(); // dive id -> the fulfilment in flight, so the webhook and the done page never start two reports
  const accounts = createAccounts({ store, mailer, now, log });
  const seller = config.seller ?? {};
  // Company-diver reports: the free preview (/p/<id>) and the paid full report (/r/<id>). See reports.js.
  const reports = createReports({ db: reportDb, hubUrl: config.reportHubUrl, store, accounts, siteOrigin: (req) => base(req), fetchImpl: reportFetch, log, price: priceShort,
    refFor: (req, id) => refCodeOf(req, new URL(req.url, 'http://local'), id)?.code ?? null });
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
      try { // the prepaid report credits the order buys; a problem is logged and the order goes on
        const credits = store.grantBundleCredits(order, now());
        if (!credits.length) log(`order ${session.id}: paid but no report credits were recorded (no account email on it)`);
      } catch (e) { log(`order ${session.id}: could not record the report credits: ${e.message}`); }
      await recordReferral(order, session, origin); // never throws; a problem is logged and the order goes on
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

  // ---- Referral program (referrals.js, docs/referrals.md) ----

  // Who sent this visitor to this report: the ?ref= code in the address, else the cookie that an earlier ?ref= left for
  // this report. A code nobody owns is ignored. Never throws. -> { code, source } or null
  function refCodeOf(req, url, reportId) {
    try {
      const asked = refFromUrl(url);
      if (asked && store.emailForReferralCode(asked)) return { code: asked, source: 'link' };
      const c = refFromCookie(req, reportId);
      if (c && store.emailForReferralCode(c)) return { code: c, source: 'cookie' };
    } catch (e) { log(`referral: could not read a referral code: ${e.message}`); }
    return null;
  }

  // Remembers an explicit ?ref= for 30 days (per report), so paying later from another page still counts. Never throws.
  function noteRef(req, res, url, reportId) {
    try {
      const asked = refFromUrl(url);
      if (!asked || !REPORT_ID.test(String(reportId).toLowerCase()) || !store.emailForReferralCode(asked)) return;
      res.setHeader('set-cookie', refCookie(asked, reportId, base(req).startsWith('https')));
    } catch (e) { log(`referral: could not remember a referral code: ${e.message}`); }
  }

  // Who gets the commission for this checkout: the code on the link, else the cookie, else the account that asked for the
  // preview of this report. -> { code, source } or null. Never throws.
  function attribution(req, f, reportId) {
    try {
      const asked = cleanCode(f.get('ref'));
      if (asked && store.emailForReferralCode(asked)) return { code: asked, source: 'link' };
      const c = refFromCookie(req, reportId);
      if (c && store.emailForReferralCode(c)) return { code: c, source: 'cookie' };
      const requester = store.previewRequester(reportId);
      const code = requester ? store.referralCode(requester) : null;
      return code ? { code, source: 'requester' } : null;
    } catch (e) {
      log(`referral: could not work out the referrer of report ${reportId}: ${e.message}`);
      return null;
    }
  }

  // A paid order that came through a referral becomes a commission row (once per order). The amount is the commission
  // setting at this moment. The buyer being the referrer earns the fee like any sale, and is labelled "Own purchase".
  // Nothing here can stop the order, the invoice or the report: a problem is logged and the order goes on.
  async function recordReferral(order, session, origin) {
    try {
      // Our own record of the checkout comes first; Stripe's metadata is the fallback (a checkout made before this record existed).
      const seen = (() => { try { return store.checkoutReferral(session.id); } catch { return null; } })();
      const code = cleanCode(seen?.referrer_code) ?? cleanCode(session.metadata?.referrer_code);
      if (!code || !order.report_id) return;
      const referrer = store.emailForReferralCode(code);
      if (!referrer) { log(`order ${session.id}: paid with referral code ${code}, but no account owns that code. No commission recorded.`); return; }
      const self = referrer === order.email;
      const { commission, created } = store.recordCommission({
        orderId: order.id, referrerEmail: referrer, buyerEmail: order.email, reportId: order.report_id, company: order.company,
        amountCents: store.commissionCents(), currency: COMMISSION_CURRENCY, status: 'pending', // an own purchase earns the fee too (owner, 2026-11-12)
        note: self ? 'Own purchase: the buyer is the referrer.' : null,
        source: [seen?.source, session.metadata?.referrer_source].find((x) => ['link', 'cookie', 'requester'].includes(x)) ?? 'link', now: now(),
      });
      if (!created || commission.status !== 'pending') return;
      log(`order ${session.id}: referral commission #${commission.id} of ${commission.amount_cents / 100} for ${referrer}`);
      await mailer.send({ to: referrer, kind: 'referral-earned', ...emails.referralEarned({
        company: order.company, amountCents: commission.amount_cents, referralsUrl: `${origin}/account/referrals`, hasWallet: Boolean(store.payoutWallet(referrer)),
      }) });
    } catch (e) {
      log(`order ${session.id}: could not record the referral commission: ${e.stack ?? e.message}`);
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

  async function orderReportPage(req, res, id, url) {
    if (!REPORT_ID.test(id)) return html(res, 404, pages.notFound());
    noteRef(req, res, url, id);
    const email = accounts.currentEmail(req);
    if (email && store.hasReportOrder(email, id)) return redirect(res, `/r/${id}`); // already bought: never pay twice
    const company = await reportCompany(id);
    if (!company) return html(res, 404, pages.notFound());
    return html(res, 200, pages.orderPage({ dive: { publicId: id, company }, field: 'report', price: priceLabel, testMode, email, ref: refCodeOf(req, url, id)?.code ?? null }));
  }

  async function orderPage(req, res, url) {
    const reportParam = url.searchParams.get('report') ?? UUID_IN.exec(url.searchParams.get('preview') ?? '')?.[0] ?? '';
    if (reportParam) return orderReportPage(req, res, reportParam.toLowerCase(), url);
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

  async function checkoutReport(req, res, id, f) {
    if (!REPORT_ID.test(id)) return html(res, 404, pages.notFound());
    const email = accounts.currentEmail(req);
    if (!email) return redirect(res, `/login?next=${encodeURIComponent(`/order?report=${id}`)}`);
    if (store.hasReportOrder(email, id)) return redirect(res, `/r/${id}`);
    const company = await reportCompany(id);
    if (!company) return html(res, 404, pages.notFound());
    const ref = attribution(req, f, id); // who is credited with this sale, if anyone (referral program)
    const metadata = { report_id: id, company: company.slice(0, 500), account_email: email, ...(ref ? { referrer_code: ref.code, referrer_source: ref.source } : {}) };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: { currency: config.currency, unit_amount: config.priceCents, product_data: { name: `MirrorMirror full report bundle: ${company}`.slice(0, 250) } },
      }],
      client_reference_id: id,
      customer_email: email,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${base(req)}/order/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base(req)}/order?report=${id}`,
    });
    // Record in our own database whether a referrer was detected on this checkout, paid or not. Never throws.
    try {
      const referrerEmail = ref ? store.emailForReferralCode(ref.code) : null;
      store.recordCheckoutReferral({ sessionId: session.id, reportId: id, company, buyerEmail: email, code: ref?.code ?? null, referrerEmail, source: ref?.source ?? null, now: now() });
      log(`checkout ${session.id} (report ${id}, ${email}): ${ref ? `referrer detected, code ${ref.code} (${ref.source})` : 'no referrer'}`);
    } catch (e) { log(`checkout ${session.id}: could not record the referrer: ${e.message}`); }
    res.writeHead(303, { location: session.url, 'cache-control': 'no-store' });
    res.end();
  }

  async function checkout(req, res) {
    const f = new URLSearchParams(await readBody(req));
    if (f.get('report')) return checkoutReport(req, res, f.get('report').toLowerCase(), f);
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
        price_data: { currency: config.currency, unit_amount: config.priceCents, product_data: { name: `MirrorMirror full report bundle: ${dive.company}`.slice(0, 250) } },
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

  // Progress of each open free preview: place in line, and (when the report factory has started the company) its step.
  // Never throws and waits at most 4 seconds for the factory; without it the buyer still sees the place in line.
  // A request the site started on the factory whose preview is written (step 3 done) is made ready here and the buyer
  // emailed the link, with no person in between. Returns how many it made ready. Never throws.
  async function finishPreviews(open, rows, origin) {
    let n = 0;
    for (const p of open) {
      try {
        const row = p.factory_report_id && rows.find((r) => String(r?.report_id) === String(p.factory_report_id));
        if (!row || String(row.step3_status).toLowerCase() !== 'done' || !origin) continue;
        const { emailed } = await readyPreview(p, String(p.factory_report_id).toLowerCase(), origin);
        log(`preview request #${p.id} (${p.company}): preview written, marked ready${emailed ? ' and the buyer was emailed' : '; the email did not go yet'}`);
        n += 1;
      } catch (e) { log(`preview request #${p.id}: could not mark it ready: ${e.message}`); }
    }
    return n;
  }

  const factoryRows = async (open) => {
    if (!reportDb.configured || !open.length) return [];
    let timer;
    try {
      return await Promise.race([
        reportDb.startedSince(Math.min(...open.map((p) => Number(p.created_at))) - 60_000),
        new Promise((_, no) => { timer = setTimeout(() => no(new Error('timed out')), 4000); }),
      ]);
    } catch (e) { log(`could not read the factory's progress: ${e.message}`); return []; } finally { clearTimeout(timer); }
  };

  async function previewProgresses(previews, origin) {
    let open = previews.filter((p) => p.status !== 'ready');
    const out = {};
    if (!open.length) return { progress: out, previews };
    const rows = await factoryRows(open);
    if (await finishPreviews(open, rows, origin)) {
      previews = store.previewsFor(previews[0].email);
      open = previews.filter((p) => p.status !== 'ready');
    }
    for (const p of open) {
      try {
        let ahead = null;
        try { ahead = store.previewsAhead(p); } catch { /* no place in line shown */ }
        out[p.id] = previewProgress({ request: p, ahead, factory: matchFactory(p, rows), now: now() });
      } catch (e) { log(`dashboard: progress of preview ${p.id}: ${e.message}`); }
    }
    return { progress: out, previews };
  }

  const safe = (what, read, fallback) => { try { return read(); } catch (e) { log(`account: ${what}: ${e.message}`); return fallback; } };

  // The frame around every account page: who is signed in, and the small numbers in the sidebar. Never throws.
  function shellFor(req, email) {
    const nav = { previews: 0, reports: 0, pendingCents: 0, walletMissing: false };
    try {
      nav.previews = store.previewsFor(email).length;
      nav.reports = store.ordersFor(email).length;
      const pending = store.commissionsFor(email).filter((c) => c.status === 'pending');
      nav.pendingCents = pending.reduce((t, c) => t + Number(c.amount_cents || 0), 0);
      nav.walletMissing = pending.length > 0 && !store.payoutWallet(email);
    } catch (e) { log(`account: could not read the sidebar numbers for ${email}: ${e.message}`); }
    return { email, nav, isAdmin: office.isIn(req) };
  }

  // The account pages. Overview /account, Free previews /account/previews, Full reports /account/reports; each has its
  // own job (see account-ui.js). A signed-out visitor is sent to sign in and brought back.
  function accountEmail(req, res, url) {
    const email = accounts.currentEmail(req);
    if (!email) redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    return email;
  }

  async function account(req, res, url) {
    const email = accountEmail(req, res, url);
    if (!email) return;
    const q = url.searchParams;
    // Older links: the landing page's company form and the notices used to point at /account itself.
    if (['company', 'who', 'country', 'website', 'n'].some((k) => q.has(k))) return redirect(res, `/account/previews${url.search}`);
    if (q.has('mail')) return redirect(res, `/account/reports${url.search}`);
    const { previews } = await previewProgresses(store.previewsFor(email), config.publicUrl || base(req));
    const commissions = safe('commissions', () => store.commissionsFor(email), []);
    const earnings = { pendingCents: commissions.filter((c) => c.status === 'pending').reduce((t, c) => t + Number(c.amount_cents || 0), 0) };
    return html(res, 200, overviewPage({ shell: shellFor(req, email), previews, orders: store.ordersFor(email), earnings, price: priceLabel, credits: safe('credits', () => store.creditBalance(email), { full_report: 0, 'ads research': 0 }) }));
  }

  // "Did they read it?" for each ready preview in the list: { [request id]: readership() | null }. The same tracker rows as
  // /account/referrals (a referrer's own visits left out, bots labelled). A problem reading it gives null for that preview,
  // which the page shows as a label; the page itself always renders.
  function readsFor(email, previews) {
    const reads = {};
    const ready = previews.filter((p) => p.status === 'ready' && p.report_id);
    if (!ready.length) return reads;
    let byKey = null;
    try {
      const code = safe('code', () => store.referralCode(email), null);
      const rows = store.visits.referrerViews({ email, code, keys: ready.map((p) => pageKey(`/p/${String(p.report_id).toLowerCase()}`)) });
      byKey = new Map();
      for (const r of rows) { if (!byKey.has(r.page_key)) byKey.set(r.page_key, []); byKey.get(r.page_key).push(r); }
    } catch (e) { log(`previews: could not read the tracker for ${email}: ${e.message}`); }
    for (const p of ready) reads[p.id] = byKey ? safe('verdict', () => readership(byKey.get(pageKey(`/p/${String(p.report_id).toLowerCase()}`)) ?? []), null) : null;
    return reads;
  }

  // Free previews: ask for one, follow each one. `n` picks a notice (see dashboard.js); company, who, country and website
  // prefill the request form (the landing page sends people here with them).
  async function accountPreviews(req, res, url) {
    const email = accountEmail(req, res, url);
    if (!email) return;
    const q = url.searchParams;
    const { progress, previews } = await previewProgresses(store.previewsFor(email), config.publicUrl || base(req));
    return html(res, 200, previewsPage({
      shell: shellFor(req, email), previews, progress, reads: readsFor(email, previews), now: now(), notice: q.get('n') ?? null,
      prefill: { company: q.get('company') ?? '', who: q.get('who') ?? '', country: q.get('country') ?? undefined, website: q.get('website') ?? '' },
    }));
  }

  // Full reports: what was bought, and where each one stands.
  async function accountReports(req, res, url) {
    const email = accountEmail(req, res, url);
    if (!email) return;
    const q = url.searchParams;
    const mail = q.get('mail');
    const notice = mail === 'sent' ? 'sent' : mail === 'failed' ? 'failed' : (q.get('n') ?? null);
    const orders = store.ordersFor(email);
    const statuses = {};
    await Promise.all(orders.slice(0, 30).map(async (o) => { statuses[o.id] = await reportStatus(o); }));
    return html(res, 200, reportsPage({ shell: shellFor(req, email), orders, statuses, notice, price: priceLabel }));
  }

  // ---- Free previews ----

  const clean = (v, max) => String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  // Starts one request's preview on the report factory and records the report id on the request (the exact link used by
  // the status list). Never throws and never blocks the request: a failure is recorded on the request and logged, the
  // request stays listed, the team alert email still went out, and the sweeper tries again (up to MAX_START_ATTEMPTS).
  const starting = new Set();
  async function startPreviewRun(request) {
    if (!config.previewAutoStart || typeof factory.startPreview !== 'function' || starting.has(request.id)) return;
    starting.add(request.id);
    try {
      if (!request.country) { store.markPreviewStartFailed(request.id, 'no country given, so it cannot start by itself', MAX_START_ATTEMPTS); return; }
      const out = await factory.startPreview({ company: request.company, country: request.country, industry: config.previewIndustry, website: request.website || '' });
      store.markPreviewStarted(request.id, out.reportId, now());
      log(`preview request #${request.id} (${request.company}): started on the factory as report ${out.reportId}`);
    } catch (e) {
      try { store.markPreviewStartFailed(request.id, e.message); } catch { /* the log line below still says it */ }
      log(`preview request #${request.id} (${request.company}): could not start on the factory: ${e.message}`);
    } finally { starting.delete(request.id); }
  }

  // Run by server.js every minute: starts any open request that has not been started (the factory was down, the key was
  // not set yet, the site restarted mid-request). One at a time, three per round.
  async function sweepPreviews() {
    if (!config.previewAutoStart) return 0;
    let n = 0;
    try { for (const r of store.previewsToStart(3)) { await startPreviewRun(r); n += 1; } } catch (e) { log(`preview sweep: ${e.message}`); }
    try {
      const open = store.startedOpenPreviews();
      if (open.length) await finishPreviews(open, await factoryRows(open), config.publicUrl);
    } catch (e) { log(`preview sweep (finish): ${e.message}`); }
    return n;
  }

  async function requestPreview(req, res) {
    const email = accounts.currentEmail(req);
    if (!email) return redirect(res, `/login?next=${encodeURIComponent('/account/previews')}`);
    const f = await form(req);
    const company = clean(f.get('company'), 200);
    if (!company) return redirect(res, '/account/previews?n=company');
    const who = ['mine', 'rival', 'supplier'].includes(f.get('who')) ? f.get('who') : 'mine';
    const out = store.addPreviewRequest({ email, company, who, country: clean(f.get('country_other') || f.get('country'), 80), website: clean(f.get('website'), 200) }, now());
    if (out.limited) return redirect(res, '/account/previews?n=limit');
    if (out.duplicate) return redirect(res, '/account/previews?n=duplicate');
    const origin = base(req);
    const { request } = out;
    // Tell the buyer we have it, and tell the team there is work. Neither can stop the request: it is already saved.
    await Promise.all([
      mailer.send({ to: email, kind: 'preview-requested', ...emails.previewRequested({ request, accountUrl: `${origin}/account` }) }),
      config.previewAlertEmail
        ? mailer.send({ to: config.previewAlertEmail, kind: 'preview-alert', ...emails.previewAlert({ request, adminUrl: `${origin}/api/previews/${request.id}/ready` }) })
        : log(`preview request #${request.id} (${request.company}) saved, but PREVIEW_ALERT_EMAIL is not set so nobody was told.`),
    ]);
    await startPreviewRun(request);
    return redirect(res, '/account/previews?n=requested');
  }

  // "I already have a preview link": send them to the right page.
  function openLink(req, res, url) {
    const link = url.searchParams.get('link') ?? '';
    const uuid = /\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-z-])/i.exec(link) ?? (REPORT_ID.test(link.trim()) ? [null, link.trim()] : null);
    if (uuid) { const ref = cleanCode(/[?&]ref=([A-Za-z0-9]+)/.exec(link)?.[1]); return redirect(res, `/p/${uuid[1].toLowerCase()}${ref ? `?ref=${ref}` : ''}`); }
    const dive = /\/dp\/([A-Za-z0-9_-]{20})(?![A-Za-z0-9_-])/.exec(link);
    if (dive) return redirect(res, `/order?dive=${dive[1]}`);
    return redirect(res, '/account/previews?n=bad_link');
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
      // The link in the email already carries the asker's referral code: they are the one who sends it on.
      let code = null;
      try { code = store.referralCode(ready.email); } catch { /* a plain link: the email still goes */ }
      const sent = await mailer.send({ to: ready.email, kind: 'preview-ready', ...emails.previewReady({ request: ready, previewUrl: `${origin}/p/${reportId}${code ? `?ref=${code}` : ''}`, accountUrl: `${origin}/account` }) });
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

  // ---- Referral pages: /account/referrals (any signed-in account) and /myoffice/referrals (the team) ----

  const within = (ms, p) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error('timed out')), ms); })]).finally(() => clearTimeout(t)); };
  const PREVIEW_LINK = /\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-z-])/i;

  // The referrer's own page: code, earnings, wallet, their previews with the visitor tracker, commissions.
  // Each part is read on its own: one that cannot be read leaves a label on that part, the page still shows.
  async function referrals(req, res, url, view = 'links') {
    const email = accountEmail(req, res, url);
    if (!email) return;
    const origin = base(req);
    const code = safe('code', () => store.referralCode(email), null);
    const linkOf = (id) => `${origin}/p/${id}${code ? `?ref=${code}` : ''}`;
    const commissions = safe('commissions', () => store.commissionsFor(email), []);
    const wallet = safe('wallet', () => store.payoutWallet(email), null);
    const shell = shellFor(req, email);
    const common = { shell, code, commissionCents: store.commissionCents(), wallet, commissions, notice: url.searchParams.get('n'), now: now(), tz: config.analyticsTz };
    if (view === 'earnings') return html(res, 200, referralEarningsPage(common));
    if (view === 'wallet') return html(res, 200, referralWalletPage(common));
    const mine = safe('previews', () => store.previewsFor(email), []);
    const readyId = (p) => (p.status === 'ready' && p.report_id ? String(p.report_id).toLowerCase() : null);

    // The tracker: every human view of the previews they asked for, and of any other preview opened through their link.
    let byKey = null;
    try {
      const rows = store.visits.referrerViews({ email, code, keys: mine.map(readyId).filter(Boolean).map((id) => pageKey(`/p/${id}`)) });
      byKey = new Map();
      for (const r of rows) { if (!byKey.has(r.page_key)) byKey.set(r.page_key, []); byKey.get(r.page_key).push(r); }
    } catch (e) { log(`referrals: could not read the tracker for ${email}: ${e.message}`); }
    const track = (id) => {
      const rows = byKey ? (byKey.get(pageKey(`/p/${id}`)) ?? []) : null;
      return { read: rows ? safe('verdict', () => readership(rows), null) : null, rows: rows ?? [], sold: commissions.find((c) => c.report_id === id) ?? null };
    };
    const previews = mine.map((p) => {
      const id = readyId(p);
      const meta = `${emails.whoLabel(p.who)}${p.country ? ` · ${p.country}` : ''} · asked ${new Date(p.created_at).toISOString().slice(0, 10)}`;
      return id ? { company: p.company, meta, reportId: id, link: linkOf(id), ...track(id) } : { company: p.company, meta, link: null };
    });
    const ownIds = new Set(mine.map(readyId).filter(Boolean));
    const others = [];
    if (byKey) {
      for (const key of [...byKey.keys()].slice(0, 20)) {
        const id = /^\/p\/(.+)$/.exec(key)?.[1];
        if (!id || ownIds.has(id)) continue;
        let company = null;
        try { if (reportDb.configured) company = (await within(4000, reportDb.card(id)))?.company ?? null; } catch (e) { log(`referrals: could not read report ${id}: ${e.message}`); }
        others.push({ company: company || `Preview ${id.slice(0, 8)}`, reportId: id, link: linkOf(id), ...track(id) });
      }
    }

    // "Get your link for any preview": a pasted preview link or report id -> the same page with their code on it.
    let made = null;
    let notice = url.searchParams.get('n');
    const given = (url.searchParams.get('link') ?? '').trim().slice(0, 600);
    if (given) {
      const id = (PREVIEW_LINK.exec(given)?.[1] ?? (REPORT_ID.test(given) ? given : null))?.toLowerCase();
      made = { input: given, link: id ? linkOf(id) : null };
      if (!id) notice = 'link_bad';
    }
    return html(res, 200, referralLinksPage({ ...common, notice, made, previews, others }));
  }

  // Saves (or removes) the USDT wallet. An address that does not check out is refused with the reason; nothing else changes.
  async function saveWallet(req, res) {
    const email = accounts.currentEmail(req);
    if (!email) return redirect(res, `/login?next=${encodeURIComponent('/account/referrals/wallet')}`);
    const f = await form(req);
    if (f.get('clear')) { store.clearPayoutWallet(email); return redirect(res, '/account/referrals/wallet?n=wallet_cleared'); }
    const network = f.get('network') ?? '';
    const r = checkWallet(network, f.get('address'));
    if (!r.ok) return redirect(res, `/account/referrals/wallet?n=wallet_${r.reason}`);
    store.setPayoutWallet(email, network, r.address, now());
    return redirect(res, '/account/referrals/wallet?n=wallet_saved');
  }

  async function adminReferrals(req, res, url) {
    const email = officeGate(req, res, url);
    if (!email) return;
    const d = { email, commissionCents: store.commissionCents(), notice: url.searchParams.get('n'), now: now(), tz: config.analyticsTz, commissions: [], totals: [], wallets: new Map(), error: null };
    try {
      d.commissions = store.allCommissions(500);
      d.totals = store.referrerTotals();
      d.checkouts = store.recentCheckouts(100);
      d.wallets = new Map(d.totals.filter((t) => t.payout_wallet).map((t) => [t.email, { network: t.payout_network, address: t.payout_wallet }]));
    } catch (e) { d.error = `The referral list could not be read: ${e.message}`; log(`admin referrals: ${e.stack ?? e.message}`); }
    return html(res, 200, adminReferralsPage(d));
  }

  async function adminSetCommission(req, res) {
    if (!officeWho(req)) return redirect(res, `${OFFICE}/login?next=${encodeURIComponent('/myoffice/referrals')}`);
    const cents = dollarsToCents((await form(req)).get('usd'));
    if (cents == null) return redirect(res, '/myoffice/referrals?n=commission_bad');
    store.setSetting(COMMISSION_KEY, cents, now());
    log(`office: referral commission set to ${cents / 100} per sold report`);
    return redirect(res, '/myoffice/referrals?n=commission_saved');
  }

  // Mark paid (after the team sent the USDT by hand), cancel, or approve a held commission. Safe to press twice.
  async function adminCommissionAction(req, res, id, action) {
    if (!officeWho(req)) return redirect(res, `${OFFICE}/login?next=${encodeURIComponent('/myoffice/referrals')}`);
    const c = store.commissionById(Number(id));
    if (!c) return redirect(res, '/myoffice/referrals?n=missing');
    const open = c.status === 'pending' || c.status === 'held';
    if (action === 'approve' && c.status === 'held') { store.setCommissionStatus(c.id, 'pending', null); return redirect(res, '/myoffice/referrals?n=approved'); }
    if (action === 'void' && open) { store.setCommissionStatus(c.id, 'void', c.note); return redirect(res, '/myoffice/referrals?n=voided'); }
    if (action === 'paid' && open) {
      const w = store.payoutWallet(c.referrer_email);
      const tx = clean((await form(req)).get('tx'), 200);
      const paid = store.markCommissionPaid(c.id, { network: w?.network, wallet: w?.address, tx }, now());
      log(`office: referral commission #${c.id} marked paid (${paid.amount_cents / 100} to ${c.referrer_email})`);
      const sent = await mailer.send({ to: c.referrer_email, kind: 'referral-paid', ...emails.referralPaid({
        company: c.company, amountCents: c.amount_cents, tx, network: w ? networkLabel(w.network) : null, wallet: w?.address, referralsUrl: `${base(req)}/account/referrals`,
      }) });
      return redirect(res, `/myoffice/referrals?n=${sent.ok ? 'paid' : 'paid_not_emailed'}`);
    }
    return redirect(res, '/myoffice/referrals');
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
    return redirect(res, `/account/reports?mail=${ok ? 'sent' : 'failed'}`);
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

  async function handle(req, res) {
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
      if (route === 'GET /account/previews') return await accountPreviews(req, res, url);
      if (route === 'GET /account/reports') return await accountReports(req, res, url);
      if (route === 'POST /account/previews') return await requestPreview(req, res);
      if (route === 'GET /account/open') return openLink(req, res, url);
      if (route === 'GET /account/referrals') return await referrals(req, res, url, 'links');
      if (route === 'GET /account/referrals/earnings') return await referrals(req, res, url, 'earnings');
      if (route === 'GET /account/referrals/wallet') return await referrals(req, res, url, 'wallet');
      if (route === 'POST /account/referrals/wallet') return await saveWallet(req, res);
      if (route === 'GET /myoffice/referrals') return await adminReferrals(req, res, url);
      if (route === 'POST /myoffice/referrals/commission') return await adminSetCommission(req, res);
      const commissionAct = /^POST \/myoffice\/referrals\/(\d+)\/(paid|void|approve)$/.exec(route);
      if (commissionAct) return await adminCommissionAction(req, res, commissionAct[1], commissionAct[2]);
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
      const previewView = /^GET \/p\/([^/]+)$/.exec(route);
      if (previewView) noteRef(req, res, url, previewView[1].toLowerCase()); // remember who sent this visitor (referral program)
      const reportRoute = reports.match(route, url);
      if (reportRoute) return await reportRoute(req, res);
      if (req.method === 'GET' || req.method === 'HEAD') return await staticFile(req, res, url);
      return json(res, 405, { error: 'method not allowed' });
    } catch (e) {
      log(`${route} failed: ${e.stack ?? e.message}`);
      if (!res.headersSent) html(res, 500, pages.errorPage('We could not reach our report service. Please try again in a minute.'));
    }
  }
  handle.sweepPreviews = sweepPreviews; // server.js runs it every minute
  return handle;
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
