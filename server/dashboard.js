// The signed-in account pages (inside the frame in account-ui.js): Overview (/account), Free previews
// (/account/previews), Full reports (/account/reports), and the team's list of every preview request.
// Pure rendering. app.js gathers the data.

import { page, esc } from './pages.js';
import { accountPage } from './account-ui.js';
import { DASHBOARD_CSS as CSS } from './dashboard-css.js';
import { whoLabel } from './emails.js';
import { RESEARCHED_COUNTRIES, isResearched } from './countries.js';
import { readSummary } from './referrals-page.js';

export { DASHBOARD_CSS } from './dashboard-css.js';

const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmtMoney = (cents, currency) => `${String(currency).toUpperCase()} ${(cents / 100).toFixed(2)}`;
const usd = (cents) => `USD ${(Number(cents) / 100).toFixed(Number(cents) % 100 ? 2 : 0)}`;

// notice key -> [tone, text]
const NOTICES = {
  requested: ['ok', (email) => `Request received. We are preparing your preview and will email ${email} the link. It also appears below.`],
  duplicate: ['info', () => 'You already asked for a preview of that company. It is still being prepared.'],
  limit: ['bad', () => 'You have 10 previews being prepared. Please wait for some to finish before asking for more.'],
  company: ['bad', () => 'Enter the company name.'],
  bad_link: ['bad', () => 'That does not look like a preview link. It should contain /p/ or /dp/.'],
  sent: ['ok', () => 'Invoice sent. Check your email.'],
  failed: ['bad', () => 'We could not send the email just now. Please try again in a minute.'],
};
const noticeOf = (key, email) => { const n = key ? NOTICES[key] : null; return n ? { tone: n[0], text: n[1](email) } : null; };

// The two questions every free-preview request asks, in the same shape the landing page's forms use (site/index.html):
// which company it is for, and which country it is in. Shared by the overview's quick form and the previews page.
// `id` prefixes the input ids, so the same fields can be drawn on a page twice without clashing.
const whoField = (picked = 'mine') => {
  const radios = [['mine', 'My company'], ['rival', 'A competitor'], ['supplier', 'A supplier']]
    .map(([v, label]) => `<label><input type="radio" name="who" value="${v}"${picked === v ? ' checked' : ''}> ${label}</label>`).join('');
  return `<fieldset class="who"><legend>Which company should the mirror read?</legend>${radios}</fieldset>`;
};

// A chip per country that has its own research (countries.js), plus a box for any other country: the landing page asks
// exactly this, and reads the same list from GET /api/countries.
function countryField(country, id = '') {
  const wanted = String(country ?? 'Malaysia').trim();
  const other = wanted && !isResearched(wanted) ? wanted : '';
  const picked = RESEARCHED_COUNTRIES.find((c) => c.name.toLowerCase() === wanted.toLowerCase())?.name ?? (other ? null : RESEARCHED_COUNTRIES[0].name);
  const chips = RESEARCHED_COUNTRIES.map((c) => `<label><input type="radio" name="country" value="${esc(c.name)}"${picked === c.name ? ' checked' : ''}> ${esc(c.name)}</label>`).join('');
  return `<fieldset class="who countries"><legend>Which country is the company in?</legend>${chips}</fieldset>
<label class="f" for="${id}country_other">Another country <small>(we research it with our general checklist; the country's own registers are not included yet)</small></label>
<input id="${id}country_other" name="country_other" type="text" maxlength="80" value="${esc(other)}" placeholder="Type a country only if it is not listed above">`;
}

// The step-by-step list under a preview that is not ready yet. prog comes from preview-progress.js.
function progressList(prog) {
  const mark = { done: '✓', now: '●', bad: '!', todo: '○' };
  return `<ol class="prog">${prog.steps.map((s) => `<li class="${esc(s.state)}"><i>${mark[s.state] ?? '○'}</i><span>${esc(s.label)}${s.note ? ` <small>${esc(s.note)}</small>` : ''}</span></li>`).join('')}</ol>`;
}

// The "did they read it?" line under a ready preview: verdict badge, the numbers, and a way to the full tracker.
// read: readership() of the views of this preview (referrals.js), null when it could not be read.
function readLine(read, now) {
  if (!read) return '<div class="readline"><b>Visitor activity:</b> could not be read just now. <a href="/account/referrals#previews">Open the tracker</a></div>';
  const s = readSummary(read, now, { short: true });
  return `<div class="readline"><span class="badge ${esc(s.tone)}">${esc(s.label)}</span> <span>${esc(s.line)}</span> <a href="/account/referrals#previews">${read.views ? 'Every view' : 'Tracker'}</a></div>`;
}

function previewRow(p, prog, read, now) {
  const meta = `${esc(whoLabel(p.who))}${p.country ? ` · ${esc(p.country)}` : ''} · asked ${esc(fmtDate(p.created_at))}`;
  const ready = p.status === 'ready' && p.report_id;
  const badge = prog?.badge ?? { label: 'We are preparing it', tone: 'wait' };
  return `<div class="row">
<div class="what"><b>${esc(p.company)}</b><span>${meta}</span>${!ready && prog?.line ? `<span class="hint">${esc(prog.line)}</span>` : ''}</div>
<div class="acts">${ready
    ? `<span class="badge ok">Ready</span><a class="btn sm" href="/p/${esc(p.report_id)}">Open preview</a><a href="/account/referrals?link=${encodeURIComponent(p.report_id)}">Get referral link</a>`
    : `<span class="badge ${esc(badge.tone)}">${esc(badge.label)}</span>`}</div>
${ready && read !== undefined ? readLine(read, now) : ''}
${!ready && prog ? progressList(prog) : ''}
</div>`;
}

function reportRow(o, st) {
  const href = o.report_id ? `/r/${o.report_id}` : (o.report_url || '');
  return `<div class="row">
<div class="what"><b>${esc(o.company)}</b><span>${esc(o.invoice_no)} · ${esc(fmtMoney(o.amount_cents, o.currency))} · paid ${esc(fmtDate(o.paid_at))}</span>${st?.line ? `<span class="hint">${esc(st.line)}</span>` : ''}</div>
<div class="acts"><span class="badge ${esc(st?.tone ?? 'bad')}">${esc(st?.label ?? 'Status unavailable')}</span>
${href ? `<a class="btn sm" href="${esc(href)}">Open report</a>` : ''}
<a href="/account/invoices/${o.id}">Invoice</a>
<form method="post" action="/account/invoices/${o.id}/resend"><button class="link" type="submit">Email it to me</button></form></div>
${st?.steps && st.tone !== 'ok' ? progressList(st) : ''}
</div>`;
}

const PAGE_CSS = `
.readline { flex-basis:100%; margin:2px 0 0; padding:10px 0 0; border-top:1px dashed var(--line); font-size:14px; color:var(--grey); display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.readline b { color:var(--ink); }
.readline a { color:var(--ink); font-weight:600; margin-left:auto; }
.next { display:flex; justify-content:space-between; align-items:center; gap:20px; flex-wrap:wrap; background:var(--ink); color:#fff; border-radius:16px; padding:24px 28px; }
.next h2 { font-family:var(--display); font-weight:600; letter-spacing:-0.02em; font-size:24px; line-height:1.2; margin:0 0 4px; color:#fff; }
.next p { margin:0; color:#c9ced4; max-width:56ch; }
.next .btn { background:#fff; color:var(--ink); }
.next .btn:hover { background:#e9ebee; }
.next .btn.ghost { background:transparent; color:#fff; border:1px solid #5a616b; margin-left:8px; }
.stats { display:grid; grid-template-columns:repeat(3,1fr); margin:22px 0 0; border:1px solid var(--line); border-radius:14px; overflow:hidden; }
.stats a.st { display:block; padding:18px 20px; color:inherit; text-decoration:none; border-left:1px solid var(--line); }
.stats a.st:first-child { border-left:0; }
.stats a.st:hover { background:var(--band); }
.stats a.st:focus-visible { outline:2px solid var(--ink); outline-offset:-2px; }
.stats b { display:block; font-family:var(--display); font-size:28px; letter-spacing:-0.02em; line-height:1.15; color:var(--ink); }
.stats span { font-size:14px; color:var(--grey); }
.recent { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-top:34px; }
.recent h2 { font-family:var(--display); font-weight:600; letter-spacing:-0.02em; font-size:20px; margin:0 0 10px; display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
.recent h2 a { font:500 14px var(--body); color:var(--grey); }
.recent .row { padding:13px 14px; }
.recent .row .what b { font-size:16px; }
section.req { border:1px solid var(--line); border-radius:14px; padding:24px 22px; margin:0 0 22px; }
section.req h2 { font-family:var(--display); font-weight:600; letter-spacing:-0.02em; font-size:21px; margin:0 0 6px; }
section.req > p.lead { margin:0 0 18px; font-size:15px; color:var(--grey); max-width:62ch; }
section.req form { margin:0; }
details.ask { border:1px solid var(--line); border-radius:14px; padding:0 22px; }
details.ask > summary { cursor:pointer; list-style:none; padding:16px 0; font-family:var(--display); font-weight:600; font-size:19px; letter-spacing:-0.02em; display:flex; justify-content:space-between; align-items:center; }
details.ask > summary::-webkit-details-marker { display:none; }
details.ask > summary::after { content:"+"; font:400 24px var(--body); color:var(--grey); }
details.ask[open] > summary::after { content:"–"; }
details.ask[open] { padding-bottom:22px; }
details.ask { margin-bottom:34px; }
details.ask > p.lead { margin-top:0; }
.running-jobs { display:flex; flex-direction:column; gap:18px; margin:0 0 24px; }
.running-card { background:#fff; border:2px solid var(--ink); border-radius:16px; padding:22px 24px; box-shadow:0 4px 16px rgba(17,20,24,0.06); }
.running-top { display:flex; justify-content:space-between; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:12px; }
.running-meta { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.running-type { font-size:13px; font-weight:600; color:var(--grey); text-transform:uppercase; letter-spacing:0.04em; }
.running-hint { font-size:14px; color:var(--grey); }
.running-body { margin-bottom:4px; }
.running-company { font-family:var(--display); font-weight:600; letter-spacing:-0.02em; font-size:24px; line-height:1.2; margin:0 0 10px; color:var(--ink); }
.running-stage-box { display:inline-flex; align-items:center; gap:8px; background:#fdf3e2; border:1px solid #f6ddb6; border-radius:99px; padding:6px 14px; margin-bottom:4px; flex-wrap:wrap; font-size:14px; }
.stage-kicker { font-weight:600; color:#a15c07; text-transform:uppercase; font-size:11px; letter-spacing:0.05em; }
.stage-text { color:var(--ink); }
.stage-text strong { color:#7a4403; }
.stage-note { color:#8c4f05; }
.running-card ol.prog { margin-top:14px; padding-top:14px; }
@keyframes livePulse { 0% { transform:scale(0.85); opacity:0.7; } 50% { transform:scale(1.25); opacity:1; } 100% { transform:scale(0.85); opacity:0.7; } }
.live-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#d9822b; margin-right:6px; vertical-align:middle; animation:livePulse 1.8s infinite ease-in-out; }
@media (max-width:760px) { .stats { grid-template-columns:1fr; } .stats a.st { border-left:0; border-top:1px solid var(--line); } .stats a.st:first-child { border-top:0; } .recent { grid-template-columns:1fr; } .next { padding:20px; } .running-card { padding:18px 16px; } .running-company { font-size:20px; } .running-top { flex-direction:column; align-items:flex-start; } .running-stage-box { border-radius:10px; } }
`;

// ---- Overview ----

// shell: { email, nav, isAdmin }. previews, orders: rows. earnings: { pendingCents, paidCents }. notice: a key from
// NOTICES (the quick form posts to /account/previews and comes back here when it was sent from this page).
// previewProgress: { [request id]: from preview-progress.js }. orderStatuses: { [order id]: from reportStatus() }.
export function overviewPage({ shell, previews, orders, earnings = {}, price, credits = { full_report: 0, 'ads research': 0 }, notice = null, previewProgress = {}, orderStatuses = {} }) {
  const ready = previews.filter((p) => p.status === 'ready' && p.report_id);
  const open = previews.filter((p) => !(p.status === 'ready' && p.report_id));
  const bought = new Set(orders.map((o) => String(o.report_id ?? '').toLowerCase()).filter(Boolean));
  const toBuy = ready.find((p) => !bought.has(String(p.report_id).toLowerCase()));

  // Running jobs (running full reports or running free previews)
  const running = [];

  // 1. Running full reports from orders
  for (const o of orders) {
    const st = orderStatuses[o.id];
    if (st && st.tone === 'wait') {
      const nowStep = st.steps?.find((s) => s.state === 'now');
      running.push({
        kind: 'report',
        id: o.id,
        typeLabel: 'Full report',
        company: o.company,
        href: '/account/reports',
        btnLabel: 'See report progress',
        badge: { label: st.label || 'Being written', tone: st.tone },
        stageTitle: nowStep?.note || st.label || 'Writing the report',
        stageDetail: '',
        line: st.line || '',
        steps: st.steps || [],
      });
    }
  }

  // 2. Running free previews
  for (const p of open) {
    const prog = previewProgress[p.id];
    const nowStep = prog?.steps?.find((s) => s.state === 'now' || s.state === 'bad');
    running.push({
      kind: 'preview',
      id: p.id,
      typeLabel: 'Free preview',
      company: p.company,
      href: '/account/previews',
      btnLabel: 'See preview progress',
      badge: prog?.badge ?? { label: 'Being prepared', tone: 'wait' },
      stageTitle: nowStep?.label || prog?.badge?.label || 'Being prepared',
      stageDetail: nowStep?.note || '',
      line: prog?.line || 'We are preparing your preview and will email you the link when it is ready.',
      steps: prog?.steps || [],
    });
  }

  let next = null;
  if (toBuy) next = { h: `Your preview of ${toBuy.company} is ready`, p: `Read it first. The full report bundle is ${price}: 2 full reports and 1 Social Media Ads report, one payment, one company.`, a: `<a class="btn" href="/p/${esc(toBuy.report_id)}">Open the preview</a>` };
  else if (!running.length && open.length) next = { h: `We are preparing ${open[0].company}`, p: `We email you the link when it is ready. You can follow each step on the previews page.`, a: '<a class="btn" href="/account/previews">See progress</a>' };
  else if (!running.length && orders.length) { const o = orders[0]; next = { h: `Your report on ${o.company}`, p: `Bought ${fmtDate(o.paid_at)}. Find every report and invoice on the reports page.`, a: `<a class="btn" href="${esc(o.report_id ? `/r/${o.report_id}` : (o.report_url || '/account/reports'))}">Open the report</a>` }; }
  else if (!running.length) next = { h: 'Start with a free preview', p: 'Tell us a company, and which country it is in. We email you what the public internet says about it.', a: '<a class="btn" href="#request">Get a free preview</a>' };

  const runningCards = running.map((job) => `
<div class="running-card">
<div class="running-top">
<div class="running-meta">
<span class="badge ${esc(job.badge.tone)}"><span class="live-dot" aria-hidden="true"></span>${esc(job.badge.label)}</span>
<span class="running-type">Running ${esc(job.typeLabel)}</span>
${job.line ? `<span class="running-hint">${esc(job.line)}</span>` : ''}
</div>
<a class="btn sm" href="${esc(job.href)}">${esc(job.btnLabel)}</a>
</div>
<div class="running-body">
<h3 class="running-company">${esc(job.company)}</h3>
<div class="running-stage-box">
<span class="stage-kicker">What is running now</span>
<span class="stage-text"><strong>${esc(job.stageTitle)}</strong>${job.stageDetail ? `<span class="stage-note"> · ${esc(job.stageDetail)}</span>` : ''}</span>
</div>
</div>
${job.steps?.length ? `<div class="running-prog">${progressList({ steps: job.steps })}</div>` : ''}
</div>`).join('');

  const prevRows = previews.slice(0, 3).map((p) => {
    const rdy = p.status === 'ready' && p.report_id;
    const prog = previewProgress[p.id];
    return `<div class="row"><div class="what"><b>${esc(p.company)}</b><span>asked ${esc(fmtDate(p.created_at))}</span>${!rdy && prog?.line ? `<span class="hint">${esc(prog.line)}</span>` : ''}</div>
<div class="acts"><span class="badge ${rdy ? 'ok' : (prog?.badge?.tone ?? 'wait')}">${rdy ? 'Ready' : (prog?.badge?.label ?? 'Being prepared')}</span>${rdy ? `<a href="/p/${esc(p.report_id)}">Open</a>` : '<a href="/account/previews">Progress</a>'}</div></div>`;
  }).join('');
  const repRows = orders.slice(0, 3).map((o) => {
    const st = orderStatuses[o.id];
    return `<div class="row"><div class="what"><b>${esc(o.company)}</b><span>${esc(o.invoice_no)} · paid ${esc(fmtDate(o.paid_at))}</span>${st?.line ? `<span class="hint">${esc(st.line)}</span>` : ''}</div>
<div class="acts">${st ? `<span class="badge ${esc(st.tone)}">${esc(st.label)}</span>` : ''}<a href="${esc(o.report_id ? `/r/${o.report_id}` : (o.report_url || '/account/reports'))}">Open</a></div></div>`;
  }).join('');

  const body = `
${running.length ? `<section class="running-jobs" aria-label="Running jobs">${runningCards}</section>` : ''}
${next ? `<div class="next"><div><h2>${esc(next.h)}</h2><p>${esc(next.p)}</p></div><div>${next.a}</div></div>` : ''}

<section class="req" id="request">
<h2>Ask for a free preview</h2>
<p class="lead">A company name and the country it is in: that is all we need. We research it from public sources and email you the link. Your own company, a competitor or a supplier.</p>
<form method="post" action="/account/previews">
<input type="hidden" name="back" value="overview">
${whoField()}
<div class="ask-grid">
<div class="full"><label class="f" for="ask-company">Company name</label>
<input id="ask-company" name="company" type="text" maxlength="200" required autocomplete="organization" placeholder="Company name"></div>
<div class="full">${countryField(undefined, 'ask-')}</div>
</div>
<button class="btn" type="submit">Get the free preview</button>
</form>
</section>

<div class="stats">
<a class="st" href="/account/previews"><b>${ready.length}<small style="font-size:15px;font-weight:500;color:var(--grey)"> ready</small></b><span>Free previews${open.length ? `, ${open.length} being prepared` : ''}</span></a>
<a class="st" href="/account/reports"><b>${orders.length}</b><span>Full reports bought</span></a>
<a class="st" href="/account/referrals/earnings"><b>${esc(usd(earnings.pendingCents ?? 0))}</b><span>Referral commission to be paid</span></a>
</div>

<section><h2>Report credits</h2><div class="list"><div class="row"><div class="what"><b>${esc(`${credits.full_report ?? 0} full ${credits.full_report === 1 ? 'report' : 'reports'}`)} · ${esc(`${credits['ads research'] ?? 0} Social Media Ads Research`)}</b><span>Prepaid with your order. What is left to use.</span></div></div></div></section>

<div class="recent">
<section><h2>Free previews <a href="/account/previews">All previews</a></h2>${prevRows ? `<div class="list">${prevRows}</div>` : '<div class="empty"><b>None yet.</b> <a href="/account/previews">Ask for one</a>. It is free.</div>'}</section>
<section><h2>Full reports <a href="/account/reports">All reports</a></h2>${repRows ? `<div class="list">${repRows}</div>` : '<div class="empty"><b>Nothing bought yet.</b> Read a free preview first.</div>'}</section>
</div>`;
  return accountPage({
    title: 'Overview', lede: 'Your free previews, your reports and what you earn by referring.', active: 'overview', ...shell,
    notice: noticeOf(notice, shell.email), body, css: PAGE_CSS,
    refresh: running.length ? 20 : undefined,
  });
}

// ---- Free previews ----

// previews: preview_requests rows. progress: { [request id]: from preview-progress.js }. prefill: { company, who, country, website }.
// reads: { [preview request id]: readership() | null } for ready previews (omit to leave the read line out). now: ms.
export function previewsPage({ shell, previews, progress = {}, reads = {}, now = Date.now(), notice = null, prefill = {} }) {
  const who = ['mine', 'rival', 'supplier'].includes(prefill.who) ? prefill.who : 'mine';
  const hasPreview = previews.length > 0;
  const formOpen = !hasPreview || prefill.company || (notice && !['requested', 'duplicate'].includes(notice));

  const body = `
<details class="ask" id="request"${formOpen ? ' open' : ''}>
<summary>Ask for a new preview</summary>
<p class="lead">We research 25 countries with their own prompts; Malaysia, Singapore, Australia and South Korea also have industry-specific research. Any other country gets our general research. Public sources only, and the company you ask about is never told.</p>
<form method="post" action="/account/previews">
${whoField(who)}
<div class="ask-grid">
<div class="full"><label class="f" for="company">Company name</label>
<input id="company" name="company" type="text" maxlength="200" required autocomplete="organization" value="${esc(prefill.company)}" placeholder="Company name"></div>
<div class="full">${countryField(prefill.country)}</div>
<div class="full"><label class="f" for="website">Website <small>(optional, helps us find the right company)</small></label>
<input id="website" name="website" type="text" maxlength="200" value="${esc(prefill.website)}" placeholder="company.com"></div>
</div>
<button class="btn" type="submit">Get the free preview</button>
</form>
</details>

<section class="blk" id="previews">
<h2>Your previews</h2>
${hasPreview
    ? `<div class="list">${previews.map((p) => previewRow(p, progress[p.id], reads[p.id], now)).join('')}</div>`
    : '<div class="empty"><b>No previews yet.</b> Ask for one above. It takes one company name, and it is free.</div>'}
</section>

<details class="have"><summary>Already have a preview link?</summary>
<form method="get" action="/account/open">
<input type="text" name="link" placeholder="Paste the link you were sent" required>
<button class="btn quiet sm" type="submit">Open it</button>
</form></details>`;
  return accountPage({
    title: 'Free previews', lede: 'What the internet says about a company: real numbers, a few warning signs in full, the five that matter locked.',
    active: 'previews', ...shell, notice: noticeOf(notice, shell.email), body, css: PAGE_CSS,
  });
}

// ---- Full reports ----

// orders: orders rows. statuses: { [order id]: { label, tone, hint } }.
export function reportsPage({ shell, orders, statuses = {}, notice = null, price }) {
  const body = orders.length
    ? `<div class="list">${orders.map((o) => reportRow(o, statuses[o.id])).join('')}</div>`
    : `<div class="empty"><b>Nothing bought yet.</b> Read a <a href="/account/previews">free preview</a> first. If it shows what you need, the report bundle is ${esc(price)} (2 full reports + 1 Social Media Ads report), one payment, and it appears here with its invoice.</div>`;
  return accountPage({
    title: 'Full reports', lede: `Each report you bought, its state, and its invoice. The bundle is ${esc(price)}: 2 full reports and 1 Social Media Ads report, one payment, one company.`,
    active: 'reports', ...shell, notice: noticeOf(notice, shell.email), body, css: PAGE_CSS,
  });
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
<div><h1>Team: preview requests</h1><p>Signed in as <b>${esc(email)}</b> · <a href="/account">Back to your account</a> · <a href="/myoffice/reports/previews">All free previews</a> · <a href="/myoffice/reports/full">All full reports</a> · <a href="/myoffice/users">Users</a> · <a href="/myoffice/visitors">Visitors</a> · <a href="/myoffice/referrals">Referral payouts</a></p></div>
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
