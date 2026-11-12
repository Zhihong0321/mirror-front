// Team pages for accounts (an account is an email address that signed in by emailed link):
//   /myoffice/users                 every account: signup, last sign-in, previews, orders, money, visits
//   /myoffice/users/one?email=      one account: its previews, orders, emails sent and every visit (also before sign-in)
// Read only. A part that cannot be read is shown as a problem on the page; the rest still shows.

import { page, esc } from './pages.js';
import { duration, pageLogUrl } from './visitors-page.js';

const CSS = `
.tbl { width:100%; overflow-x:auto; margin:0 0 26px; }
table.t { width:100%; border-collapse:collapse; font-size:14px; min-width:760px; }
table.t th { text-align:left; font-size:12px; color:var(--grey); font-weight:600; padding:0 10px 8px 0; white-space:nowrap; }
table.t td { padding:9px 10px 9px 0; border-top:1px solid var(--line); vertical-align:top; }
table.t a { color:var(--ink); }
.sub { display:block; font-size:12px; color:var(--grey); overflow-wrap:anywhere; }
.badge { display:inline-block; font-size:12px; font-weight:600; padding:1px 8px; border-radius:99px; background:var(--band); color:var(--grey); white-space:nowrap; }
.badge.ok { background:var(--good-bg); color:var(--good); }
.badge.bad { background:#fdecea; color:var(--wrong); }
.badge.wait { background:#fdf3e2; color:#a15c07; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin:0 0 24px; }
.kpi { border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
.kpi b { display:block; font-family:var(--display); font-size:24px; letter-spacing:-0.02em; color:var(--ink); line-height:1.15; overflow-wrap:anywhere; }
.kpi span { font-size:13px; color:var(--grey); }
h2 { font-family:var(--display); font-size:22px; margin:26px 0 10px; letter-spacing:-0.02em; }
form.search { display:flex; gap:8px; margin:0 0 18px; max-width:520px; }
form.search input { margin:0; }
form.search .btn { padding:10px 16px; font-size:15px; }
.problem { background:#fdecea; color:var(--wrong); padding:12px 14px; border-radius:10px; }`;

function timeFmt(tz) {
  const opts = { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  let f;
  try { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }); } catch { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }); tz = 'UTC'; }
  return { tz, at: (t) => { try { return t ? f.format(new Date(Number(t))) : ''; } catch { return ''; } } };
}
const money = (cents, cur) => (cents ? `${String(cur ?? '').toUpperCase()} ${(Number(cents) / 100).toFixed(Number(cents) % 100 ? 2 : 0)}`.trim() : '');
const num = (n) => Number(n ?? 0).toLocaleString('en');
export const userUrl = (email) => `/myoffice/users/one?${new URLSearchParams({ email })}`;

const head = (email, title) => `<h1>${esc(title)}</h1>
<p>Signed in as <b>${esc(email)}</b> · <a href="/myoffice/users">Users</a> · <a href="/myoffice/previews">Preview requests</a> · <a href="/myoffice/reports/previews">Reports</a> · <a href="/myoffice/visitors">Visitors</a> · <a href="/account">Dashboard</a></p>`;

// users: from store.allUsers(). q: the search text (already applied by the caller).
export function usersListPage({ email, users = [], total = 0, q = '', error = null, tz }) {
  const { at, tz: zone } = timeFmt(tz);
  const rows = users.map((u) => `<tr>
<td><a href="${esc(userUrl(u.email))}"><b>${esc(u.email)}</b></a></td>
<td style="white-space:nowrap">${esc(at(u.created_at))}</td>
<td style="white-space:nowrap">${esc(at(u.last_login_at)) || '–'}</td>
<td>${num(u.previews)}${u.open_previews ? ` <span class="badge wait">${u.open_previews} waiting</span>` : ''}</td>
<td>${num(u.orders)}${u.paid_cents ? `<span class="sub">${esc(money(u.paid_cents, u.currency))}</span>` : ''}</td>
<td>${num(u.views)}${u.last_seen_at ? `<span class="sub">last ${esc(at(u.last_seen_at))}</span>` : ''}</td></tr>`).join('');
  const body = error
    ? `<p class="problem">The account list could not be read just now: ${esc(error)}. Refresh in a minute.</p>`
    : rows
      ? `<div class="tbl"><table class="t"><thead><tr><th>Email</th><th>Signed up (${esc(zone)})</th><th>Last sign-in</th><th>Previews</th><th>Orders</th><th>Page views signed in</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p>${q ? 'No account matches that search.' : 'No accounts yet.'}</p>`;
  return page('Users', `${head(email, 'Users')}
<p>${num(total)} accounts${q ? `, ${num(users.length)} matching “${esc(q)}”` : ''}, most recently active first. An account is an email address that signed in by emailed link.</p>
<form class="search" method="get" action="/myoffice/users"><input type="text" name="q" value="${esc(q)}" placeholder="Search by email"><button class="btn" type="submit">Search</button>${q ? ' <a class="btn quiet" href="/myoffice/users">Clear</a>' : ''}</form>
${body}`, { wide: true, css: CSS });
}

// d: { user, previews, orders, mail, sessions, visits: { summary, rows, visitorIds } }. problems: list of messages.
export function userPage({ email, who, d = {}, problems = [], tz }) {
  const { at, tz: zone } = timeFmt(tz);
  const u = d.user;
  const vs = d.visits?.summary ?? {};
  const paid = (d.orders ?? []).reduce((n, o) => n + (Number(o.amount_cents) || 0), 0);
  const cur = d.orders?.[0]?.currency;
  const kpis = `<div class="kpis">
<div class="kpi"><b>${esc(at(u?.created_at)) || '–'}</b><span>Signed up (${esc(zone)})</span></div>
<div class="kpi"><b>${esc(at(u?.last_login_at)) || '–'}</b><span>Last sign-in</span></div>
<div class="kpi"><b>${num(d.previews?.length)}</b><span>Preview requests</span></div>
<div class="kpi"><b>${num(d.orders?.length)}</b><span>Orders${paid ? ` · ${esc(money(paid, cur))}` : ''}</span></div>
<div class="kpi"><b>${num(vs.views)}</b><span>Page views</span></div>
<div class="kpi"><b>${duration(vs.total_ms) || '–'}</b><span>Total time on site</span></div>
<div class="kpi"><b>${num(d.sessions)}</b><span>Signed-in devices now</span></div></div>`;

  const status = (p) => (p.status === 'ready' ? `<span class="badge ok">Ready</span>${p.ready_emailed_at ? '' : ' <span class="badge bad">not emailed</span>'}` : `<span class="badge wait">${esc(p.status)}</span>`);
  const previews = (d.previews ?? []).map((p) => `<tr>
<td><b>${esc(p.company)}</b><span class="sub">${esc([p.who, p.country, p.website].filter(Boolean).join(' · '))}</span></td>
<td style="white-space:nowrap">${esc(at(p.created_at))}</td><td>${status(p)}</td>
<td>${p.report_id ? `<a href="/p/${esc(p.report_id)}" target="_blank" rel="noopener">Open preview</a><span class="sub"><a href="${esc(pageLogUrl(`/p/${p.report_id}`))}">Tracker log</a></span>` : '<span class="sub">no report yet</span>'}</td></tr>`).join('');
  const orders = (d.orders ?? []).map((o) => `<tr>
<td><b>${esc(o.company ?? '(no company)')}</b><span class="sub">${esc(o.invoice_no ?? '')}</span></td>
<td style="white-space:nowrap">${esc(at(o.paid_at))}</td><td>${esc(money(o.amount_cents, o.currency))}</td>
<td>${o.invoice_emailed_at ? '<span class="badge ok">Invoice emailed</span>' : '<span class="badge bad">Invoice not emailed</span>'}</td>
<td>${o.report_id ? `<a href="/r/${esc(o.report_id)}" target="_blank" rel="noopener">Open report</a><span class="sub"><a href="${esc(pageLogUrl(`/r/${o.report_id}`))}">Tracker log</a></span>` : o.report_url ? `<a href="${esc(o.report_url)}" target="_blank" rel="noopener">Open report</a>` : ''}</td></tr>`).join('');
  const mail = (d.mail ?? []).map((m) => `<tr><td style="white-space:nowrap">${esc(at(m.created_at))}</td><td>${esc(m.kind)}</td><td>${esc(m.subject ?? '')}</td>
<td>${m.status === 'sent' ? '<span class="badge ok">sent</span>' : `<span class="badge${m.status === 'failed' ? ' bad' : ''}">${esc(m.status)}</span>`}${m.error ? `<span class="sub">${esc(m.error)}</span>` : ''}</td></tr>`).join('');
  const visits = (d.visits?.rows ?? []).map((r) => `<tr><td style="white-space:nowrap">${esc(at(r.created_at))}</td>
<td style="overflow-wrap:anywhere"><a href="${esc(pageLogUrl(r.page_key ?? r.path ?? '/'))}">${esc(r.path ?? '')}</a>${r.title ? `<span class="sub">${esc(r.title)}</span>` : ''}</td>
<td>${esc(r.ip ?? '')}<span class="sub">${esc([r.city, r.country_code].filter(Boolean).join(', '))}</span></td>
<td>${esc(r.device ?? '')} · ${esc(r.os ?? '')}<span class="sub">${esc(r.browser ?? '')}</span></td>
<td>${r.account_email ? '<span class="badge ok">signed in</span>' : '<span class="badge">before sign-in</span>'}</td>
<td>${r.js ? `${duration(r.active_ms) || '<1s'}${r.scroll_pct != null ? `<span class="sub">scrolled ${Math.round(r.scroll_pct)}%</span>` : ''}` : '<span class="badge">no script</span>'}</td></tr>`).join('');
  const browsers = (d.visits?.visitorIds ?? []).map((id) => `<a href="/myoffice/visitors?${esc(new URLSearchParams({ visitor: id, days: 'all' }))}">visitor ${esc(id)}</a>`).join(' · ');

  const table = (cols, rows, empty) => (rows ? `<div class="tbl"><table class="t"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>` : `<p>${empty}</p>`);
  return page(`User ${who}`, `${head(email, who)}
${!u ? '<p class="problem">This email has no account (it never signed in). Anything below is still shown.</p>' : ''}
${problems.map((p) => `<p class="problem">${esc(p)}</p>`).join('')}
${kpis}
<h2>Preview requests</h2>${table(['Company', 'Asked', 'Status', 'Preview'], previews, 'No preview requests.')}
<h2>Orders</h2>${table(['Company · invoice', 'Paid', 'Amount', 'Invoice', 'Report'], orders, 'No orders.')}
<h2>Visits</h2>
<p class="small">Pages this person opened while signed in, plus every page from the same browser${(d.visits?.visitorIds ?? []).length === 1 ? '' : 's'}, including before they signed in.${browsers ? ` Browsers: ${browsers}` : ''}</p>
${table(['Time', 'Page', 'IP · location', 'Device', '', 'Time · scroll'], visits, 'No visits recorded.')}
${(d.visits?.rows ?? []).length >= 200 ? '<p class="small">Showing the newest 200 visits.</p>' : ''}
<h2>Emails sent to them</h2>${table(['Time', 'Kind', 'Subject', 'Result'], mail, 'No emails.')}`, { wide: true, css: CSS });
}
