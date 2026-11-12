// The pages around a company-diver report: the waiting, locked and progress pages, and the frame that holds a
// stored report under a label. The report itself is never drawn here: it is the factory's page, shown as stored.
// Same look as the order pages (pages.js). Contract: docs/report-display.md.

import { page, esc } from './pages.js';
import { REPORT_MINUTES } from './emails.js';
import { legalLine } from './legal.js';

const who = (company) => (company ? esc(company) : 'your company');

// The free preview is not ready (the factory has not drawn it yet, or is busy). Refreshes itself.
export function previewWaiting() {
  return page('Preview on its way', `<h1>Your preview is being prepared</h1>
<p>It is not ready yet. This page checks again every 30 seconds, or refresh in a minute.</p>`, { refresh: 30 });
}

export function reportNotFound() {
  return page('Not found', `<h1>We could not find that report</h1>
<p>Check the link you were sent. Report links look like <b>…/r/</b> followed by a long code.</p>`);
}

// Signed in, but this account has not bought this report. 403.
export function reportLocked({ company, email, previewHref }) {
  return page('Full report', `<h1>This report belongs to the buyer</h1>
<p>The full report on <b>${who(company)}</b> can only be opened by the account that ordered it. You are signed in as <b>${esc(email)}</b>, which has no order for it.</p>
<p>If you ordered it with another email address, sign out and sign in with that one.</p>
<form method="post" action="/logout"><button class="btn quiet" type="submit">Sign out</button></form>
${previewHref ? `<p class="note"><a href="${esc(previewHref)}">Open the free preview</a></p>` : ''}`);
}

// Queued or running: no page yet. Refreshes every 20 seconds.
export function reportProgress({ company, stage, label }) {
  return page('Preparing your report', `<h1>Your report is being prepared</h1>
<p>The full report on <b>${who(company)}</b> is being written. This takes about ${REPORT_MINUTES} minutes (2 hours) from payment. This page checks again every 20 seconds, so you can leave it open.</p>
${stage ? `<p class="small">Now: ${esc(stage)}</p>` : ''}
${label ? `<p class="small">${esc(label)}</p>` : ''}`, { refresh: 20 });
}

export function reportFailed({ company }) {
  return page('Report problem', `<h1>Something went wrong with your report</h1>
<p>The report on <b>${who(company)}</b> could not be finished. We are looking into it. Please contact us and quote the link of this page.</p>`);
}

export function reportNone({ company }) {
  return page('Report not started', `<h1>Your report has not started yet</h1>
<p>We have not started the full report on <b>${who(company)}</b>. This page checks again every 30 seconds.</p>`, { refresh: 30 });
}

// The report database could not be read right now. The order is fine; the page itself is only unreachable.
export function reportUnavailable({ company }) {
  return page('Report unavailable', `<h1>We cannot load your report right now</h1>
<p>Your report on <b>${who(company)}</b> is safe. We could not reach it just now. This page tries again every 30 seconds.</p>`, { refresh: 30 });
}

// A stored report that needs a label above it (incomplete, an older run, an odd status). The report stays
// untouched: it is shown whole in its own frame, so its styles and ours do not meet. `src` is the raw route, which
// answers with a `Content-Security-Policy: sandbox` header (reports.js), so the frame needs no sandbox attribute.
export function reportFrame({ company, label, src }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Report: ${esc(company || 'MirrorMirror')} · MirrorMirror</title>
<style>
html, body { height:100%; margin:0; }
body { display:flex; flex-direction:column; background:#f2f3f5; font:15px/1.45 system-ui, sans-serif; color:#111418; }
.bar { flex:none; background:#fdf3e2; color:#7a4a05; border-bottom:1px solid #f0dcb8; padding:10px 16px; }
.bar a { color:inherit; font-weight:600; margin-right:10px; text-decoration:none; }
iframe { flex:1 1 auto; width:100%; border:0; background:#fff; }
.legalbar { flex:none; background:#fff; border-top:1px solid #e6e8eb; padding:8px 16px; font-size:12px; line-height:1.5; color:#5c636d; }
.legalbar a { color:inherit; }
</style>
</head>
<body>
<div class="bar"><a href="/">MirrorMirror</a> ${esc(label)}</div>
<iframe src="${esc(src)}" title="Report" allow="clipboard-write *"></iframe>
<div class="legalbar">${legalLine()}</div>
</body>
</html>`;
}
