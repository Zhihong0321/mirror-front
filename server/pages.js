// HTML for the order pages. Same fonts and colours as site/index.html.

import { REPORT_MINUTES } from './emails.js';
import { siteFooter, FOOTER_CSS, LEGAL_CSS } from './legal.js';
import { orderPage, checkoutShell, checkoutLogin, checkoutCheckEmail, fromCheckout } from './checkout-page.js';

export { orderPage };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// `wide` is for the dashboard; `css` adds page-specific rules.
// `index` lets search engines index the page (legal pages); `footer: false` leaves the standard footer off.
export function page(title, body, { refresh, wide, css, bare, headNote, index, footer = true } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${index ? '' : '<meta name="robots" content="noindex, nofollow">'}
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${esc(title)} · MirrorMirror</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600&family=Inter:wght@400;500;600;700&display=swap">
<style>
:root { --ink:#111418; --grey:#5c636d; --line:#e6e8eb; --band:#f2f3f5; --paper:#fff; --wrong:#b42318; --good:#067647; --good-bg:#e7f6ee;
  --display:"Inter Tight","Inter",system-ui,sans-serif; --body:"Inter",system-ui,sans-serif; }
* { box-sizing:border-box; }
body { margin:0; background:var(--band); color:var(--ink); font-family:var(--body); font-size:17px; line-height:1.55; -webkit-font-smoothing:antialiased; }
header { padding:20px 16px; max-width:640px; margin:0 auto; }
header a { font-family:var(--display); font-weight:600; letter-spacing:-0.02em; color:inherit; text-decoration:none; font-size:20px; }
main { width:calc(100% - 32px); max-width:640px; margin:0 auto 64px; padding:36px clamp(20px,5vw,44px); background:var(--paper); border:1px solid var(--line); border-radius:14px; }
h1 { font-family:var(--display); font-weight:600; letter-spacing:-0.03em; line-height:1.08; font-size:clamp(28px,5vw,40px); margin:0 0 14px; text-wrap:balance; }
p { margin:0 0 14px; color:var(--grey); }
p b, li b { color:var(--ink); }
.price { font-family:var(--display); font-weight:600; font-size:44px; letter-spacing:-0.03em; color:var(--ink); margin:22px 0 4px; }
ul { padding-left:20px; margin:0 0 22px; color:var(--grey); }
form { margin:0; }
input[type=url], input[type=text], input[type=email] { width:100%; font:inherit; padding:12px 14px; border:1px solid var(--line); border-radius:10px; margin:0 0 12px; }
.btn { display:inline-block; font:600 17px var(--body); background:var(--ink); color:#fff; border:0; border-radius:10px; padding:14px 22px; cursor:pointer; text-decoration:none; }
.btn:hover { background:#000; }
.note { font-size:14px; margin-top:18px; }
.err { color:var(--wrong); }
.ok { display:inline-block; background:var(--good-bg); color:var(--good); font-weight:600; font-size:14px; padding:4px 10px; border-radius:99px; margin-bottom:14px; }
.small { font-size:14px; color:var(--grey); }
.okline { color:var(--good); font-weight:600; }
.btn.quiet { background:#fff; color:var(--ink); border:1px solid var(--line); }
.btn.quiet:hover { background:var(--band); }
table.orders { width:100%; border-collapse:collapse; margin:0 0 22px; font-size:16px; }
table.orders td { padding:12px 8px 12px 0; border-top:1px solid var(--line); vertical-align:top; }
td.acts { text-align:right; white-space:nowrap; }
td.acts form { display:inline; }
button.link { font:inherit; font-size:14px; background:none; border:0; padding:0; color:var(--grey); text-decoration:underline; cursor:pointer; }
@media print { header, .noprint { display:none; } body { background:#fff; } main { border:0; } }
.test { background:#fdf3e2; color:#a15c07; font-size:14px; padding:10px 14px; border-radius:10px; margin-bottom:18px; }
${wide ? 'header, main { max-width:980px; }' : ''}
${bare ? 'main { background:none; border:0; border-radius:0; padding:0; } header { display:flex; align-items:center; justify-content:space-between; gap:12px; }' : ''}
${css ?? ''}
${FOOTER_CSS}
</style>
</head>
<body>
<header><a href="/">MirrorMirror</a>${headNote ? `<span class="headnote">${headNote}</span>` : ''}</header>
<main>${body}</main>
${footer ? siteFooter() : ''}
</body>
</html>`;
}

// A legal page (/legal, /terms, /privacy, /disclaimer, /corrections). `entry` is from legal.js loadLegal().
export function legalPage(entry, all = []) {
  const others = all.filter((p) => p.path !== entry.path).map((p) => `<a href="${p.path}">${esc(p.title)}</a>`).join(' · ');
  const draft = entry.draft ? '<p class="draft">Some details on this page, marked "to be confirmed", are still being filled in.</p>' : '';
  return page(entry.title, `<div class="legal">${draft}${entry.html}${others ? `<p class="others">Also read: ${others}</p>` : ''}</div>`, { css: LEGAL_CSS, index: true });
}

const testBanner = (testMode) => testMode ? '<p class="test"><b>Test mode.</b> No real money moves. Pay with card 4242 4242 4242 4242, any future date, any CVC.</p>' : '';

// No company in the link: ask for the preview link the buyer was sent.
export function chooseCompany({ error, testMode } = {}) {
  return page('Order the full report', `${testBanner(testMode)}
<h1>Order the full report</h1>
<p>Paste the link to the free preview you were sent. The full report is made from the same research.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="get" action="/order">
<input type="url" name="preview" placeholder="https://…/p/… or …/dp/…" required>
<button class="btn" type="submit">Continue</button>
</form>`);
}

export function notReady({ dive, testMode }) {
  return page('Not ready yet', `${testBanner(testMode)}
<h1>The research on ${esc(dive.company)} is not finished</h1>
<p>The full report is made from the free preview's research, which is still ${esc(dive.diveStatus)}. Try again in a few minutes.</p>
<p><a class="btn" href="${esc(dive.previewUrl)}">Open the free preview</a></p>`);
}

export function notFound() {
  return page('Not found', `<h1>We could not find that report</h1>
<p>Check the link you were sent, or <a href="/order">paste your preview link again</a>.</p>`);
}

// After Stripe sends the buyer back. `report` is null until the full report has been started.
// `invoice` = { email, sent } once the paid order is recorded, else null.
export function donePage({ paid, company, report, testMode, invoice }) {
  if (!paid) {
    return checkoutShell('Payment processing', 2, `<h1>Your payment is still processing</h1>
<p>Some payment methods take a little while. This page checks again every 15 seconds. You do not need to pay again.</p>`, { testMode, refresh: 15 });
  }
  if (!report?.reportUrl) {
    return checkoutShell('Payment received', 3, `<span class="ok">Paid</span>
<h1>Thank you. We are starting your report on ${esc(company)}</h1>
<p>This page refreshes in a few seconds with the link to your report.</p>`, { testMode, refresh: 5 });
  }
  return checkoutShell('Payment received', 3, `<span class="ok">Paid</span>
<h1>Your report on ${esc(company)} is on its way</h1>
<p>It takes about ${REPORT_MINUTES} minutes to make. The link works now: the page shows its progress and fills in by itself when it is done.</p>
<p><a class="btn" href="${esc(report.reportUrl)}">Open your report</a></p>
${invoice?.email ? (invoice.sent
    ? `<p class="note">Your invoice and this link were emailed to <b>${esc(invoice.email)}</b>. Find them any time in <a href="/account">your account</a>.</p>`
    : `<p class="note">We could not email your invoice to <b>${esc(invoice.email)}</b> just now. It is saved in <a href="/account">your account</a>, where you can send it again.</p>`) : ''}
${invoice?.email ? (invoice.signIn
    ? `<p class="note">We also emailed a sign-in link to <b>${esc(invoice.email)}</b>. Use it to follow the report in <a href="/account">your account</a> from any device.</p>`
    : `<p class="note">We could not email the sign-in link to <b>${esc(invoice.email)}</b> just now. You can always <a href="/login">sign in with your email</a> to see your report.</p>`) : ''}
<p class="note">Keep this link. Anyone with it can open the report.</p>
<p><a class="btn quiet" href="/account">See all my reports and their status</a></p>`, { testMode });
}

// ---- Sign in (no password: a link is emailed) ----

export function loginPage({ next, email = '', error = null, testMode } = {}) {
  if (fromCheckout(next)) return checkoutLogin({ next, email, error, testMode });
  return page('Sign in', `<h1>Sign in</h1>
<p>Enter your email. We send you a link that signs you in. There is no password, and no account to set up: your email is your account.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(next ?? '')}">
<input type="email" name="email" value="${esc(email)}" placeholder="you@company.com" autocomplete="email" required>
<button class="btn" type="submit">Email me a sign-in link</button>
</form>`);
}

export function checkEmailPage({ email, minutes, next, testMode }) {
  if (fromCheckout(next)) return checkoutCheckEmail({ email, minutes, next, testMode });
  return page('Check your email', `<span class="ok">Link sent</span>
<h1>Check your email</h1>
<p>We sent a sign-in link to <b>${esc(email)}</b>. It works once and expires in ${esc(minutes)} minutes.</p>
<p class="note">Nothing yet? Look in spam, or <a href="/login">ask for a new link</a>. A new link cancels the earlier one, so use the newest email.</p>`);
}

// The emailed link opens this. Pressing the button signs in, so a mail scanner opening the link cannot use it up.
export function verifyPage({ token, email }) {
  return page('Confirm sign in', `<h1>Sign in as ${esc(email)}</h1>
<form method="post" action="/login/verify">
<input type="hidden" name="token" value="${esc(token)}">
<button class="btn" type="submit">Continue</button>
</form>`);
}

export function linkInvalidPage() {
  return page('Link not valid', `<h1>That sign-in link no longer works</h1>
<p>It was already used, it expired, or you asked for a newer link (a new link cancels the one before it).</p>
<p><a class="btn" href="/login">Get a new link</a></p>`);
}

// ---- Invoices (the dashboard itself is in dashboard.js) ----

const fmtMoney = (cents, currency) => `${String(currency).toUpperCase()} ${(cents / 100).toFixed(2)}`;
const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);

export function invoicePage({ order, seller }) {
  const sellerLines = [seller?.name, seller?.address, seller?.note].filter(Boolean);
  return page(`Invoice ${order.invoice_no}`, `<h1>Invoice ${esc(order.invoice_no)}</h1>
<table class="orders"><tbody>
<tr><td>Date</td><td>${esc(fmtDate(order.paid_at))}</td></tr>
<tr><td>Billed to</td><td>${esc(order.email)}</td></tr>
<tr><td>Item</td><td>MirrorMirror full report: ${esc(order.company)}</td></tr>
<tr><td>Total paid</td><td><b>${esc(fmtMoney(order.amount_cents, order.currency))}</b></td></tr>
<tr><td>Paid</td><td>By card, through Stripe</td></tr>
</tbody></table>
${sellerLines.length ? `<p class="note">${sellerLines.map(esc).join('<br>')}</p>` : ''}
<p class="note noprint"><a href="/account">Back to your account</a> · Use your browser's Print to save a PDF.</p>`);
}

export function mailFailedPage() {
  return page('Could not send', `<h1>We could not send the email</h1><p class="err">Our email service did not accept it just now. Please try again in a minute.</p><p><a class="btn" href="/login">Try again</a></p>`);
}

export function errorPage(message) {
  return page('Something went wrong', `<h1>Something went wrong</h1><p class="err">${esc(message)}</p><p>If you have already paid, do not pay again: reply to the email you were sent and we will sort it out.</p>`);
}
