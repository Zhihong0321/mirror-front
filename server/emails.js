import { emailLegal } from './legal.js';

// The emails the site sends. Each returns { subject, text, html }. Plain text is always included.
// Add a new email by adding a function here and calling mailer.send({ to, kind, ...it }).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function money(cents, currency) {
  const n = Number(cents);
  return `${String(currency ?? '').toUpperCase()} ${(Number.isFinite(n) ? n / 100 : 0).toFixed(2)}`;
}

export function dateLabel(ms) {
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// How long the full report takes to make, from payment. Said to the buyer on every page and email about it.
export const REPORT_MINUTES = 120;

const wrap = (title, inner) => `<!doctype html>
<html><body style="margin:0;background:#f2f3f5;font-family:Arial,Helvetica,sans-serif;color:#111418;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e8eb;border-radius:12px;padding:28px;">
<tr><td style="font-size:20px;font-weight:700;letter-spacing:-0.02em;padding-bottom:14px;">MirrorMirror</td></tr>
<tr><td style="font-size:16px;line-height:1.55;color:#33383f;">
<h1 style="font-size:22px;line-height:1.2;margin:0 0 14px;color:#111418;">${esc(title)}</h1>
${inner}
</td></tr></table>
<p style="font-size:12px;color:#5c636d;margin:14px 0 0;">MirrorMirror · mirrormirror.cloud</p>
${emailLegal().html}
</td></tr></table></body></html>`;

const button = (href, label) => `<p style="margin:22px 0;"><a href="${esc(href)}" style="background:#111418;color:#ffffff;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:10px;display:inline-block;">${esc(label)}</a></p>`;

// Sign-in link. Asking for another link cancels this one.
export function magicLink({ link, minutes }) {
  const text = `Your MirrorMirror sign-in link:\n\n${link}\n\nIt works once and expires in ${minutes} minutes. If you ask for a newer link, this one stops working.\n\nIf you did not ask to sign in, you can ignore this email. Nobody can get into your account without it.`;
  const html = wrap('Sign in to MirrorMirror', `
<p>Press the button to sign in. There is no password.</p>
${button(link, 'Sign in')}
<p style="font-size:14px;color:#5c636d;">It works once and expires in ${esc(minutes)} minutes. If you ask for a newer link, this one stops working.</p>
<p style="font-size:14px;color:#5c636d;">Button not working? Paste this address into your browser:<br><span style="word-break:break-all;">${esc(link)}</span></p>
<p style="font-size:14px;color:#5c636d;">If you did not ask to sign in, ignore this email. Nobody can get into your account without it.</p>`);
  return { subject: 'Your MirrorMirror sign-in link', text, html };
}

// Receipt and invoice for a paid order. `seller` = { name, address, note }.
export function invoice({ order, seller, accountUrl, invoiceUrl }) {
  const amount = money(order.amount_cents, order.currency);
  const item = `MirrorMirror full report: ${order.company ?? ''}`;
  const lines = [
    `Invoice ${order.invoice_no}`,
    `Date: ${dateLabel(order.paid_at)}`,
    `Billed to: ${order.email}`,
    `Item: ${item}`,
    `Total paid: ${amount}`,
    'Paid by card through Stripe.',
  ];
  const sellerLines = [seller?.name, seller?.address, seller?.note].filter(Boolean);
  const text = `Thank you. Your payment was received.\n\n${lines.join('\n')}\n\n`
    + (order.report_url ? `Your report takes about ${REPORT_MINUTES} minutes to make. Its link shows the progress and fills in by itself when it is ready:\n${order.report_url}\n\n` : `Your report takes about ${REPORT_MINUTES} minutes to make. We are starting it now. It will be in your account when it is ready.\n\n`)
    + `Your orders and invoices: ${accountUrl}\nPrinted invoice: ${invoiceUrl}\n\n`
    + (sellerLines.length ? `${sellerLines.join('\n')}\n` : '');
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#5c636d;">${esc(k)}</td><td style="padding:6px 0;text-align:right;">${v}</td></tr>`;
  const html = wrap('Payment received', `
<p>Thank you. Your payment was received and your report is being made. It takes about ${REPORT_MINUTES} minutes.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6e8eb;border-bottom:1px solid #e6e8eb;margin:14px 0;font-size:15px;">
${row('Invoice', `<b>${esc(order.invoice_no)}</b>`)}
${row('Date', esc(dateLabel(order.paid_at)))}
${row('Billed to', esc(order.email))}
${row('Item', esc(item))}
${row('Total paid', `<b>${esc(amount)}</b>`)}
</table>
${order.report_url ? button(order.report_url, 'Open your report') : '<p>We are starting your report now. It will be in your account when it is ready.</p>'}
<p style="font-size:14px;color:#5c636d;">The report page shows its progress and fills in by itself when it is ready.</p>
<p style="font-size:14px;"><a href="${esc(accountUrl)}">Your orders and invoices</a> · <a href="${esc(invoiceUrl)}">Printed invoice</a><br><span style="color:#5c636d;">Sign in with this email address. We send you a link; there is no password.</span></p>
${sellerLines.length ? `<p style="font-size:13px;color:#5c636d;">${sellerLines.map(esc).join('<br>')}</p>` : ''}`);
  return { subject: `Invoice ${order.invoice_no}: your MirrorMirror report`, text, html };
}

// After a paid order: a sign-in link, so the buyer can follow the report from any device. `link` is a fresh magic link.
export function paymentSignIn({ link, minutes, company, invoiceNo, loginUrl }) {
  const item = company ? `the full report on ${company}` : 'your full report';
  const text = `Thank you. Your payment for ${item} was received${invoiceNo ? ` (invoice ${invoiceNo})` : ''}.\n\n`
    + `The report takes about ${REPORT_MINUTES} minutes to make. Sign in to see its progress in your account and open it when it is ready:\n\n${link}\n\n`
    + `The link works once and expires in ${minutes} minutes. If it has expired, ask for a new one at ${loginUrl}. A new link cancels this one.`;
  const html = wrap('Your payment is received', `
<p>Thank you. Your payment for <b>${esc(item)}</b> was received${invoiceNo ? ` (invoice <b>${esc(invoiceNo)}</b>)` : ''}.</p>
<p>The report takes about ${REPORT_MINUTES} minutes to make. Sign in to see its progress in your account and open it when it is ready.</p>
${button(link, 'Sign in to your account')}
<p style="font-size:14px;color:#5c636d;">The link works once and expires in ${esc(minutes)} minutes. If it has expired, <a href="${esc(loginUrl)}">ask for a new one</a>. A new link cancels this one.</p>
<p style="font-size:14px;color:#5c636d;">Button not working? Paste this address into your browser:<br><span style="word-break:break-all;">${esc(link)}</span></p>`);
  return { subject: `Sign in to follow your MirrorMirror report${company ? ` on ${company}` : ''}`, text, html };
}

const WHO = { mine: 'their own company', rival: 'a competitor', supplier: 'a supplier or vendor' };
export const whoLabel = (who) => WHO[who] ?? WHO.mine;

// To the buyer, right after they ask for a free preview.
export function previewRequested({ request, accountUrl }) {
  const text = `We have your request for a free preview of ${request.company}.\n\nWe are preparing it now. When it is ready we email you the link, and it also appears in your dashboard:\n${accountUrl}\n\nThe preview is free. It shows what public sources say about the company, with a few warning signs in full and the five key numbers locked. The company you asked about is never told.`;
  const html = wrap('We are preparing your free preview', `
<p>We have your request for a free preview of <b>${esc(request.company)}</b>.</p>
<p>When it is ready we email you the link. It also appears in your dashboard.</p>
${button(accountUrl, 'Open your dashboard')}
<p style="font-size:14px;color:#5c636d;">The preview is free. It shows what public sources say about the company, with a few warning signs in full and the five key numbers locked. The company you asked about is never told.</p>`);
  return { subject: `We are preparing your free preview of ${request.company}`, text, html };
}

// To the team, so nobody has to look at a database to find a new request.
export function previewAlert({ request, adminUrl }) {
  const lines = [
    `Company: ${request.company}`, `For: ${whoLabel(request.who)}`, `Country: ${request.country || '(not given)'}`,
    `Website: ${request.website || '(not given)'}`, `Asked by: ${request.email}`, `Request #${request.id}`,
  ];
  const text = `New free preview request.\n\n${lines.join('\n')}\n\nWhen the preview exists, mark it ready (this emails the buyer their link):\nPOST ${adminUrl}\nAuthorization: Bearer <PREVIEW_ADMIN_TOKEN>\n{"report_id":"<v21_report.report_id>"}`;
  const html = wrap('New free preview request', `<p>${lines.map(esc).join('<br>')}</p>
<p style="font-size:14px;color:#5c636d;">When the preview exists, mark it ready (this emails the buyer their link):<br><code>POST ${esc(adminUrl)}</code><br><code>{"report_id":"&lt;v21_report.report_id&gt;"}</code></p>`);
  return { subject: `New free preview request: ${request.company}`, text, html };
}

// To the buyer, when their preview exists.
export function previewReady({ request, previewUrl, accountUrl }) {
  const text = `Your free preview of ${request.company} is ready:\n\n${previewUrl}\n\nIt shows what public sources say about the company. The full report opens everything the preview keeps back.\n\nYour dashboard: ${accountUrl}`;
  const html = wrap('Your free preview is ready', `
<p>Your free preview of <b>${esc(request.company)}</b> is ready.</p>
${button(previewUrl, 'Open your preview')}
<p style="font-size:14px;color:#5c636d;">It shows what public sources say about the company. The full report opens everything the preview keeps back.</p>
<p style="font-size:14px;"><a href="${esc(accountUrl)}">Your dashboard</a></p>`);
  return { subject: `Your free preview of ${request.company} is ready`, text, html };
}
