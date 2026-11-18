// The one sidebar layout of the site's signed-in areas (owner, 2026-11-18: "one proper admin dashboard", then "apply this
// theme to the account dashboard too"). Two areas use it:
//   - the team office, /myoffice: officePage() below
//   - a customer's account, /account: accountPage() in account-ui.js
// A fixed dark sidebar with the area's sections in groups, the current one marked; a top bar with where you are and who
// is signed in; the page's own content in a white panel. On a phone the sidebar folds into a Menu button. No script.
//
// Pure and crash-proof: odd or missing options only drop that detail (a count, the email); the page always renders.

import { page, esc } from './pages.js';

export const SIDEBAR_CSS = `
body { background:#f4f5f7; }
main { width:auto; max-width:none; margin:0; padding:0; background:none; border:0; border-radius:0; }
.ofc { display:grid; grid-template-columns:248px minmax(0,1fr); min-height:100vh; }
.ofc-side { position:sticky; top:0; height:100vh; overflow-y:auto; background:#111418; color:#c9cdd3; display:flex; flex-direction:column; padding:20px 12px 16px; }
.ofc-brand { display:block; padding:2px 10px 4px; text-decoration:none; }
.ofc-brand img { display:block; height:22px; width:auto; }
.ofc-brand span { display:inline-block; margin-top:8px; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#111418; background:#f3f4f6; border-radius:4px; padding:2px 7px; }
.ofc-menu { display:none; }
.ofc-nav { margin-top:10px; }
.ofc-group { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; color:#7d848e; padding:16px 10px 6px; }
.ofc-nav a { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; margin:1px 0; border-radius:8px; color:#d5d8dd; text-decoration:none; font-size:14.5px; font-weight:500; line-height:1.3; }
.ofc-nav a:hover { background:#1e242b; color:#fff; }
.ofc-nav a.on { background:#fff; color:#111418; font-weight:600; }
.ofc-nav a:focus-visible, .ofc-foot a:focus-visible, .ofc-foot button:focus-visible { outline:2px solid #fff; outline-offset:2px; }
.ofc-sub { margin:2px 0 6px; }
.ofc-sub a { padding:6px 10px 6px 24px; font-size:13.5px; color:#aab0b8; position:relative; }
.ofc-sub a::before { content:""; position:absolute; left:12px; top:50%; width:5px; height:5px; margin-top:-2.5px; border-radius:50%; background:#4a515a; }
.ofc-nav .ofc-sub a.on { background:#262d35; color:#fff; }
.ofc-nav .ofc-sub a.on::before { background:#fff; }
.ofc-count { font-size:11.5px; font-weight:700; background:#2f6fed; color:#fff; border-radius:99px; padding:1px 8px; line-height:1.5; }
.ofc-count.quiet { background:#2a3037; color:#d5d8dd; }
.ofc-nav a.on .ofc-count.quiet { background:#e6e8eb; color:#111418; }
.ofc-note { font-size:12px; font-weight:600; color:#7ee2a8; white-space:nowrap; }
.ofc-nav a.on .ofc-note { color:var(--good); }
.ofc-dot { width:9px; height:9px; border-radius:50%; background:#e8963c; flex:none; }
.ofc-foot { margin-top:auto; padding:16px 10px 0; border-top:1px solid #262c33; font-size:13px; }
.ofc-foot .who { color:#8b929b; margin:0 0 10px; overflow-wrap:anywhere; }
.ofc-foot .who b { display:block; color:#e6e8eb; font-weight:600; }
.ofc-foot a, .ofc-foot button { display:block; width:100%; text-align:left; font:inherit; font-size:13.5px; color:#c9cdd3; background:none; border:0; padding:6px 0; cursor:pointer; text-decoration:none; }
.ofc-foot a:hover, .ofc-foot button:hover { color:#fff; }
.ofc-main { min-width:0; display:flex; flex-direction:column; }
.ofc-top { position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 32px; background:rgba(244,245,247,.92); backdrop-filter:blur(6px); border-bottom:1px solid var(--line); font-size:14px; color:var(--grey); }
.ofc-top .crumb a { color:var(--grey); text-decoration:none; }
.ofc-top .crumb a:hover { color:var(--ink); }
.ofc-top .crumb b { color:var(--ink); }
.ofc-top .me { overflow-wrap:anywhere; text-align:right; }
.ofc-body { padding:24px 32px 64px; width:100%; max-width:1320px; }
.ofc-panel { background:#fff; border:1px solid var(--line); border-radius:14px; padding:28px 32px 32px; }
.ofc-panel > h1:first-child, .ofc-panel > .top:first-child h1 { margin-top:0; }
@media (max-width:900px) {
  .ofc { grid-template-columns:1fr; }
  .ofc-side { position:sticky; top:0; z-index:10; height:auto; max-height:100vh; padding:12px 16px; }
  .ofc-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .ofc-brand { padding:0; display:flex; align-items:center; gap:10px; }
  .ofc-brand span { margin-top:0; }
  .ofc-menu { display:inline-block; font-size:14px; font-weight:600; color:#fff; border:1px solid #3a414a; border-radius:8px; padding:6px 12px; cursor:pointer; }
  .ofc-nav, .ofc-foot { display:none; }
  #ofc-menu:checked ~ .ofc-nav, #ofc-menu:checked ~ .ofc-foot { display:block; }
  #ofc-menu:checked ~ .ofc-foot { padding-bottom:6px; }
  .ofc-top { display:none; }
  .ofc-body { padding:16px 12px 48px; }
  .ofc-panel { padding:20px 16px 24px; }
}`;

const countHtml = (count, tone) => {
  if (count == null || count === '' || count === 0 || count === '0') return '';
  const n = Number(count);
  const shown = Number.isFinite(n) && n > 999 ? '999+' : String(count);
  return `<span class="ofc-count${tone === 'quiet' ? ' quiet' : ''}">${esc(shown)}</span>`;
};

// One sidebar link. item: { href, label, on, count, countTone: 'quiet' | (blue), note, dot, dotTitle, sub: [{ href, label, on }] }
function itemHtml(it) {
  if (!it?.href) return '';
  const extra = `${countHtml(it.count, it.countTone)}${it.note ? `<span class="ofc-note">${esc(it.note)}</span>` : ''}${it.dot ? `<span class="ofc-dot" title="${esc(it.dotTitle ?? '')}" aria-label="${esc(it.dotTitle ?? '')}"></span>` : ''}`;
  const sub = it.on && Array.isArray(it.sub) && it.sub.length
    ? `<div class="ofc-sub">${it.sub.map((s) => `<a href="${esc(s.href)}"${s.on ? ' class="on"' : ''}>${esc(s.label)}</a>`).join('')}</div>` : '';
  return `<a href="${esc(it.href)}"${it.on ? ' class="on" aria-current="page"' : ''}><span>${esc(it.label)}</span>${extra}</a>${sub}`;
}

// The shared layout.
// tag: the label under the logo ("Office", "Account"). home: where the logo goes. navLabel: the nav's accessible name.
// groups: [{ group, items: [item] }]. crumbs: [{ label, href? }] (the last one is where you are). email: who is signed in.
// foot: the sidebar's bottom links, as HTML. css, refresh: as page().
export function sidebarPage(title, body, { tag = '', home = '/', navLabel = 'Sections', groups = [], crumbs = [], email = '', foot = '', css = '', refresh } = {}) {
  const nav = (Array.isArray(groups) ? groups : []).map((g) => `${g?.group ? `<div class="ofc-group">${esc(g.group)}</div>` : ''}${(g?.items ?? []).map(itemHtml).join('')}`).join('');
  const crumb = (Array.isArray(crumbs) ? crumbs : []).filter((c) => c?.label)
    .map((c, i, all) => (i < all.length - 1 && c.href ? `<a href="${esc(c.href)}">${esc(c.label)}</a>` : `<b>${esc(c.label)}</b>`))
    .join(' <span aria-hidden="true">/</span> ');
  const shell = `<div class="ofc">
<aside class="ofc-side">
<input type="checkbox" id="ofc-menu" hidden>
<div class="ofc-head"><a class="ofc-brand" href="${esc(home)}"><img src="/assets/logo/mirrormirror-logo-dark.svg" width="333" height="56" alt="MirrorMirror">${tag ? `<span>${esc(tag)}</span>` : ''}</a><label class="ofc-menu" for="ofc-menu">Menu</label></div>
<nav class="ofc-nav" aria-label="${esc(navLabel)}">${nav}</nav>
<div class="ofc-foot">
${email ? `<p class="who">Signed in as <b>${esc(email)}</b></p>` : ''}
${foot}
</div>
</aside>
<div class="ofc-main">
<div class="ofc-top"><div class="crumb">${crumb}</div>${email ? `<div class="me">${esc(email)}</div>` : ''}</div>
<div class="ofc-body"><div class="ofc-panel">
${body}
</div></div>
</div>
</div>`;
  return page(title, shell, { noHeader: true, footer: false, refresh, css: `${css ?? ''}\n${SIDEBAR_CSS}` });
}

// ---- The team office (/myoffice) ----

// A section is "on" when the path is its href or below it. Add a section here and it appears on every office page.
const OFFICE_NAV = [
  { group: 'Overview', items: [
    { href: '/myoffice', label: 'Dashboard', exact: true },
  ] },
  { group: 'Work', items: [
    { href: '/myoffice/previews', label: 'Preview requests', badge: 'previews' },
    { href: '/myoffice/reports', label: 'Reports', sub: [['/myoffice/reports/previews', 'Free previews'], ['/myoffice/reports/full', 'Full reports']] },
    { href: '/myoffice/mail', label: 'Mailbox', badge: 'mail' },
  ] },
  { group: 'People', items: [
    { href: '/myoffice/users', label: 'Users' },
    { href: '/myoffice/visitors', label: 'Visitors', sub: [['/myoffice/visitors', 'Overview'], ['/myoffice/visitors/pages', 'Pages'], ['/myoffice/visitors/previews', 'Preview reports']] },
    { href: '/myoffice/referrals', label: 'Referral payouts' },
  ] },
];

const under = (path, href, exact) => path === href || (!exact && path.startsWith(`${href}/`));

// title: the browser tab title. body: the page's own HTML (starts with its <h1>).
// on: the current path (marks the sidebar). email: who is signed in. badges: { mail, previews } counts for the sidebar.
// crumb: optional extra step after the section in the top bar (e.g. a message subject). css, refresh: as page().
export function officePage(title, body, { on = '/myoffice', email = '', badges = {}, crumb = '', css = '', refresh } = {}) {
  const path = typeof on === 'string' ? on : '/myoffice';
  const groups = OFFICE_NAV.map((g) => ({ group: g.group, items: g.items.map((it) => {
    const n = Number(badges?.[it.badge]);
    return { href: it.href, label: it.label, on: under(path, it.href, it.exact), count: Number.isFinite(n) && n > 0 ? n : null,
      sub: it.sub?.map(([href, label]) => ({ href, label, on: path === href })) };
  }) }));
  const section = OFFICE_NAV.flatMap((g) => g.items).find((it) => under(path, it.href, it.exact));
  const crumbs = [{ label: 'Office', href: '/myoffice' }];
  if (section && section.href !== '/myoffice') crumbs.push({ label: section.label, href: section.href });
  else if (section) crumbs.push({ label: section.label });
  if (crumb) crumbs.push({ label: crumb });
  const foot = `<a href="/account">Customer view ↗</a>
<a href="/" target="_blank" rel="noopener">Public site ↗</a>
<form method="post" action="/myoffice/logout"><button type="submit">Sign out of the office</button></form>`;
  return sidebarPage(title, body, { tag: 'Office', home: '/myoffice', navLabel: 'Office', groups, crumbs, email, foot, css, refresh });
}
