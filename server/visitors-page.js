// Team pages for visitor analytics, read from the visits table (visits.js):
//   /myoffice/visitors            overview: totals, tops and the whole visit log
//   /myoffice/visitors/pages      one row per page
//   /myoffice/visitors/previews   every free preview report, each with its own tracker log
//   /myoffice/visitors/page?key=  one page's own tracker log: its numbers, the people who viewed it, every view
// A problem reading the data is shown on the page; the page itself always renders.

import { page, esc } from './pages.js';

const CSS = `
.tabs { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
.tabs a { font-size:14px; font-weight:600; padding:6px 12px; border-radius:99px; border:1px solid var(--line); color:var(--ink); text-decoration:none; }
.tabs a.on { background:var(--ink); color:#fff; border-color:var(--ink); }
nav.tabs + nav.tabs a { font-size:13px; padding:5px 11px; }
.chips { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 18px; font-size:14px; }
.chip { background:#e8f0fe; color:#1a4fb8; padding:4px 10px; border-radius:99px; }
.chip a { color:inherit; margin-left:6px; text-decoration:none; font-weight:700; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin:0 0 24px; }
.kpi { border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
.kpi b { display:block; font-family:var(--display); font-size:28px; letter-spacing:-0.02em; color:var(--ink); line-height:1.1; }
.kpi span { font-size:13px; color:var(--grey); }
.tops { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:14px; margin:0 0 28px; }
.top { border:1px solid var(--line); border-radius:12px; padding:12px 14px; min-width:0; }
.top h3 { font-size:14px; margin:0 0 8px; color:var(--grey); font-weight:600; }
.top table { width:100%; border-collapse:collapse; font-size:14px; }
.top td { padding:4px 0; border-top:1px solid var(--line); }
.top td.k { overflow-wrap:anywhere; padding-right:8px; }
.top td.n { text-align:right; white-space:nowrap; color:var(--grey); }
h2 { font-family:var(--display); font-size:22px; margin:24px 0 10px; letter-spacing:-0.02em; }
.tbl { width:100%; overflow-x:auto; margin:0 0 24px; }
table.log { width:100%; border-collapse:collapse; font-size:14px; min-width:860px; }
table.log th { text-align:left; font-size:12px; color:var(--grey); font-weight:600; padding:0 10px 8px 0; white-space:nowrap; }
table.log td { padding:9px 10px 9px 0; border-top:1px solid var(--line); vertical-align:top; }
table.log td.p { overflow-wrap:anywhere; max-width:300px; }
table.log a { color:var(--ink); }
a.open { font-weight:600; white-space:nowrap; }
.sub { display:block; font-size:12px; color:var(--grey); overflow-wrap:anywhere; }
.badge { display:inline-block; font-size:12px; font-weight:600; padding:1px 8px; border-radius:99px; background:var(--band); color:var(--grey); white-space:nowrap; }
.badge.bot { background:#fdf3e2; color:#a15c07; }
.badge.me { background:var(--good-bg); color:var(--good); }
.problem { background:#fdecea; color:var(--wrong); padding:12px 14px; border-radius:10px; }
.pagehead { overflow-wrap:anywhere; }
.more { margin:16px 0 0; }`;

export const duration = (ms) => {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const s = Math.round(Number(ms) / 1000);
  if (s < 1) return '<1s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

function timeFmt(tz) {
  const opts = { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  let f;
  try { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }); }
  catch { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }); tz = 'UTC'; }
  return { tz, at: (t) => { try { return t ? f.format(new Date(Number(t))) : ''; } catch { return ''; } } };
}

const DAYS = [[1, 'Today (24h)'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year'], [0, 'All time']];
const BASE = { overview: '/myoffice/visitors', pages: '/myoffice/visitors/pages', previews: '/myoffice/visitors/previews', page: '/myoffice/visitors/page' };
const num = (n) => Number(n ?? 0).toLocaleString('en');
const pct = (n) => (n == null || !Number.isFinite(Number(n)) ? '' : `${Math.round(Number(n))}%`);

// The dedicated tracker log of one page (key = page_key, e.g. /p/<report id>). All time unless `days` is given.
export const pageLogUrl = (key, days = 0) => `${BASE.page}?${new URLSearchParams({ key, ...(days ? { days: String(days) } : {}) })}`;

// days: 0 = all time. filter: { page, ip, visitor, humans }. data depends on the view (see app.js adminVisitors).
export function visitorsPage({ view = 'overview', email, days, filter = {}, data, error, geoOn, tz = 'Asia/Kuala_Lumpur', before, pageInfo }) {
  const { at, tz: zone } = timeFmt(tz);
  // A link with some filters changed (null removes one). The page key only travels to the page log.
  const link = (change = {}, base = BASE[view]) => {
    const cur = { key: filter.page, days: days || 'all', ip: filter.ip, visitor: filter.visitor, humans: filter.humans ? '1' : null, ...change };
    if (base !== BASE.page) delete cur.key;
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) if (v != null && v !== '' && v !== false) q.set(k, String(v));
    return `${base}?${q}`;
  };
  const toPage = (key) => link({ key, ip: null, visitor: null, before: null }, BASE.page);

  const nav = `<nav class="tabs">${[['overview', 'Overview'], ['pages', 'Pages'], ['previews', 'Preview reports']]
    .map(([v, l]) => `<a href="${esc(link({ before: null, ip: null, visitor: null }, BASE[v]))}"${v === view ? ' class="on"' : ''}>${l}</a>`).join('')}</nav>`;
  const tabs = `<nav class="tabs">${DAYS.map(([d, l]) => `<a href="${esc(link({ days: d || 'all', before: null }))}"${d === days ? ' class="on"' : ''}>${l}</a>`).join('')}
<a href="${esc(link({ humans: filter.humans ? null : '1', before: null }))}"${filter.humans ? ' class="on"' : ''}>${filter.humans ? 'People only (bots hidden)' : 'Hide bots'}</a></nav>`;
  const chips = [['ip', 'IP'], ['visitor', 'Visitor']].filter(([k]) => filter[k])
    .map(([k, l]) => `<span class="chip">${l}: ${esc(filter[k])}<a href="${esc(link({ [k]: null, before: null }))}" title="Remove">×</a></span>`).join('');

  const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${label}</span></div>`;
  const kpis = (s = {}) => `<div class="kpis">
${kpi(num(s.views), 'Views')}${kpi(num(s.visitors), 'Visitors')}
${kpi(duration(s.avg_ms) || '–', 'Average time on page')}${kpi(duration(s.total_ms) || '–', 'Total time')}
${kpi(pct(s.avg_scroll) || '–', 'Average scroll depth')}${kpi(num(s.bots), 'Bot views (labelled)')}
${s.views ? kpi(`${Math.round((100 * (s.with_js ?? 0)) / s.views)}%`, 'Views where the time script ran') : ''}</div>`;

  const tops = (list) => `<div class="tops">${list.map(([g, title]) => {
    const rows = (data?.top?.[g] ?? []).map((r) => {
      const label = r.k == null || r.k === '' ? (g === 'referrer' ? '(direct / unknown)' : '(unknown)') : r.k;
      const k = g === 'page' && r.k ? `<a href="${esc(toPage(r.k))}">${esc(label)}</a>` : esc(label);
      return `<tr><td class="k">${k}</td><td class="n">${r.n}${r.avg_ms ? ` · ${duration(r.avg_ms)}` : ''}</td></tr>`;
    }).join('') || '<tr><td class="k">Nothing yet</td><td></td></tr>';
    return `<div class="top"><h3>${title}</h3><table>${rows}</table></div>`;
  }).join('')}</div>`;

  const place = (r) => [r.city, r.region, r.country_code || r.country].filter(Boolean).join(', ') || (geoOn ? 'Unknown location' : 'No location file');
  const logTable = (rows) => {
    const body = rows.map((r) => {
      const who = [
        r.ip ? `<a href="${esc(link({ ip: r.ip, before: null }))}">${esc(r.ip)}</a>` : '(no IP)',
        r.account_email ? ` <span class="badge me">${esc(r.account_email)}</span>` : '',
        r.is_bot ? ' <span class="badge bot">bot</span>' : '',
      ].join('');
      const visitor = r.visitor_id ? `<a class="sub" href="${esc(link({ visitor: r.visitor_id, before: null }))}">visitor ${esc(r.visitor_id)}</a>` : '';
      const device = `${esc(r.device ?? '')} · ${esc(r.os ?? '')}<span class="sub">${esc(r.browser ?? '')}${r.screen ? ` · ${esc(r.screen)}` : ''}${r.lang ? ` · ${esc(r.lang)}` : ''}</span>`;
      const time = r.js ? `${duration(r.active_ms) || '<1s'}${r.scroll_pct != null ? `<span class="sub">scrolled ${pct(r.scroll_pct)}</span>` : ''}`
        : '<span class="badge" title="The page was sent, but its script never reported back (blocked, a bot, closed at once, or a page sent exactly as stored)">no script</span>';
      const from = r.referrer_host || r.referrer
        ? `${esc(r.referrer_host ?? '')}${r.referrer ? `<span class="sub">${esc(r.referrer)}</span>` : ''}`
        : '<span class="sub">direct</span>';
      const status = r.status && r.status !== 200 ? ` <span class="badge" title="HTTP status of the page sent">${r.status === 404 ? '404 not ready / not found' : r.status}</span>` : '';
      const pageCell = view === 'page' ? '' : `<td class="p"><a href="${esc(toPage(r.page_key ?? r.path))}">${esc(r.path ?? '')}</a>${r.title ? `<span class="sub">${esc(r.title)}</span>` : ''}</td>`;
      return `<tr><td style="white-space:nowrap">${esc(at(r.created_at))}</td>
<td>${who}${visitor}<span class="sub">${esc(place(r))}${r.tz ? ` · ${esc(r.tz)}` : ''}</span></td>
<td>${device}</td>${pageCell}<td>${from}</td><td>${time}${status}</td></tr>`;
    }).join('');
    const more = rows.length >= 100 ? `<p class="more"><a class="btn quiet" href="${esc(link({ before: rows[rows.length - 1].id }))}">Older visits →</a></p>` : '';
    return rows.length
      ? `<div class="tbl"><table class="log"><thead><tr><th>Time (${esc(zone)})</th><th>Visitor · location</th><th>Device</th>${view === 'page' ? '' : '<th>Page</th>'}<th>Came from</th><th>Time · scroll</th></tr></thead><tbody>${body}</tbody></table></div>${more}`
      : '<p>No visits in this period yet.</p>';
  };
  const logSection = (rows) => `<h2>Visit log</h2>${before ? `<p><a href="${esc(link({ before: null }))}">← Newest</a></p>` : ''}${logTable(rows)}`;

  const pageRow = (p, extra = '') => `<tr><td class="p"><a href="${esc(toPage(p.page))}"><b>${esc(p.label ?? p.page)}</b></a><span class="sub">${esc(p.sub ?? p.title ?? '')}</span>${extra}</td>
<td>${num(p.views)}</td><td>${num(p.visitors)}</td><td>${duration(p.avg_ms) || '–'}</td><td>${duration(p.total_ms) || '–'}</td><td>${pct(p.avg_scroll) || '–'}</td>
<td style="white-space:nowrap">${p.last_at ? esc(at(p.last_at)) : '<span class="sub">never viewed</span>'}</td>
<td><a class="open" href="${esc(toPage(p.page))}">Tracker log</a></td></tr>`;
  const pageTable = (rows, first = 'Page') => `<div class="tbl"><table class="log"><thead><tr><th>${first}</th><th>Views</th><th>Visitors</th><th>Avg time</th><th>Total time</th><th>Avg scroll</th><th>Last view (${esc(zone)})</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;

  let title = 'Visitors';
  let body;
  if (!data) {
    body = `<p class="problem">The visit log could not be read just now: ${esc(error ?? 'no data')}. Refresh in a minute.</p>`;
  } else if (view === 'pages') {
    const list = data.pages ?? [];
    body = `<p>${list.length} pages viewed in this period, most viewed first. Each has its own tracker log.</p>
${list.length ? pageTable(list.map((p) => pageRow(p)).join('')) : '<p>No visits in this period yet.</p>'}`;
  } else if (view === 'previews') {
    title = 'Preview report visitors';
    const list = data.previews ?? [];
    const viewed = list.filter((p) => p.views).length;
    const problem = error ? `<p class="problem">The report list could not be read just now (${esc(error)}). The previews below come from the visit log only, so ones never viewed are missing.</p>` : '';
    body = `${problem}<p>${list.length} preview reports. ${viewed} viewed in this period. Each has its own tracker log, including the ones nobody has opened yet.</p>
${list.length ? pageTable(list.map((p) => pageRow(p, p.unknown ? ' <span class="badge">not in report database</span>' : '')).join(''), 'Preview report') : '<p>No preview reports yet.</p>'}`;
  } else if (view === 'page') {
    const info = pageInfo ?? {};
    title = info.company ? `${info.company}: tracker log` : 'Page tracker log';
    const s = data.summary ?? {};
    const people = (data.people ?? []).map((p) => `<tr>
<td>${p.visitor_id ? `<a href="${esc(link({ visitor: p.visitor_id, before: null }, BASE.overview))}" title="Every page this visitor opened">visitor ${esc(p.visitor_id)}</a>` : '<span class="sub">no visitor id (the script did not run)</span>'}${p.account_email ? ` <span class="badge me">${esc(p.account_email)}</span>` : ''}${p.is_bot ? ' <span class="badge bot">bot</span>' : ''}
<span class="sub">${esc(p.ips ?? '')}${p.place ? ` · ${esc(p.place)}` : ''}</span></td>
<td>${esc(p.device ?? '')} · ${esc(p.os ?? '')}<span class="sub">${esc(p.browser ?? '')}</span></td>
<td>${num(p.views)}</td><td>${duration(p.total_ms) || '–'}</td><td>${pct(p.max_scroll) || '–'}</td>
<td style="white-space:nowrap">${esc(at(p.first_at))}</td><td style="white-space:nowrap">${esc(at(p.last_at))}</td></tr>`).join('');
    const head = `<p class="pagehead"><b>${esc(filter.page)}</b>${info.sub ? ` · ${esc(info.sub)}` : ''} · <a href="${esc(filter.page)}" target="_blank" rel="noopener">Open the page</a>${info.note ? `<br><span class="small">${esc(info.note)}</span>` : ''}</p>`;
    body = before ? `${head}${logSection(data.rows ?? [])}` : `${head}${kpis(s)}
<p class="small">First view: ${esc(at(s.first_at)) || '–'} · Last view: ${esc(at(s.last_at)) || '–'}</p>
<h2>People who viewed it</h2>
${people ? `<div class="tbl"><table class="log"><thead><tr><th>Visitor · IP · location</th><th>Device</th><th>Views</th><th>Total time</th><th>Furthest scroll</th><th>First view</th><th>Last view</th></tr></thead><tbody>${people}</tbody></table></div>` : '<p>Nobody has viewed this page in this period.</p>'}
${tops([['referrer', 'Came from'], ['country', 'Countries'], ['city', 'Cities'], ['device', 'Devices'], ['browser', 'Browsers']])}
${logSection(data.rows ?? [])}`;
  } else {
    body = `${before ? '' : kpis(data.summary) + tops([['page', 'Pages'], ['referrer', 'Came from'], ['country', 'Countries'], ['city', 'Cities'], ['device', 'Devices'], ['os', 'Operating systems'], ['browser', 'Browsers']])}${logSection(data.rows ?? [])}`;
  }

  return page(title, `<h1>${esc(title)}</h1>
<p>Signed in as <b>${esc(email)}</b> · <a href="/myoffice/previews">Preview requests</a> · <a href="/myoffice/reports/previews">Reports</a> · <a href="/myoffice/users">Users</a> · <a href="/account">Dashboard</a></p>
${nav}${tabs}${chips ? `<div class="chips">${chips}</div>` : ''}${body}
<p class="small" style="margin-top:28px">Time on page counts only while the page is visible. Scroll depth is how far down the page the visitor got. Locations: <a href="https://db-ip.com">IP Geolocation by DB-IP</a>${geoOn ? '' : ' (location file not loaded on this server)'}.</p>`, { wide: true, css: CSS });
}
