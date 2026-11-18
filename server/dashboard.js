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
  sent: ['ok', () => 'Receipt sent. Check your email.'],
  failed: ['bad', () => 'We could not send the email just now. Please try again in a minute.'],
  run_started: ['ok', () => 'Your full report is started. It uses 1 full-report credit. Follow it below; it usually takes about 2 hours.'],
  run_no_credit: ['bad', () => 'You have no full-report credit left (credits last 90 days from payment). Nothing was started and nothing was charged.'],
  run_already: ['info', () => 'That report already has a run in progress, so nothing new was started and no credit was used.'],
  run_paid_starting: ['info', () => 'That report was paid for and is being started by your payment. No credit was used.'],
  run_unknown: ['bad', () => 'That report is not one of yours (a ready free preview, or a report you bought). Nothing was started.'],
  run_unavailable: ['bad', () => 'We could not read the report factory just now, so nothing was started and no credit was used. Try again in a minute.'],
  ads_started: ['ok', () => 'Your Social Media Ads Research is started. It uses 1 ads credit. It appears below when it is ready (usually a few minutes).'],
  ads_no_credit: ['bad', () => 'You have no Social Media Ads Research credit left (credits last 90 days from payment). Nothing was started and nothing was charged.'],
  ads_keyword: ['bad', () => 'Enter the product or industry to research, for example "solar panel installation". Nothing was started and no credit was used.'],
  ads_failed: ['bad', () => 'The report factory did not accept the ads research. Your credit was given back. Try again in a minute; the team can see the error.'],
  run_failed: ['bad', () => 'The report factory did not accept the run. Your credit was given back. Try again in a minute; the team can see the error.'],
};
const noticeOf = (key, email) => { const n = key ? NOTICES[key] : null; return n ? { tone: n[0], text: n[1](email) } : null; };

// The two questions every free-preview request asks, in the same shape the landing page's forms use (site/index.html):
// which company it is for, and which country it is in. Shared by the overview's quick form and the previews page.
// `id` prefixes the input ids, so the same fields can be drawn on a page twice without clashing.
const whoField = (picked = 'mine') => {
  const radios = [['mine', "My company or my client's"], ['rival', 'A competitor'], ['supplier', 'A supplier']]
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

// ---- Report credits ----

const CREDIT_NAME = { full_report: 'Full report', 'ads research': 'Social Media Ads Research' };
const creditName = (kind) => CREDIT_NAME[kind] ?? String(kind);

// The balance in one line: what can be used today (expired credits are not counted).
export function creditLine(balance = {}) {
  const f = balance.full_report ?? 0;
  return `${f} ${f === 1 ? 'full report' : 'full reports'} · ${balance['ads research'] ?? 0} Social Media Ads Research`;
}

// The soonest last day among credits still usable, as { date, kind } or null.
function nextExpiry(list) {
  const live = list.filter((c) => c.state === 'available' && c.expires_at != null).sort((a, b) => a.expires_at - b.expires_at);
  return live.length ? { date: fmtDate(live[0].expires_at), kind: live[0].kind } : null;
}

// Every credit the account has ever been given, each labelled: available (with its last day), used (on what, when), or
// expired. Nothing is hidden: an expired credit is shown as expired. `names` maps a report id to its company.
function creditRows(list, names = {}) {
  if (!list.length) return '<div class="empty"><b>No credits yet.</b> A paid report bundle gives you 2 full reports and 1 Social Media Ads Research, each valid for 90 days.</div>';
  // One card per credit, four to a row (two on a tablet, one on a phone). Available ones are highlighted; used and expired
  // ones stay visible but dimmed.
  return `<div class="cgrid">${list.map((c) => {
    const tone = c.state === 'available' ? 'ok' : c.state === 'expired' ? 'bad' : '';
    const word = c.state === 'available' ? `Available, use by ${fmtDate(c.expires_at)}` : c.state === 'expired' ? `Expired ${fmtDate(c.expires_at)}` : c.state === 'returned' ? 'Run failed, given back' : `Used ${c.used_at ? fmtDate(c.used_at) : ''}`;
    const adsHref = c.kind === 'ads research' && /^[A-Za-z0-9_-]{20}$/.test(String(c.used_for ?? '')) ? `/account/ads/${c.used_for}` : '';
    const on = (c.state === 'used' || c.state === 'returned') && c.used_for
      ? (adsHref ? ` (<a href="${esc(adsHref)}">open the report</a>)` : ` (on ${esc(names[String(c.used_for).toLowerCase()] ?? String(c.used_for).slice(0, 8))})`)
      : '';
    return `<div class="ccard ${esc(c.state ?? '')}"><b>${esc(creditName(c.kind))}</b><span class="cnote">${esc(c.note ?? '')}${on}</span><span class="badge ${tone}">${esc(word.trim())}</span></div>`;
  }).join('')}</div>`;
}

// "Run a full report" with a credit: pick one of the account's own reports. A report that already has a finished run is run
// again (the check after you applied the corrections).
function runForm(runnable, balance, price, buyHref) {
  const n = balance.full_report ?? 0;
  if (!runnable.length) return '<div class="empty"><b>No report to run yet.</b> Ask for a <a href="/account/previews">free preview</a> first; a credit can then run its full report.</div>';
  const opts = runnable.map((r) => `<option value="${esc(r.id)}">${esc(r.company)} (${esc(r.kind)})</option>`).join('');
  const buy = buyHref ? ` <a href="${esc(buyHref)}">Buy another bundle (${esc(price)})</a>` : '';
  return `<form method="post" action="/account/reports/run" class="runform">
<label>Which report? <select name="report" required>${opts}</select></label>
<button class="btn" type="submit"${n ? '' : ' disabled'}>Run a full report (uses 1 credit)</button>
${n ? '' : `<p class="hint">You have no full-report credit left.${buy}</p>`}
</form>`;
}

// "Run Social Media Ads Research" with the ads credit: the product or industry, and the country whose ads are read.
function adsForm(balance, countries) {
  const n = balance['ads research'] ?? 0;
  const opts = countries.map((c) => `<option value="${esc(c.name)}"${c.name === 'Malaysia' ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<form method="post" action="/account/reports/ads" class="runform">
<label>Product or industry to research <input name="keyword" required maxlength="80" placeholder="for example: solar panel installation"></label>
<label>Country <select name="country">${opts}</select></label>
<button class="btn" type="submit"${n ? '' : ' disabled'}>Run Social Media Ads Research (uses 1 credit)</button>
${n ? '' : '<p class="hint">You have no Social Media Ads Research credit left.</p>'}
</form>`;
}

const ADS_BADGE = { completed: ['ok', 'Ready'], partial: ['ok', 'Ready, partly'], failed: ['bad', 'Hit a problem'], queued: ['wait', 'Waiting in the queue'], running: ['wait', 'Being written'] };

// Each ads report an ads credit started, with its real state from the factory (never hidden: a failure shows its reason).
function adsRunRows(runs) {
  if (!runs.length) return '';
  return `<section><h2>Social Media Ads Research</h2><div class="list">${runs.map((r) => {
    const [tone, label] = ADS_BADGE[r.status] ?? ['wait', r.status ? `Status: ${r.status}` : 'Status unavailable'];
    const again = r.returned ? ' Your credit was given back, so you can run it again.' : ' Tell us and we will run it again.';
    const detail = r.status === 'failed' ? `<span class="hint">${r.error ? `The factory said: ${esc(String(r.error).replace(/[.\s]+$/, ''))}.` : 'The run failed.'}${again}</span>` : (r.ads_total != null ? `<span class="hint">${esc(`${r.ads_total} ads read from ${r.advertisers ?? '?'} advertisers`)}</span>` : '');
    return `<div class="row"><div class="what"><b>${esc(r.title || 'Social Media Ads Research')}</b><span>Started ${esc(fmtDate(r.used_at))} with 1 ads credit${r.returned ? ' (given back)' : ''}</span>${detail}</div><div class="acts"><span class="badge ${tone}">${esc(label)}</span><a class="btn sm" href="/account/ads/${esc(r.public_id)}">Open report</a></div></div>`;
  }).join('')}</div></section>`;
}

function creditRunRows(runs) {
  if (!runs.length) return '';
  return `<section><h2>Reports run with a credit</h2><div class="list">${runs.map((r) => reportRow({ company: r.company, paid_at: r.used_at, report_id: r.report_id, id: 0 }, r.status, { invoice: false })).join('')}</div></section>`;
}

function reportRow(o, st, { invoice = true } = {}) {
  const href = o.report_id ? `/r/${o.report_id}` : (o.report_url || '');
  return `<div class="row">
<div class="what"><b>${esc(o.company)}</b><span>${invoice ? `${esc(o.invoice_no)} · ${esc(fmtMoney(o.amount_cents, o.currency))} · paid ${esc(fmtDate(o.paid_at))}` : `Started with 1 report credit · ${esc(fmtDate(o.paid_at))}`}</span>${st?.line ? `<span class="hint">${esc(st.line)}</span>` : ''}</div>
<div class="acts"><span class="badge ${esc(st?.tone ?? 'bad')}">${esc(st?.label ?? 'Status unavailable')}</span>
${href ? `<a class="btn sm" href="${esc(href)}">Open report</a>` : ''}
${invoice ? `<a href="/account/invoices/${o.id}">Receipt</a>
<form method="post" action="/account/invoices/${o.id}/resend"><button class="link" type="submit">Email it to me</button></form>` : ''}</div>
${st?.steps && st.tone !== 'ok' ? progressList(st) : ''}
</div>`;
}

const PAGE_CSS = `
.runform { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; margin:0 0 16px; }
.runform label { display:flex; flex-direction:column; gap:4px; font-weight:600; font-size:14px; }
.runform input, .runform select { font:inherit; padding:10px 12px; border:1px solid #cfd3d8; border-radius:10px; min-width:260px; max-width:100%; background:#fff; }
.runform .btn[disabled] { opacity:.5; cursor:not-allowed; }
.runform .hint { flex-basis:100%; margin:0; }
.cgrid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin-top:20px; }
.ccard { display:flex; flex-direction:column; align-items:flex-start; gap:6px; border:1px solid var(--line); border-radius:14px; padding:18px; background:#fff; }
.ccard b { display:block; color:var(--ink); font-size:17px; line-height:1.25; }
.ccard .cnote { font-size:14px; color:var(--grey); line-height:1.45; flex:1 1 auto; }
.ccard .badge { margin-top:8px; white-space:normal; border-radius:10px; line-height:1.35; padding:6px 10px; }
.ccard.available { border-color:#9fd6b3; box-shadow:0 0 0 1px #9fd6b3 inset; }
.ccard.used, .ccard.expired { background:var(--band); }
.ccard.used b, .ccard.expired b { color:var(--grey); }
@media (max-width:1100px) { .cgrid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:520px) { .cgrid { grid-template-columns:1fr; } }
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
export function overviewPage({ shell, previews, orders, earnings = {}, price, credits = { full_report: 0, 'ads research': 0 }, creditList = [], notice = null, previewProgress = {}, orderStatuses = {} }) {
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
  else if (!running.length && orders.length) { const o = orders[0]; next = { h: `Your report on ${o.company}`, p: `Bought ${fmtDate(o.paid_at)}. Find every report and receipt on the reports page.`, a: `<a class="btn" href="${esc(o.report_id ? `/r/${o.report_id}` : (o.report_url || '/account/reports'))}">Open the report</a>` }; }
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

<section><h2>Report credits <a href="/account/reports#credits">Use or see all</a></h2><div class="list"><div class="row"><div class="what"><b>${esc(creditLine(credits))}</b><span>${(() => { const x = nextExpiry(creditList); return x ? `Left to use. The next one to expire: ${esc(creditName(x.kind))}, use by ${esc(x.date)}.` : 'Left to use. Credits last 90 days from payment.'; })()}</span></div></div></div></section>

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
export function reportsPage({ shell, orders, statuses = {}, notice = null, price, credits = { full_report: 0, 'ads research': 0 }, creditList = [], runnable = [], creditRuns = [], adsRuns = [], names = {}, buyHref = '' }) {
  const body = (orders.length
    ? `<div class="list">${orders.map((o) => reportRow(o, statuses[o.id])).join('')}</div>`
    : `<div class="empty"><b>Nothing bought yet.</b> Read a <a href="/account/previews">free preview</a> first. If it shows what you need, the report bundle is ${esc(price)} (2 full reports + 1 Social Media Ads report), one payment, and it appears here with its official receipt.</div>`)
    + creditRunRows(creditRuns)
    + adsRunRows(adsRuns)
    + `<section id="credits"><h2>Report credits</h2><p class="hint"><b>${esc(creditLine(credits))}</b> left to use. Each credit is valid for 90 days from payment.</p>${runForm(runnable, credits, price, buyHref)}${adsForm(credits, RESEARCHED_COUNTRIES)}${creditRows(creditList, names)}</section>`;
  return accountPage({
    title: 'Full reports', lede: `Each report you bought, its state, and its official receipt. The bundle is ${esc(price)}: 2 full reports and 1 Social Media Ads report, one payment. Run your second report from the credits below.`,
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
<div><h1>Team: preview requests</h1><p>Signed in as <b>${esc(email)}</b> · <a href="/myoffice">Office home</a> · <a href="/account">Back to your account</a> · <a href="/myoffice/reports/previews">All free previews</a> · <a href="/myoffice/reports/full">All full reports</a> · <a href="/myoffice/users">Users</a> · <a href="/myoffice/visitors">Visitors</a> · <a href="/myoffice/referrals">Referral payouts</a></p></div>
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
