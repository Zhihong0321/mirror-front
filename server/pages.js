// HTML for the order pages. Same fonts and colours as site/index.html.

import { REPORT_MINUTES } from './emails.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// `wide` is for the dashboard; `css` adds page-specific rules.
export function page(title, body, { refresh, wide, css } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
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
${css ?? ''}
</style>
</head>
<body>
<header><a href="/">MirrorMirror</a></header>
<main>${body}</main>
</body>
</html>`;
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

// `email` is the signed-in account, or null. Paying needs an account, because the purchase, the invoice and
// the report link all follow the email.
// `field` is what the order is keyed on: 'dive' (a hub company dive) or 'report' (a company-diver report).
export function orderPage({ dive, price, testMode, email, field = 'dive' }) {
  const buy = email
    ? `<form method="post" action="/order/checkout">
<input type="hidden" name="${field}" value="${esc(dive.publicId)}">
<button class="btn" type="submit">Pay ${esc(price)}</button>
</form>
<p class="note">Signed in as <b>${esc(email)}</b>. Your invoice and report link are sent to this address. <a href="/account">Your account</a></p>`
    : `<p><b>Enter your email to pay.</b> We send you a sign-in link. There is no password. Your invoice and report link go to this address.</p>
<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(`/order?${field}=${dive.publicId}`)}">
<input type="email" name="email" placeholder="you@company.com" autocomplete="email" required>
<button class="btn" type="submit">Email me a sign-in link</button>
</form>`;
  return page(`Full report: ${dive.company}`, `${testBanner(testMode)}
<h1>Full report on ${esc(dive.company)}</h1>
<p>Everything locked in the free preview, plus the work done for you:</p>
<ul>
<li><b>Five chapters:</b> reputation, search and Maps, AI assistants, websites, licences and awards</li>
<li><b>Ready to use:</b> a rewritten homepage, review replies, pages to add, an AI plan and a 30-day plan</li>
<li>One link that works on desktop and mobile, and prints to A4</li>
</ul>
<div class="price">${esc(price)}</div>
<p>One payment, this one company. No subscription.</p>
<p><b>The report takes about ${REPORT_MINUTES} minutes (2 hours) to make.</b> We start it as soon as the payment goes through.</p>
${buy}
<p class="note">You pay on Stripe's secure page. After you pay we email you a sign-in link, so you can follow the report in your account from any device.</p>`);
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
    return page('Payment processing', `${testBanner(testMode)}
<h1>Your payment is still processing</h1>
<p>Some payment methods take a little while. This page checks again every 15 seconds.</p>`, { refresh: 15 });
  }
  if (!report?.reportUrl) {
    return page('Payment received', `${testBanner(testMode)}
<span class="ok">Paid</span>
<h1>Thank you. We are starting your report on ${esc(company)}</h1>
<p>This page refreshes in a few seconds with the link to your report.</p>`, { refresh: 5 });
  }
  return page('Payment received', `${testBanner(testMode)}
<span class="ok">Paid</span>
<h1>Your report on ${esc(company)} is on its way</h1>
<p>It takes about ${REPORT_MINUTES} minutes to make. The link works now: the page shows its progress and fills in by itself when it is done.</p>
<p><a class="btn" href="${esc(report.reportUrl)}">Open your report</a></p>
${invoice?.email ? (invoice.sent
    ? `<p class="note">Your invoice and this link were emailed to <b>${esc(invoice.email)}</b>. Find them any time in <a href="/account">your account</a>.</p>`
    : `<p class="note">We could not email your invoice to <b>${esc(invoice.email)}</b> just now. It is saved in <a href="/account">your account</a>, where you can send it again.</p>`) : ''}
${invoice?.email ? (invoice.signIn
    ? `<p class="note">We also emailed a sign-in link to <b>${esc(invoice.email)}</b>. Use it to follow the report in <a href="/account">your account</a> from any device.</p>`
    : `<p class="note">We could not email the sign-in link to <b>${esc(invoice.email)}</b> just now. You can always <a href="/login">sign in with your email</a> to see your report.</p>`) : ''}
<p class="note">Keep this link. Anyone with it can open the report.</p>`);
}

// ---- Sign in (no password: a link is emailed) ----

export function loginPage({ next, email = '', error = null } = {}) {
  return page('Sign in', `<h1>Sign in</h1>
<p>Enter your email. We send you a link that signs you in. There is no password, and no account to set up: your email is your account.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(next ?? '')}">
<input type="email" name="email" value="${esc(email)}" placeholder="you@company.com" autocomplete="email" required>
<button class="btn" type="submit">Email me a sign-in link</button>
</form>`);
}

export function checkEmailPage({ email, minutes }) {
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
