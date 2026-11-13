// The signed-in account area's frame: a sidebar with the account's sections (a tab bar on a phone), a page head,
// a notice line and the page's own content. Every /account page is drawn inside it, so a person always sees where
// they are and where else they can go. Pure rendering; app.js gathers the data.
//
//   Overview        /account
//   Free previews   /account/previews
//   Full reports    /account/reports
//   Referrals       /account/referrals (links and tracker), /account/referrals/earnings, /account/referrals/wallet

import { page, esc } from './pages.js';
import { DASHBOARD_CSS } from './dashboard-css.js';

const ico = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  home: ico('<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z"/>'),
  preview: ico('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  report: ico('<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5V8h4M9.5 12.5h5M9.5 16h5"/>'),
  link: ico('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  coins: ico('<circle cx="9" cy="9" r="5"/><path d="M14.5 8.2A5 5 0 1 1 9.8 14"/>'),
  wallet: ico('<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H18v3"/><path d="M4 7.5V18a1.5 1.5 0 0 0 1.5 1.5H19a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H5.5A1.5 1.5 0 0 1 4 7.5z"/><circle cx="16" cy="14" r="1" fill="currentColor"/>'),
  office: ico('<path d="M4 20V6l8-3 8 3v14M4 20h16M9 20v-5h6v5M8.5 9.5h1M14.5 9.5h1M8.5 12.5h1M14.5 12.5h1"/>'),
};

const SECTIONS = [
  { key: 'overview', href: '/account', label: 'Overview', icon: 'home' },
  { key: 'previews', href: '/account/previews', label: 'Free previews', icon: 'preview', count: (n) => n.previews },
  { key: 'reports', href: '/account/reports', label: 'Full reports', icon: 'report', count: (n) => n.reports },
];
const REFERRAL = [
  { key: 'links', href: '/account/referrals', label: 'Links and tracker', icon: 'link' },
  { key: 'earnings', href: '/account/referrals/earnings', label: 'Earnings', icon: 'coins', note: (n) => (n.pendingCents ? `USD ${(n.pendingCents / 100).toFixed(n.pendingCents % 100 ? 2 : 0)}` : '') },
  { key: 'wallet', href: '/account/referrals/wallet', label: 'Payout wallet', icon: 'wallet', dot: (n) => n.walletMissing },
];

export const SHELL_CSS = `${DASHBOARD_CSS}
body { background:#fff; }
main { max-width:none; width:100%; margin:0; padding:0; border:0; background:none; border-radius:0; }
.app { min-height:100vh; padding-left:268px; }
.side { background:var(--band); border-right:1px solid var(--line); padding:22px 14px 18px; display:flex; flex-direction:column; gap:14px; position:fixed; top:0; left:0; bottom:0; width:268px; z-index:10; height:100vh; overflow-y:auto; }
.side .logo { display:inline-block; padding:0 10px 6px; }
.side .logo img { display:block; height:26px; width:auto; }
.side nav { display:flex; flex-direction:column; gap:2px; }
.side .grp { font:600 13px var(--body); color:var(--grey); padding:18px 12px 6px; }
.side a.nv { display:flex; align-items:center; gap:11px; padding:9px 12px; border-radius:9px; color:var(--ink); text-decoration:none; font-size:15px; font-weight:500; line-height:1.3; }
.side a.nv:hover { background:#e6e8eb; }
.side a.nv[aria-current="page"] { background:var(--ink); color:#fff; }
.side a.nv svg { flex:none; opacity:.75; }
.side a.nv.noico { padding-left:41px; }
.side a.nv[aria-current="page"] svg { opacity:1; }
.side a.nv:focus-visible, .side .who a:focus-visible, .side .who button:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
.side .ct { margin-left:auto; font-size:12px; font-weight:600; min-width:22px; text-align:center; padding:1px 7px; border-radius:99px; background:#e0e3e7; color:var(--ink); }
.side a[aria-current="page"] .ct { background:rgba(255,255,255,.2); color:#fff; }
.side .nt { margin-left:auto; font-size:12px; font-weight:600; color:var(--good); }
.side a[aria-current="page"] .nt { color:#b7f0d2; }
.side .dot { margin-left:auto; width:9px; height:9px; border-radius:50%; background:#d9822b; }
.side .who { margin-top:auto; border-top:1px solid #dcdfe3; padding:14px 10px 0; font-size:13px; color:var(--grey); display:flex; flex-direction:column; gap:6px; }
.side .who b { color:var(--ink); font-weight:600; overflow-wrap:anywhere; }
.side .who form { margin:0; }
.side .who button { font:inherit; font-size:13px; font-weight:600; color:var(--ink); background:none; border:0; padding:0; cursor:pointer; text-decoration:underline; }
.main { padding:42px clamp(20px,4vw,60px) 80px; max-width:1060px; width:100%; }
.ph { margin:0 0 26px; }
.ph h1 { margin:0 0 6px; font-size:clamp(26px,3.2vw,34px); }
.ph p { margin:0; max-width:62ch; }
.main .notice { margin:0 0 22px; }
@media (max-width:860px) {
  .app { padding-left:0; }
  .side, .main { min-width:0; }
  .side { position:static; width:auto; height:auto; border-right:0; border-bottom:1px solid var(--line); padding:12px 12px 10px; gap:8px; overflow:visible; }
  .side nav { flex-direction:row; overflow-x:auto; gap:6px; padding-bottom:4px; -webkit-overflow-scrolling:touch; }
  .side .grp { display:none; }
  .side a.nv { white-space:nowrap; padding:8px 12px; background:#fff; border:1px solid var(--line); }
  .side a.nv[aria-current="page"] { border-color:var(--ink); }
  .side a.nv svg { display:none; }
  .side a.nv.noico { padding-left:12px; }
  .side .who { flex-direction:row; flex-wrap:wrap; gap:4px 14px; border-top:0; padding:0 4px; margin-top:0; font-size:12px; }
  .main { padding:26px 16px 56px; }
}
`;

const link = (s, active, nav) => `<a class="nv" href="${s.href}"${s.key === active ? ' aria-current="page"' : ''}>${ICON[s.icon]}<span>${esc(s.label)}</span>${s.count && s.count(nav) ? `<span class="ct">${esc(s.count(nav))}</span>` : ''}${s.note?.(nav) ? `<span class="nt">${esc(s.note(nav))}</span>` : ''}${s.dot?.(nav) ? '<span class="dot" title="No wallet saved yet" aria-label="No wallet saved yet"></span>' : ''}</a>`;

// d: { title, lede, active, email, nav, isAdmin, notice: { tone, text } | null, actions, body, css }
//   active: overview | previews | reports | links | earnings | wallet
//   nav:    { previews, reports, pendingCents, walletMissing }  (small numbers for the sidebar; zero or missing is fine)
export function accountPage(d) {
  const nav = d.nav ?? {};
  const n = d.notice;
  const body = `<div class="app">
<aside class="side">
<a class="logo" href="/"><img src="/assets/logo/mirrormirror-logo.svg" width="333" height="56" alt="MirrorMirror"></a>
<nav aria-label="Account">
${SECTIONS.map((s) => link(s, d.active, nav)).join('\n')}
<div class="grp">Referrals</div>
${REFERRAL.map((s) => link(s, d.active, nav)).join('\n')}
${d.isAdmin ? `<div class="grp">Team</div>
<a class="nv" href="/myoffice/previews">${ICON.office}<span>Preview requests</span></a>
<a class="nv noico" href="/myoffice/users"><span>Users</span></a>
<a class="nv noico" href="/myoffice/visitors"><span>Visitors</span></a>
<a class="nv noico" href="/myoffice/referrals"><span>Referral payouts</span></a>` : ''}
</nav>
<div class="who"><span>Signed in as <b>${esc(d.email)}</b></span><form method="post" action="/logout"><button type="submit">Sign out</button></form></div>
</aside>
<div class="main">
<div class="ph"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap"><div><h1>${esc(d.title)}</h1>${d.lede ? `<p>${d.lede}</p>` : ''}</div>${d.actions ? `<div class="acts">${d.actions}</div>` : ''}</div></div>
${n ? `<p class="notice ${n.tone === 'ok' ? '' : esc(n.tone)}" role="status">${esc(n.text)}</p>` : ''}
${d.body}
</div>
</div>`;
  return page(d.title, body, { noHeader: true, bare: true, css: `${SHELL_CSS}\n${d.css ?? ''}` });
}
