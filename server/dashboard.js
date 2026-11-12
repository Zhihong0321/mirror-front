// The signed-in dashboard (/account): how it works, ask for a free preview, your previews, your full reports.
// Pure rendering. app.js gathers the data.

import { page, esc } from './pages.js';
import { whoLabel } from './emails.js';

const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmtMoney = (cents, currency) => `${String(currency).toUpperCase()} ${(cents / 100).toFixed(2)}`;

const CSS = `
.top { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:6px; }
.top h1 { margin-bottom:4px; }
.top p { margin:0; }
.notice { padding:12px 16px; border-radius:10px; margin:18px 0 0; font-size:16px; background:var(--good-bg); color:var(--good); font-weight:600; }
.notice.bad { background:#fdecea; color:var(--wrong); }
.notice.info { background:var(--band); color:var(--ink); font-weight:500; }
ol.steps { list-style:none; margin:26px 0 8px; padding:0; display:grid; grid-template-columns:repeat(3,1fr); gap:12px; counter-reset:s; }
ol.steps li { border:1px solid var(--line); border-radius:12px; padding:16px; position:relative; display:flex; flex-direction:column; gap:4px; background:#fff; }
ol.steps li b { color:var(--ink); font-size:16px; }
ol.steps li span.d { font-size:14px; color:var(--grey); line-height:1.45; }
ol.steps .n { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font:600 13px var(--body); background:var(--band); color:var(--grey); margin-bottom:6px; }
ol.steps li.now { border-color:var(--ink); box-shadow:0 0 0 1px var(--ink) inset; }
ol.steps li.now .n { background:var(--ink); color:#fff; }
ol.steps li.done .n { background:var(--good-bg); color:var(--good); }
section.blk { margin-top:34px; }
section.blk h2 { font-family:var(--display); font-weight:600; letter-spacing:-0.02em; font-size:24px; margin:0 0 6px; }
section.blk > p.lead { margin-bottom:16px; }
.ask-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; }
.ask-grid .full { grid-column:1 / -1; }
label.f { display:block; font-size:14px; font-weight:600; color:var(--ink); margin:0 0 6px; }
label.f small { font-weight:400; color:var(--grey); }
fieldset.who { border:0; padding:0; margin:0 0 14px; display:flex; flex-wrap:wrap; gap:8px; }
fieldset.who legend { font-size:14px; font-weight:600; padding:0; margin-bottom:8px; }
fieldset.who label { display:inline-flex; align-items:center; gap:8px; border:1px solid var(--line); border-radius:99px; padding:8px 14px; font-size:15px; cursor:pointer; color:var(--ink); }
fieldset.who input { margin:0; accent-color:var(--ink); }
fieldset.who label:has(input:checked) { border-color:var(--ink); background:var(--band); }
details.have { margin-top:16px; border-top:1px solid var(--line); padding-top:14px; }
details.have summary { cursor:pointer; font-size:15px; font-weight:600; color:var(--ink); }
details.have form { margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; }
details.have input { flex:1 1 280px; margin:0; }
.list { border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:16px 18px; border-top:1px solid var(--line); flex-wrap:wrap; }
.row:first-child { border-top:0; }
.row .what b { display:block; color:var(--ink); font-size:17px; }
.row .what span { font-size:14px; color:var(--grey); }
.row .what .hint { display:block; margin-top:3px; }
.row .acts { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.row .acts form { display:inline; }
.row .acts a:not(.btn) { color:var(--ink); font-weight:600; font-size:15px; }
.btn.sm { font-size:15px; padding:10px 16px; }
.badge { display:inline-block; font-size:13px; font-weight:600; padding:4px 10px; border-radius:99px; background:var(--band); color:var(--grey); white-space:nowrap; }
.badge.ok { background:var(--good-bg); color:var(--good); }
.badge.wait { background:#fdf3e2; color:#a15c07; }
.badge.bad { background:#fdecea; color:var(--wrong); }
.empty { border:1px dashed #cfd3d8; border-radius:12px; padding:22px; color:var(--grey); }
.empty b { color:var(--ink); }
@media (max-width:720px) { ol.steps { grid-template-columns:1fr; gap:8px; } ol.steps li { flex-direction:row; align-items:center; gap:12px; padding:12px 14px; } ol.steps li span.d { display:none; } ol.steps .n { margin:0; flex:none; } .ask-grid { grid-template-columns:1fr; } .top { flex-direction:column; } }
`;

const NOTICES = {
  requested: ['ok', (email) => `Request received. We are preparing your preview and will email ${email} the link. It also appears below.`],
  duplicate: ['info', () => 'You already asked for a preview of that company. It is still being prepared.'],
  limit: ['bad', () => 'You have 10 previews being prepared. Please wait for some to finish before asking for more.'],
  company: ['bad', () => 'Enter the company name.'],
  bad_link: ['bad', () => 'That does not look like a preview link. It should contain /p/ or /dp/.'],
  sent: ['ok', () => 'Invoice sent. Check your email.'],
  failed: ['bad', () => 'We could not send the email just now. Please try again in a minute.'],
};

function previewRow(p) {
  const meta = `${esc(whoLabel(p.who))}${p.country ? ` · ${esc(p.country)}` : ''} · asked ${esc(fmtDate(p.created_at))}`;
  const ready = p.status === 'ready' && p.report_id;
  return `<div class="row">
<div class="what"><b>${esc(p.company)}</b><span>${meta}</span></div>
<div class="acts">${ready
    ? `<span class="badge ok">Ready</span><a class="btn sm" href="/p/${esc(p.report_id)}">Open preview</a>`
    : '<span class="badge wait">We are preparing it</span>'}</div>
</div>`;
}

function reportRow(o, st) {
  const href = o.report_id ? `/r/${o.report_id}` : (o.report_url || '');
  return `<div class="row">
<div class="what"><b>${esc(o.company)}</b><span>${esc(o.invoice_no)} · ${esc(fmtMoney(o.amount_cents, o.currency))} · paid ${esc(fmtDate(o.paid_at))}</span>${st?.hint ? `<span class="hint">${esc(st.hint)}</span>` : ''}</div>
<div class="acts"><span class="badge ${esc(st?.tone ?? '')}">${esc(st?.label ?? 'Open it to check')}</span>
${href ? `<a class="btn sm" href="${esc(href)}">Open report</a>` : ''}
<a href="/account/invoices/${o.id}">Invoice</a>
<form method="post" action="/account/invoices/${o.id}/resend"><button class="link" type="submit">Email it to me</button></form></div>
</div>`;
}

// previews: preview_requests rows. orders: orders rows. statuses: { [order id]: { label, tone } }.
// prefill: { company, who, country, website } from the landing page form.
export function dashboardPage({ email, previews, orders, statuses = {}, notice = null, prefill = {}, price, isAdmin = false }) {
  const hasPreview = previews.length > 0;
  const hasOrder = orders.length > 0;
  const step = (n, title, text, state) => `<li class="${state}"><span class="n">${state === 'done' ? '✓' : n}</span><b>${title}</b><span class="d">${text}</span></li>`;
  const steps = `<ol class="steps">
${step(1, 'Get a free preview', 'Tell us the company. We email you what the internet says about it.', hasPreview || hasOrder ? 'done' : 'now')}
${step(2, 'Read what we found', 'Open the preview. Every number in it is real. The five that matter are locked.', hasOrder ? 'done' : hasPreview ? 'now' : '')}
${step(3, 'Unlock the full report', `${esc(price)}, one payment, one company. The report opens here, in your dashboard.`, hasOrder ? 'done' : '')}
</ol>`;

  const who = ['mine', 'rival', 'supplier'].includes(prefill.who) ? prefill.who : 'mine';
  const radio = (v, label) => `<label><input type="radio" name="who" value="${v}"${who === v ? ' checked' : ''}> ${label}</label>`;
  const n = notice ? NOTICES[notice] : null;

  const body = `
<div class="top">
<div><h1>Dashboard</h1><p>Signed in as <b>${esc(email)}</b></p></div>
<div class="acts">${isAdmin ? '<a class="btn quiet sm" href="/myoffice/previews">Office: preview requests</a> <a class="btn quiet sm" href="/myoffice/users">Users</a> <a class="btn quiet sm" href="/myoffice/visitors">Visitors</a>' : ''}
<form method="post" action="/logout"><button class="btn quiet sm" type="submit">Sign out</button></form></div>
</div>
${n ? `<p class="notice ${n[0] === 'ok' ? '' : n[0]}">${esc(n[1](email))}</p>` : ''}
${steps}

<section class="blk" id="request">
<h2>Get a free preview</h2>
<p class="lead">Your own company, a competitor or a supplier. Any company, in any country. Public sources only, and the company you ask about is never told.</p>
<form method="post" action="/account/previews">
<fieldset class="who"><legend>Which company should the mirror read?</legend>
${radio('mine', 'My company')}${radio('rival', 'A competitor')}${radio('supplier', 'A supplier')}
</fieldset>
<div class="ask-grid">
<div class="full"><label class="f" for="company">Company name</label>
<input id="company" name="company" type="text" maxlength="200" required autocomplete="organization" value="${esc(prefill.company)}" placeholder="Company name"></div>
<div><label class="f" for="country">Country</label>
<input id="country" name="country" type="text" maxlength="80" value="${esc(prefill.country ?? 'Malaysia')}" placeholder="Malaysia"></div>
<div><label class="f" for="website">Website <small>(optional, helps us find the right company)</small></label>
<input id="website" name="website" type="text" maxlength="200" value="${esc(prefill.website)}" placeholder="company.com"></div>
</div>
<button class="btn" type="submit">Get the free preview</button>
</form>
<details class="have"><summary>Already have a preview link?</summary>
<form method="get" action="/account/open">
<input type="text" name="link" placeholder="Paste the link you were sent" required>
<button class="btn quiet sm" type="submit">Open it</button>
</form></details>
</section>

<section class="blk" id="previews">
<h2>Your free previews</h2>
${hasPreview
    ? `<div class="list">${previews.map(previewRow).join('')}</div>`
    : '<div class="empty"><b>No previews yet.</b> Ask for one above. It takes one company name, and it is free.</div>'}
</section>

<section class="blk" id="reports">
<h2>Your full reports</h2>
${hasOrder
    ? `<div class="list">${orders.map((o) => reportRow(o, statuses[o.id])).join('')}</div>`
    : '<div class="empty"><b>Nothing bought yet.</b> Read a free preview first. If it shows what you need, the full report is one payment and appears here, with its invoice.</div>'}
</section>`;
  return page('Dashboard', body, { wide: true, css: CSS });
}

// ---- Team page: every preview request, and the recent email log ----

const ADMIN_NOTICES = {
  ready: ['ok', 'Marked ready. The buyer was emailed their preview link.'],
  ready_not_emailed: ['bad', 'Marked ready, but the email to the buyer could not be sent. Press "Email again" on that row.'],
  bad_report: ['bad', 'That is not a report id. Paste the report uuid, or the preview link (it contains /p/ and the id).'],
  missing: ['bad', 'That request no longer exists.'],
};

const fmtTime = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

function adminRow(p) {
  const meta = [whoLabel(p.who), p.country, p.website].filter(Boolean).map(esc).join(' · ');
  const head = `<div class="what"><b>${esc(p.company)}</b><span>${meta}<br>asked by ${esc(p.email)} · ${esc(fmtTime(p.created_at))} · request #${p.id}</span></div>`;
  const form = (value, button) => `<form class="mark" method="post" action="/myoffice/previews/${p.id}/ready">
<input type="text" name="report" value="${esc(value)}" placeholder="Report id or preview link" required>
<button class="btn sm" type="submit">${button}</button></form>`;
  if (p.status !== 'ready') return `<div class="row">${head}<div class="acts">${form('', 'Mark ready and email buyer')}</div></div>`;
  return `<div class="row">${head}<div class="acts">
${p.ready_emailed_at ? `<span class="badge ok">Buyer emailed ${esc(fmtTime(p.ready_emailed_at))}</span>` : '<span class="badge wait">Buyer not emailed yet</span>'}
<a href="/p/${esc(p.report_id)}">Open preview</a>
${form(p.report_id, p.ready_emailed_at ? 'Change report' : 'Email again')}</div></div>`;
}

export function adminPreviewsPage({ email, requests, mail, notice = null }) {
  const waiting = requests.filter((p) => p.status !== 'ready');
  const done = requests.filter((p) => p.status === 'ready');
  const n = notice ? ADMIN_NOTICES[notice] : null;
  const mailRows = mail.map((m) => `<tr><td>${esc(fmtTime(m.created_at))}</td><td>${esc(m.kind)}</td><td>${esc(m.to_email)}</td>
<td><span class="badge ${m.status === 'failed' ? 'bad' : m.status === 'sent' ? 'ok' : ''}">${esc(m.status)}</span>${m.error ? `<br><span class="small">${esc(m.error)}</span>` : ''}</td></tr>`).join('');
  const css = `${CSS}
form.mark { display:flex; gap:8px; flex-wrap:wrap; }
form.mark input { margin:0; min-width:260px; flex:1 1 260px; }
table.mail { width:100%; border-collapse:collapse; font-size:14px; }
table.mail td { padding:9px 10px 9px 0; border-top:1px solid var(--line); vertical-align:top; color:var(--grey); }
.row .what { max-width:520px; }`;
  const body = `
<div class="top">
<div><h1>Team: preview requests</h1><p>Signed in as <b>${esc(email)}</b> · <a href="/account">Back to the dashboard</a> · <a href="/myoffice/reports/previews">All free previews</a> · <a href="/myoffice/reports/full">All full reports</a> · <a href="/myoffice/users">Users</a> · <a href="/myoffice/visitors">Visitors</a></p></div>
</div>
${n ? `<p class="notice ${n[0] === 'ok' ? '' : n[0]}">${esc(n[1])}</p>` : ''}

<section class="blk">
<h2>Waiting for a preview (${waiting.length})</h2>
<p class="lead">Make the preview in the report factory, then paste its report id (or the preview link) on that row. The buyer is emailed their link.</p>
${waiting.length ? `<div class="list">${waiting.map(adminRow).join('')}</div>` : '<div class="empty"><b>Nothing waiting.</b> New requests appear here, and are emailed to the team.</div>'}
</section>

<section class="blk">
<h2>Ready (${done.length})</h2>
${done.length ? `<div class="list">${done.map(adminRow).join('')}</div>` : '<div class="empty">No previews marked ready yet.</div>'}
</section>

<section class="blk">
<h2>Recent email</h2>
<p class="lead">Every email the site tried to send, newest first. A failed one shows why.</p>
${mail.length ? `<table class="mail"><tbody>${mailRows}</tbody></table>` : '<div class="empty">No email sent yet.</div>'}
</section>`;
  return page('Team: preview requests', body, { wide: true, css });
}
