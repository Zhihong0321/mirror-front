// Team pages that list every company-diver report (owner, 2026-11-12):
//   /myoffice/reports/previews   every report, with a link to its free preview (/p/<id>)
//   /myoffice/reports/full       every report that has a full-report run, with a link to it (/r/<id>)
// Read only. A row that cannot be read well is still listed, with a label; a database problem is shown on the page.

import { page, esc } from './pages.js';
import { chooseView } from './reports.js';

const day = (v) => { const t = v ? new Date(v) : null; return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : ''; };

const CSS = `
.tabs { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 20px; }
.tabs a { font-size:15px; font-weight:600; padding:8px 14px; border-radius:99px; border:1px solid var(--line); color:var(--ink); text-decoration:none; }
.tabs a.on { background:var(--ink); color:#fff; border-color:var(--ink); }
.tbl { width:100%; overflow-x:auto; }
table.rep { width:100%; border-collapse:collapse; font-size:15px; }
table.rep th { text-align:left; font-size:13px; color:var(--grey); font-weight:600; padding:0 10px 8px 0; }
table.rep td { padding:10px 10px 10px 0; border-top:1px solid var(--line); vertical-align:top; }
table.rep td.co b { display:block; }
table.rep td.co span { font-size:13px; color:var(--grey); }
table.rep a.open { font-weight:600; color:var(--ink); white-space:nowrap; }
.badge { display:inline-block; font-size:13px; font-weight:600; padding:2px 9px; border-radius:99px; background:var(--band); color:var(--grey); white-space:nowrap; }
.badge.ok { background:var(--good-bg); color:var(--good); }
.badge.bad { background:#fdecea; color:var(--wrong); }
.badge.wait { background:#fdf3e2; color:#a15c07; }
.problem { background:#fdecea; color:var(--wrong); padding:12px 14px; border-radius:10px; }`;

function shell({ email, tab, title, lead, body }) {
  const tabs = `<nav class="tabs"><a href="/myoffice/reports/previews"${tab === 'p' ? ' class="on"' : ''}>Free previews</a><a href="/myoffice/reports/full"${tab === 'r' ? ' class="on"' : ''}>Full reports</a></nav>`;
  return page(title, `<h1>${esc(title)}</h1>
<p>Signed in as <b>${esc(email)}</b> · <a href="/myoffice/previews">Preview requests</a> · <a href="/myoffice/visitors">Visitors</a> · <a href="/myoffice/users">Users</a> · <a href="/account">Dashboard</a></p>
${tabs}<p>${lead}</p>${body}`, { wide: true, css: CSS });
}

const company = (r) => `<td class="co"><b>${esc(r.company || '(no company name)')}</b><span>${esc([r.industry, r.country].filter(Boolean).join(' · '))}${r.website ? ` · ${esc(r.website)}` : ''}</span></td>`;

// rows: from reportDb.allReports(). error: a message when the database could not be read.
// visits: Map of page key -> visit stats (visits.js pages()), or null when they could not be read.
export function previewsListPage({ email, rows = [], error = null, visits = null, logUrl = null, keyOf = (id) => `/p/${id}` }) {
  const seen = (r) => {
    if (!logUrl) return '';
    const v = visits?.get(keyOf(r.report_id));
    const label = !visits ? 'Tracker log' : v ? `${v.views} view${v.views === 1 ? '' : 's'} · ${v.visitors} visitor${v.visitors === 1 ? '' : 's'}` : 'Not viewed yet';
    return `<a href="${esc(logUrl(r.report_id))}">${esc(label)}</a>`;
  };
  const ready = rows.filter((r) => r.has_preview).length;
  const body = error
    ? `<p class="problem">The report database could not be read just now: ${esc(error)}. Refresh in a minute.</p>`
    : rows.length
      ? `<div class="tbl"><table class="rep"><thead><tr><th>Company</th><th>Created</th><th>Preview</th><th>Visitors</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr>${company(r)}
<td>${esc(day(r.created_at))}</td>
<td>${r.has_preview ? '<span class="badge ok">Written</span>' : '<span class="badge wait">Not written yet</span>'}</td>
<td>${seen(r)}</td>
<td><a class="open" href="/p/${esc(r.report_id)}" target="_blank" rel="noopener">Open preview</a></td></tr>`).join('')}</tbody></table></div>`
      : '<p>No reports in the database yet.</p>';
  return shell({ email, tab: 'p', title: 'All free previews', body,
    lead: error ? '' : `${rows.length} reports, newest first. ${ready} have a written preview. A preview that is not written yet opens the "being prepared" page.` });
}

const VIEW = {
  report: (v) => v.label ? `<span class="badge ok">Ready, with a note</span><br><span class="small">${esc(v.label)}</span>` : '<span class="badge ok">Ready</span>',
  progress: (v) => `<span class="badge wait">Being written</span>${v.run?.stage ? `<br><span class="small">${esc(v.run.stage)}</span>` : ''}`,
  failed: () => '<span class="badge bad">Failed</span>',
  unknown: (v) => `<span class="badge">Status: ${esc(v.run?.status)}</span>`,
  none: () => '<span class="badge">No run</span>',
};

// runs: from reportDb.allRuns() (newest first, every report mixed). Grouped here, one row per report.
export function fullListPage({ email, runs = [], error = null }) {
  const byReport = new Map();
  for (const r of runs) {
    if (!r?.report_id) continue;
    if (!byReport.has(r.report_id)) byReport.set(r.report_id, []);
    byReport.get(r.report_id).push(r);
  }
  const rows = [...byReport.values()].map((list) => {
    let v;
    try { v = chooseView(list); } catch { v = { kind: 'unknown', run: list[0] }; }
    return { card: list[0], view: v, count: list.length };
  });
  const ready = rows.filter((r) => r.view.kind === 'report').length;
  const body = error
    ? `<p class="problem">The report database could not be read just now: ${esc(error)}. Refresh in a minute.</p>`
    : rows.length
      ? `<div class="tbl"><table class="rep"><thead><tr><th>Company</th><th>Latest run</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(({ card, view, count }) => `<tr>${company(card)}
<td>${esc(day(card.created_at))}${count > 1 ? `<br><span class="small">${count} runs</span>` : ''}</td>
<td>${(VIEW[view.kind] ?? VIEW.unknown)(view)}</td>
<td><a class="open" href="/r/${esc(card.report_id)}" target="_blank" rel="noopener">Open report</a></td></tr>`).join('')}</tbody></table></div>`
      : '<p>No full-report runs yet.</p>';
  return shell({ email, tab: 'r', title: 'All full reports', body,
    lead: error ? '' : `${rows.length} reports with a full-report run, newest first. ${ready} are ready to read.` });
}
