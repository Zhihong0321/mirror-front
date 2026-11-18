// The office home, /myoffice: the admin dashboard (owner, 2026-11-18). Three jobs, top to bottom:
//   1. external tool health   the services this site depends on: are they answering right now?
//   2. running now            free previews and full reports that are in progress, and the ones that just failed
//   3. users                  every account
// Pure: the caller (app.js) reads everything and hands it in. A part that could not be read arrives as an `error`
// string and is shown as a label on that part; the rest of the page still shows. Nothing here throws on odd data.

import { esc } from './pages.js';
import { officePage } from './office-shell.js';
import { ago } from './preview-progress.js';
import { userUrl } from './users-page.js';

const CSS = `
h2 { font-family:var(--display); font-size:22px; margin:30px 0 4px; letter-spacing:-0.02em; }
h3 { font-family:var(--display); font-size:16px; margin:20px 0 8px; }
.lead { font-size:14px; margin:0 0 14px; }
.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:10px; margin:0 0 8px; }
.card { border:1px solid var(--line); border-radius:12px; padding:12px 14px; border-left-width:5px; }
.card.ok { border-left-color:var(--good); }
.card.bad { border-left-color:var(--wrong); background:#fdf6f5; }
.card.warn { border-left-color:#d98a12; }
.card.off { border-left-color:#b7bcc3; }
.card b { display:block; font-size:15px; }
.card .what { font-size:12px; color:var(--grey); }
.card .state { font-size:14px; font-weight:600; margin-top:6px; }
.card.ok .state { color:var(--good); } .card.bad .state { color:var(--wrong); } .card.warn .state { color:#a15c07; }
.card .detail { font-size:12px; color:var(--grey); overflow-wrap:anywhere; margin-top:2px; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin:0 0 14px; }
.kpi { border:1px solid var(--line); border-radius:12px; padding:10px 14px; }
.kpi b { display:block; font-family:var(--display); font-size:24px; letter-spacing:-0.02em; color:var(--ink); line-height:1.15; }
.kpi span { font-size:13px; color:var(--grey); }
.tbl { width:100%; overflow-x:auto; margin:0 0 10px; }
table.t { width:100%; border-collapse:collapse; font-size:14px; min-width:640px; }
table.t th { text-align:left; font-size:12px; color:var(--grey); font-weight:600; padding:0 10px 8px 0; white-space:nowrap; }
table.t td { padding:9px 10px 9px 0; border-top:1px solid var(--line); vertical-align:top; }
table.t a { color:var(--ink); }
.sub { display:block; font-size:12px; color:var(--grey); overflow-wrap:anywhere; }
.badge { display:inline-block; font-size:12px; font-weight:600; padding:1px 8px; border-radius:99px; background:var(--band); color:var(--grey); white-space:nowrap; }
.badge.ok { background:var(--good-bg); color:var(--good); }
.badge.bad { background:#fdecea; color:var(--wrong); }
.badge.wait { background:#fdf3e2; color:#a15c07; }
.problem { background:#fdecea; color:var(--wrong); padding:12px 14px; border-radius:10px; }
.none { border:1px dashed var(--line); border-radius:12px; padding:14px; font-size:14px; color:var(--grey); margin:0 0 10px; }
form.search { display:flex; gap:8px; margin:0 0 14px; max-width:520px; }
form.search input { margin:0; }
form.search .btn { padding:10px 16px; font-size:15px; }
.pcards { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; margin:8px 0 12px; }
.pcard { border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
.pcard h3 { margin:0 0 10px; font-size:15px; }
.pnums { display:grid; grid-template-columns:1fr 1fr; gap:12px 14px; }
.pnums b { display:block; font-family:var(--display); font-size:26px; letter-spacing:-0.02em; color:var(--ink); line-height:1.1; overflow-wrap:anywhere; }
.pnums span { font-size:12px; color:var(--grey); }
table.perf th.n, table.perf td.n { text-align:right; }
table.perf td.n { white-space:nowrap; position:relative; }
table.perf tr.cur td { background:#f7f9ff; }
table.perf tfoot td { border-top:2px solid var(--ink); font-weight:600; color:var(--ink); }
table.perf .bar { display:block; height:4px; border-radius:2px; margin:4px 0 0 auto; min-width:0; }
table.perf .bar.p { background:#067647; }
table.perf .bar.v { background:#2f6fed; }
table.perf td.fake, .pcard .fake { color:#a15c07; }
.pcard .fake { font-size:12px; margin:10px 0 0; }`;

const num = (n) => Number(n ?? 0).toLocaleString('en');
const money = (cents, cur) => (cents ? `${String(cur ?? '').toUpperCase()} ${(Number(cents) / 100).toFixed(Number(cents) % 100 ? 2 : 0)}`.trim() : '');
const toMs = (v) => { const t = typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(v); return Number.isFinite(t) ? t : null; };

// Factory preview rows (reportDb.startedSince) finished in the last 24 hours.
export function previewDoneCount(rows = [], now = Date.now()) {
  let n = 0;
  for (const r of rows ?? []) {
    try {
      const t = toMs(r?.updated_at) ?? toMs(r?.created_at);
      if (previewKind(r).kind === 'done' && t != null && now - t < 86400000) n += 1;
    } catch { /* one odd row is not counted */ }
  }
  return n;
}

function timeFmt(tz) {
  const opts = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
  let f;
  try { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }); } catch { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }); }
  return (t) => { try { return t ? f.format(new Date(Number(t))) : ''; } catch { return ''; } };
}

// "3 h 20 min" for a length of time in ms.
export function span(ms) {
  const m = Math.floor(Number(ms) / 60_000);
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.floor(h / 24)} days`;
}

// A run that has been going this long gets a warning label (it is still shown, and still running as far as we know).
export const SLOW_PREVIEW_MS = 60 * 60_000;
export const SLOW_FULL_MS = 3 * 60 * 60_000;

const stepOf = (v) => {
  const s = String(v ?? '').toLowerCase();
  if (s === 'done' || s === 'ok') return 'done';
  if (s === 'failed' || s === 'error') return 'bad';
  if (s === 'running' || s === 'queued' || s === 'in_progress') return 'now';
  return 'todo';
};
const PREVIEW_STEPS = [['step1_status', 'Researching the company'], ['step1_5_status', 'Website and online presence'], ['step2_status', 'Analysing'], ['step3_status', 'Writing the preview']];

// One factory report row -> { kind: 'running' | 'done' | 'failed', step }. Never throws.
export function previewKind(row) {
  try {
    const states = PREVIEW_STEPS.map(([k]) => stepOf(row?.[k]));
    if (states.includes('bad')) return { kind: 'failed', step: PREVIEW_STEPS[states.indexOf('bad')][1] };
    if (states[3] === 'done') return { kind: 'done', step: '' };
    const open = states.findIndex((s) => s !== 'done');
    return { kind: 'running', step: PREVIEW_STEPS[open < 0 ? 3 : open][1] };
  } catch { return { kind: 'running', step: '' }; }
}

// Preview work in progress: every open site request (matched to its factory report when there is one), plus every factory
// report from the last days that is still running and was not started by a site request (started from the factory).
// `rows`: reportDb.startedSince(). `match`: matchFactory. `open`: the site's requests that are not ready.
export function previewJobs({ open = [], rows = [], match, now = Date.now() }) {
  const used = new Set();
  const jobs = [];
  for (const p of open ?? []) {
    let f = null;
    try { f = match ? match(p, rows) : null; } catch { /* shown as waiting */ }
    if (f?.report_id) used.add(String(f.report_id));
    const k = f ? previewKind(f) : null;
    const started = f ? toMs(f.created_at) : null;
    jobs.push({
      company: p.company || '(no company name)', who: p.email, source: 'site request', requestId: p.id,
      state: !f ? 'waiting' : k.kind === 'failed' ? 'failed' : k.kind === 'done' ? 'finishing' : 'running',
      step: !f ? (p.factory_error ? `could not start: ${p.factory_error}` : 'not started on the factory yet') : k.step,
      since: started ?? toMs(p.created_at), reportId: f?.report_id ?? p.factory_report_id ?? null, now,
    });
  }
  for (const r of rows ?? []) {
    if (!r?.report_id || used.has(String(r.report_id))) continue;
    const k = previewKind(r);
    if (k.kind === 'done') continue;
    jobs.push({ company: r.company || '(no company name)', who: '', source: 'started on the factory', requestId: null,
      state: k.kind === 'failed' ? 'failed' : 'running', step: k.step, since: toMs(r.created_at), reportId: r.report_id, now });
  }
  return jobs;
}

// Full-report runs from reportDb.recentRuns(): { running: [], failed: [], doneCount }. Newest first.
export function fullJobs({ runs = [], buyers = {}, now = Date.now(), failedWithinMs = 3 * 86400000 }) {
  const out = { running: [], failed: [], doneCount: 0 };
  for (const r of runs ?? []) {
    if (!r) continue;
    const s = String(r.status ?? '').toLowerCase();
    const made = toMs(r.created_at);
    const row = { company: r.company || '(no company name)', reportId: r.report_id, runId: r.run_id, status: r.status ?? '', stage: r.stage ?? '',
      error: r.error ?? '', since: made, buyer: buyers[String(r.report_id ?? '').toLowerCase()] ?? '' };
    if (s === 'done' || s === 'incomplete') { if (made && now - made < 86400000) out.doneCount += 1; } else if (s === 'failed') { if (!made || now - made < failedWithinMs) out.failed.push(row); } else out.running.push(row);
  }
  return out;
}

const TONE = { ok: 'ok', bad: 'bad', warn: 'warn', off: 'off' };
function healthCard(c) {
  const tone = TONE[c?.tone] ?? 'off';
  return `<div class="card ${tone}"><b>${esc(c?.name ?? '')}</b><span class="what">${esc(c?.role ?? '')}</span>
<div class="state">${esc(c?.label ?? '')}${Number.isFinite(c?.ms) ? ` · ${Math.round(c.ms)} ms` : ''}</div>${c?.detail ? `<div class="detail">${esc(c.detail)}</div>` : ''}</div>`;
}

const table = (cols, rows) => `<div class="tbl"><table class="t"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;

const moneyAll = (rev) => Object.entries(rev ?? {}).filter(([, c]) => c).map(([cur, c]) => money(c, cur)).join(' + ') || '0';
const ratio = (visitors, previews) => (previews > 0 ? (visitors / previews).toFixed(visitors / previews >= 10 ? 0 : 1) : '–');

// The platform performance overview (performance.js buildPerformance). perf: { data, errors: { previews, visitors, orders }, testMode }.
// A part that could not be read shows "–" in its column and a label above; the other columns still show.
function perfSection(perf = {}) {
  const d = perf.data;
  const err = perf.errors ?? {};
  if (!d) return `<p class="problem">The performance figures could not be worked out just now${perf.error ? `: ${esc(perf.error)}` : ''}.</p>`;
  const cell = (miss, v) => (miss ? '–' : num(v));
  const problems = [
    err.previews ? `Published previews could not be read (report database): ${err.previews}` : '',
    err.visitors ? `Visitors could not be read: ${err.visitors}` : '',
    err.orders ? `Sales could not be read: ${err.orders}` : '',
    d.skipped?.previews ? `${d.skipped.previews} preview(s) have no date and are left out of the weeks and months.` : '',
    d.skipped?.orders ? `${d.skipped.orders} order(s) have no date or amount and are left out.` : '',
  ].filter(Boolean).map((t) => `<p class="problem">${esc(t)}</p>`).join('');

  const card = (title, r) => `<div class="pcard"><h3>${esc(title)}</h3><div class="pnums">
<div><b>${cell(err.previews, r?.previews)}</b><span>Published preview reports</span></div>
<div><b>${cell(err.visitors, r?.visitors)}</b><span>Unique visitors</span></div>
<div><b>${err.previews || err.visitors ? '–' : ratio(r?.visitors ?? 0, r?.previews ?? 0)}</b><span>Visitors per preview</span></div>
<div><b>${err.orders ? '–' : esc(moneyAll(r?.revenue))}</b><span>Real sales · ${cell(err.orders, r?.orders)} order${r?.orders === 1 ? '' : 's'}</span></div></div>
${!err.orders && r?.testOrders ? `<p class="fake">Not counted: ${num(r.testOrders)} Stripe test payment${r.testOrders === 1 ? '' : 's'} (${esc(moneyAll(r.testRevenue))}, fake money)</p>` : ''}</div>`;

  const bars = (rows) => {
    const maxP = Math.max(1, ...rows.map((r) => r.previews));
    const maxV = Math.max(1, ...rows.map((r) => r.visitors));
    return rows.map((r) => `<tr${r.current ? ' class="cur"' : ''}><td style="white-space:nowrap"><b>${esc(r.label)}</b></td>
<td class="n">${cell(err.previews, r.previews)}<i class="bar p" style="width:${err.previews ? 0 : Math.round((r.previews / maxP) * 100)}%"></i></td>
<td class="n">${cell(err.visitors, r.visitors)}<i class="bar v" style="width:${err.visitors ? 0 : Math.round((r.visitors / maxV) * 100)}%"></i></td>
<td class="n">${err.previews || err.visitors ? '–' : ratio(r.visitors, r.previews)}</td>
<td class="n">${cell(err.orders, r.orders)}</td>
<td class="n">${err.orders ? '–' : esc(moneyAll(r.revenue))}</td>
<td class="n fake">${err.orders ? '–' : r.testOrders ? `${num(r.testOrders)} · ${esc(moneyAll(r.testRevenue))}` : '0'}</td></tr>`).join('');
  };
  const cols = ['', 'Published preview reports', 'Unique visitors', 'Visitors per preview', 'Real orders', 'Real sales', 'Test payments (fake, not counted)'];
  const ptable = (rows, total) => `<div class="tbl"><table class="t perf"><thead><tr>${cols.map((c, i) => `<th${i ? ' class="n"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${bars(rows)}</tbody><tfoot><tr><td><b>All time</b></td><td class="n">${cell(err.previews, total.previews)}</td><td class="n">${cell(err.visitors, total.visitors)}</td>
<td class="n">${err.previews || err.visitors ? '–' : ratio(total.visitors, total.previews)}</td><td class="n">${cell(err.orders, total.orders)}</td><td class="n">${err.orders ? '–' : esc(moneyAll(total.revenue))}</td><td class="n fake">${err.orders ? '–' : total.testOrders ? `${num(total.testOrders)} · ${esc(moneyAll(total.testRevenue))}` : '0'}</td></tr></tfoot></table></div>`;

  return `${problems}
<div class="pcards">${card('This week', d.thisWeek)}${card('This month', d.thisMonth)}${card('All time', d.total)}</div>
<p class="lead">Published preview report = a free preview the factory has written, counted on the day it was written. Unique visitor = one browser, counted once per week, month or in total; bots left out. Real sales = orders paid with real money, counted on the day paid. Payments made with Stripe test keys are fake: they are shown apart as test payments and never added to sales.${perf.testMode ? ' <span class="badge wait">Stripe is in test mode: no real money can be taken yet</span>' : ''}</p>
<h3>By week</h3>
${ptable(d.weeks ?? [], d.total)}
<h3>By month</h3>
${ptable(d.months ?? [], d.total)}`;
}

// health: [{ name, role, tone: ok|bad|warn|off, label, detail, ms }]
// previews: { jobs: previewJobs(), error, doneCount, failedCount }  full: { running, failed, doneCount, error }
// users: { rows: store.allUsers(), error }
export function officeHomePage({ email, badges, now = Date.now(), tz, perf = {}, health = [], previews = {}, full = {}, users = {}, usersShown = 100 }) {
  const at = timeFmt(tz);
  const jobs = previews.jobs ?? [];
  const slow = (since, limit) => since != null && now - since > limit;

  const healthBad = health.filter((c) => c?.tone === 'bad').length;
  const healthWarn = health.filter((c) => c?.tone === 'warn').length;
  const healthLine = healthBad ? `<span class="badge bad">${healthBad} not working</span>` : healthWarn ? `<span class="badge wait">${healthWarn} to watch</span>` : '<span class="badge ok">all answering</span>';

  const previewRows = jobs.map((j) => `<tr>
<td><b>${esc(j.company)}</b><span class="sub">${esc(j.source)}${j.who ? ` · ${esc(j.who)}` : ''}${j.requestId ? ` · request #${esc(j.requestId)}` : ''}</span></td>
<td>${j.state === 'failed' ? '<span class="badge bad">A step failed</span>' : j.state === 'waiting' ? '<span class="badge wait">Waiting to start</span>' : j.state === 'finishing' ? '<span class="badge wait">Finishing</span>' : '<span class="badge ok">Running</span>'}
${slow(j.since, SLOW_PREVIEW_MS) && j.state !== 'failed' ? ' <span class="badge bad">long: check it</span>' : ''}<span class="sub">${esc(j.step)}</span></td>
<td style="white-space:nowrap">${j.since ? `${esc(span(now - j.since))}<span class="sub">since ${esc(at(j.since))}</span>` : ''}</td>
<td>${j.reportId ? `<a href="/p/${esc(j.reportId)}" target="_blank" rel="noopener">Open preview</a>` : ''}</td></tr>`).join('');

  const fullRows = (full.running ?? []).map((r) => `<tr>
<td><b>${esc(r.company)}</b><span class="sub">${r.buyer ? `bought by ${esc(r.buyer)}` : 'no buyer on record'} · run ${esc(r.runId)}</span></td>
<td><span class="badge ${/^(queued|running)$/i.test(r.status) ? 'ok' : 'wait'}">${esc(/^(queued|running)$/i.test(r.status) ? r.status : `status: ${r.status || 'unknown'}`)}</span>
${slow(r.since, SLOW_FULL_MS) ? ' <span class="badge bad">long: check it</span>' : ''}${r.stage ? `<span class="sub">${esc(r.stage)}</span>` : ''}</td>
<td style="white-space:nowrap">${r.since ? `${esc(span(now - r.since))}<span class="sub">since ${esc(at(r.since))}</span>` : ''}</td>
<td>${r.reportId ? `<a href="/r/${esc(r.reportId)}" target="_blank" rel="noopener">Open report</a>` : ''}</td></tr>`).join('');

  const failedRows = (full.failed ?? []).map((r) => `<tr>
<td><b>${esc(r.company)}</b><span class="sub">${r.buyer ? `bought by ${esc(r.buyer)}` : 'no buyer on record'} · run ${esc(r.runId)}</span></td>
<td><span class="badge bad">Failed</span>${r.error ? `<span class="sub">${esc(r.error)}</span>` : ''}</td>
<td style="white-space:nowrap">${r.since ? `${esc(ago(r.since, now))}<span class="sub">${esc(at(r.since))}</span>` : ''}</td>
<td>${r.reportId ? `<a href="/r/${esc(r.reportId)}" target="_blank" rel="noopener">Open report</a>` : ''}</td></tr>`).join('');

  const all = users.rows ?? [];
  const day = 86400000;
  const kpis = {
    accounts: all.length,
    new7: all.filter((u) => now - Number(u.created_at) < 7 * day).length,
    in24: all.filter((u) => u.last_login_at && now - Number(u.last_login_at) < day).length,
    buyers: all.filter((u) => Number(u.orders) > 0).length,
    paid: all.reduce((t, u) => t + (Number(u.paid_cents) || 0), 0),
  };
  const cur = all.find((u) => u.currency)?.currency;
  const userRows = all.slice(0, usersShown).map((u) => `<tr>
<td><a href="${esc(userUrl(u.email))}"><b>${esc(u.email)}</b></a></td>
<td style="white-space:nowrap">${esc(at(u.created_at))}</td>
<td style="white-space:nowrap">${esc(at(u.last_login_at)) || '–'}</td>
<td>${num(u.previews)}${u.open_previews ? ` <span class="badge wait">${num(u.open_previews)} waiting</span>` : ''}</td>
<td>${num(u.orders)}${u.paid_cents ? `<span class="sub">${esc(money(u.paid_cents, u.currency))}</span>` : ''}</td>
<td>${num(u.views)}${u.last_seen_at ? `<span class="sub">last ${esc(at(u.last_seen_at))}</span>` : ''}</td></tr>`).join('');

  const body = `<h1>Dashboard</h1>
<p>Checked ${esc(at(now))} · this page refreshes by itself every minute · <a href="/myoffice">Refresh now</a></p>

<h2>1. Platform performance overview</h2>
${perfSection(perf)}

<h2>2. External tool health ${healthLine}</h2>
<p class="lead">Checked live each time this page loads. A tool that is down is labelled here; the site keeps working.</p>
<div class="cards">${health.length ? health.map(healthCard).join('') : '<div class="none">No checks ran.</div>'}</div>

<h2>3. Running now</h2>
<p class="lead">Work in progress on the report factory. A job that has run unusually long is labelled, not hidden.</p>
<h3>Free previews (${jobs.length})${previews.doneCount != null ? ` <span class="badge ok">${num(previews.doneCount)} finished in the last 24 h</span>` : ''}</h3>
${previews.error ? `<p class="problem">The factory's preview progress could not be read just now: ${esc(previews.error)}. Site requests are still listed below.</p>` : ''}
${jobs.length ? table(['Company', 'Where it is', 'Running for', ''], previewRows) : '<div class="none">No free preview is running or waiting.</div>'}

<h3>Full reports (${(full.running ?? []).length})${full.doneCount != null ? ` <span class="badge ok">${num(full.doneCount)} finished in the last 24 h</span>` : ''}</h3>
${full.error ? `<p class="problem">The full-report runs could not be read just now: ${esc(full.error)}.</p>` : ''}
${(full.running ?? []).length ? table(['Company', 'Status', 'Running for', ''], fullRows) : '<div class="none">No full report is running.</div>'}
${(full.failed ?? []).length ? `<h3>Failed full reports, last 3 days (${full.failed.length})</h3>${table(['Company', 'Status', 'When', ''], failedRows)}` : ''}

<h2>4. Users</h2>
<div class="kpis">
<div class="kpi"><b>${num(kpis.accounts)}</b><span>Accounts</span></div>
<div class="kpi"><b>${num(kpis.new7)}</b><span>New in 7 days</span></div>
<div class="kpi"><b>${num(kpis.in24)}</b><span>Signed in, last 24 h</span></div>
<div class="kpi"><b>${num(kpis.buyers)}</b><span>Have bought</span></div>
<div class="kpi"><b>${esc(money(kpis.paid, cur)) || '0'}</b><span>Paid in total</span></div></div>
<form class="search" method="get" action="/myoffice/users"><input type="text" name="q" placeholder="Search users by email"><button class="btn" type="submit">Search</button></form>
${users.error ? `<p class="problem">The account list could not be read just now: ${esc(users.error)}.</p>` : userRows ? table(['Email', 'Signed up', 'Last sign-in', 'Previews', 'Orders', 'Page views signed in'], userRows) : '<div class="none">No accounts yet.</div>'}
${all.length > usersShown ? `<p class="small">Showing the ${num(usersShown)} most recently active of ${num(all.length)}. <a href="/myoffice/users">All users</a></p>` : '<p class="small"><a href="/myoffice/users">Users page</a>, with search</p>'}`;

  return officePage('Dashboard', body, { on: '/myoffice', email, badges, css: CSS, refresh: 60 });
}
