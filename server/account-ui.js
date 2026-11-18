// The signed-in account area's frame, on the same sidebar theme as the office (office-shell.js sidebarPage): a dark
// sidebar with the account's sections (a Menu button on a phone), a page head, a notice line and the page's own content. Every /account page is drawn inside it, so a person always sees where
// they are and where else they can go. Pure rendering; app.js gathers the data.
//
//   Overview        /account
//   Free previews   /account/previews
//   Full reports    /account/reports
//   Referrals       /account/referrals/guide, /account/referrals (links and tracker), /account/referrals/earnings, /account/referrals/wallet

import { esc } from './pages.js';
import { DASHBOARD_CSS } from './dashboard-css.js';
import { sidebarPage } from './office-shell.js';

// The account's sections, in sidebar groups. `key` is what a page passes as `active`.
const GROUPS = [
  { group: 'My account', items: [
    { key: 'overview', href: '/account', label: 'Overview' },
    { key: 'previews', href: '/account/previews', label: 'Free previews', count: (n) => n.previews },
    { key: 'reports', href: '/account/reports', label: 'Full reports', count: (n) => n.reports },
  ] },
  { group: 'Report credits', items: [
    { key: 'credit-full', href: '/account/reports#credits', label: 'Full report credits', count: (n) => n.creditsFull },
    { key: 'credit-ads', href: '/account/reports#credits', label: 'Ads research credits', count: (n) => n.creditsAds },
  ] },
  { group: 'Referrals', items: [
    { key: 'guide', href: '/account/referrals/guide', label: 'Guide to referrers' },
    { key: 'links', href: '/account/referrals', label: 'Links and tracker' },
    { key: 'earnings', href: '/account/referrals/earnings', label: 'Earnings', note: (n) => (n.pendingCents ? `USD ${(n.pendingCents / 100).toFixed(n.pendingCents % 100 ? 2 : 0)}` : '') },
    { key: 'wallet', href: '/account/referrals/wallet', label: 'Payout wallet', dot: (n) => n.walletMissing },
  ] },
];

// The page head and notice inside the panel (the sidebar theme itself is office-shell.js SIDEBAR_CSS).
export const SHELL_CSS = `${DASHBOARD_CSS}
.ph { margin:0 0 26px; }
.ph h1 { margin:0 0 6px; font-size:clamp(26px,3.2vw,34px); }
.ph p { margin:0; max-width:62ch; }
.ofc-panel .notice { margin:0 0 22px; }`;

const safe = (fn, nav) => { try { return fn?.(nav); } catch { return null; } };

// d: { title, lede, active, email, nav, isAdmin, notice: { tone, text } | null, actions, body, css, refresh }
//   active: overview | previews | reports | guide | links | earnings | wallet
//   nav:    { previews, reports, creditsFull, creditsAds, pendingCents, walletMissing }  (small numbers for the sidebar; zero or missing is fine)
export function accountPage(d = {}) {
  const nav = d.nav ?? {};
  const n = d.notice;
  const groups = GROUPS.map((g) => ({ group: g.group, items: g.items.map((it) => {
    const count = safe(it.count, nav);
    return { href: it.href, label: it.label, on: it.key === d.active, count: count == null || count === '' ? null : count, countTone: 'quiet',
      note: safe(it.note, nav) || '', dot: Boolean(safe(it.dot, nav)), dotTitle: 'No wallet saved yet' };
  }) }));
  const here = GROUPS.flatMap((g) => g.items).find((it) => it.key === d.active);
  const crumbs = [{ label: 'My account', href: '/account' }];
  if (here && here.key !== 'overview') crumbs.push({ label: here.label });
  else crumbs.push({ label: 'Overview' });
  const foot = `<a href="/">MirrorMirror home</a>
<form method="post" action="/logout"><button type="submit">Sign out</button></form>`;
  const body = `<div class="ph"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap"><div><h1>${esc(d.title)}</h1>${d.lede ? `<p>${d.lede}</p>` : ''}</div>${d.actions ? `<div class="acts">${d.actions}</div>` : ''}</div></div>
${n ? `<p class="notice ${n.tone === 'ok' ? '' : esc(n.tone)}" role="status">${esc(n.text)}</p>` : ''}
${d.body ?? ''}`;
  return sidebarPage(d.title, body, { tag: 'Account', home: '/account', navLabel: 'Account', groups, crumbs, email: d.email, foot,
    css: `${SHELL_CSS}\n${d.css ?? ''}`, refresh: d.refresh });
}
