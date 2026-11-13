// The standard footer and the legal pages. One source for every surface: the server pages (pages.js), the
// emails (emails.js), the report preview (preview-template/page.js), the report frame (report-pages.js).
// The static homepage (site/index.html) cannot import this: keep its footer links in step by hand (docs/legal-footer.md).
//
// The legal text is in server/legal/*.md. Those are DRAFTS until a lawyer has read them. Details that are not
// known yet are filled from settings (below); anything still missing shows as "to be confirmed", and the page says
// it is still being filled in. Nothing here hides or blocks a page because a detail is missing.
//
// Pure functions. No imports from pages.js (pages.js imports this).

import { readFileSync } from 'node:fs';

export const SITE = 'https://mirrormirror.cloud';
export const CONTACT = { hello: 'hello@mirrormirror.cloud', corrections: 'corrections@mirrormirror.cloud', privacy: 'privacy@mirrormirror.cloud' };

export const LEGAL_PAGES = [
  { path: '/legal', file: 'legal-notice.md', title: 'Legal notice' },
  { path: '/terms', file: 'terms.md', title: 'Terms of use and sale' },
  { path: '/privacy', file: 'privacy.md', title: 'Privacy notice' },
  { path: '/disclaimer', file: 'disclaimer.md', title: 'Disclaimer' },
  { path: '/corrections', file: 'corrections.md', title: 'Corrections and removal' },
];
export const FOOTER_LEGAL_LINKS = [['/legal', 'Legal notice'], ['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/disclaimer', 'Disclaimer'], ['/corrections', 'Corrections']];

// The short notice that goes under every preview, report, page and email (from legal/disclaimer.md).
export const SHORT_DISCLAIMER = 'Built only from free public sources as at the date shown, using AI and best-effort analysis. Not professional advice; warning signs are flags, not accusations.';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Settings. LEGAL_OPERATOR_NAME, LEGAL_SSM_NO, LEGAL_ADDRESS, LEGAL_TAX, LEGAL_UPDATED fill the legal pages;
export function legalConfig(env = process.env) {
  const v = (k) => String(env[k] ?? '').trim();
  return { operator: v('LEGAL_OPERATOR_NAME'), ssm: v('LEGAL_SSM_NO'), address: v('LEGAL_ADDRESS'), tax: v('LEGAL_TAX'), updated: v('LEGAL_UPDATED') };
}

// ---- The footer ----

export const FOOTER_CSS = `
.sitefoot { width:calc(100% - 32px); max-width:980px; margin:0 auto; padding:8px 0 48px; /* same box as <main>, so the footer lines up with the cards above it */ color:var(--grey); font-size:14px; line-height:1.55; }
.sitefoot a { color:var(--ink); text-decoration:none; }
.sitefoot a:hover { text-decoration:underline; }
.sf-card { background:var(--paper); border:1px solid var(--line); border-radius:14px; padding:28px clamp(20px,3vw,32px); }
.sf-top { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,.9fr) minmax(0,.9fr) minmax(0,1.5fr); gap:28px; }
.sf-top b { display:block; font-size:13px; letter-spacing:.04em; text-transform:uppercase; color:var(--ink); margin-bottom:8px; }
.sf-top nav a, .sf-top .c a { display:block; padding:3px 0; color:var(--grey); }
.sf-top nav a:hover, .sf-top .c a:hover { color:var(--ink); }
.sf-brand .name { font-family:var(--display); font-weight:600; font-size:20px; letter-spacing:-0.02em; color:var(--ink); display:inline-block; margin-bottom:6px; }
.sf-brand p { margin:0; color:var(--grey); max-width:34ch; }
.sf-notice { margin-top:24px; padding-top:20px; border-top:1px solid var(--line); display:grid; gap:8px; }
.sf-notice p { margin:0; color:var(--grey); font-size:13px; }
.sf-notice b { color:var(--ink); }
.sf-notice a { text-decoration:underline; }
.sf-last { margin-top:16px; font-size:13px; color:var(--grey); display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
@media (max-width:760px) { .sf-top { grid-template-columns:1fr 1fr; gap:22px 14px; } .sf-top > * { min-width:0; overflow-wrap:anywhere; } .sf-brand { grid-column:1 / -1; } }
@media print { .sitefoot { display:none; } }
`;

export function siteFooter(cfg = legalConfig(), year = new Date().getFullYear()) {
  const legal = FOOTER_LEGAL_LINKS.map(([h, t]) => `<a href="${h}">${t}</a>`).join('');
  const by = cfg.operator ? ` Operated by ${esc(cfg.operator)}.` : '';
  return `<footer class="sitefoot" aria-label="Site footer"><div class="sf-card">
<div class="sf-top">
<div class="sf-brand"><a class="name" href="/">MirrorMirror</a><p>Mirror, mirror on the cloud. An online presence audit for any company, made from free public sources.</p></div>
<nav aria-label="Product"><b>Product</b><a href="/#preview">Free preview</a><a href="/#report">Full report</a><a href="/#price">Price</a><a href="/account">My reports</a></nav>
<nav aria-label="Legal"><b>Legal</b>${legal}</nav>
<div class="c"><b>Contact</b><a href="mailto:${CONTACT.hello}">${CONTACT.hello}</a><a href="mailto:${CONTACT.corrections}">${CONTACT.corrections}</a><a href="mailto:${CONTACT.privacy}">${CONTACT.privacy}</a></div>
</div>
<div class="sf-notice">
<p><b>Notice.</b> ${esc(SHORT_DISCLAIMER)} Something wrong about you or your company? <a href="/corrections">Ask for a correction</a> · <a href="/disclaimer">Full disclaimer</a></p>
<p>MirrorMirror is not affiliated with, sponsored by or endorsed by Google, OpenAI, Stripe or any other brand named here. Payments are processed by Stripe; your card details never reach us. IP location data by <a href="https://db-ip.com" rel="noopener">DB-IP.com</a> (CC BY 4.0).</p>
</div>
<div class="sf-last"><span>© ${year} MirrorMirror.cloud.${by}</span><span>Governed by Malaysian law · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></span></div>
</div></footer>`;
}

// A slim version for frames and templates that carry their own page layout.
export function legalLine(cfg = legalConfig()) {
  void cfg;
  return `${esc(SHORT_DISCLAIMER)} ${FOOTER_LEGAL_LINKS.map(([h, t]) => `<a href="${h}">${t}</a>`).join(' · ')} · <a href="mailto:${CONTACT.corrections}">${CONTACT.corrections}</a>`;
}

// For emails: the same notice, absolute links. `html` goes inside the email wrapper, `text` at the end of the plain text.
export function emailLegal() {
  const links = FOOTER_LEGAL_LINKS.map(([h, t]) => `<a href="${SITE}${h}" style="color:#5c636d;">${t}</a>`).join(' · ');
  const html = `<p style="font-size:12px;color:#5c636d;margin:14px 0 0;line-height:1.5;">${esc(SHORT_DISCLAIMER)} Something wrong? <a href="mailto:${CONTACT.corrections}" style="color:#5c636d;">${CONTACT.corrections}</a></p><p style="font-size:12px;color:#5c636d;margin:8px 0 0;">${links}</p>`;
  const text = `\n\n--\nMirrorMirror.cloud\n${SHORT_DISCLAIMER}\nSomething wrong? ${CONTACT.corrections}\n${FOOTER_LEGAL_LINKS.map(([h, t]) => `${t}: ${SITE}${h}`).join('\n')}`;
  return { html, text };
}

// ---- Legal pages: markdown (the small subset the drafts use) to HTML ----

const TBC = '\u0001';
const TBC_END = '\u0002';

// Fills "[PLACEHOLDER]" in the drafts. Markdown links "[text](url)" are left alone.
function fill(text, cfg, stats) {
  return text.replace(/\[([^\]\n]+)\](?!\()/g, (_m, inner) => {
    const unresolved = () => { stats.unresolved += 1; return `${TBC}to be confirmed${TBC_END}`; };
    if (/^DECIDE$/i.test(inner)) return '';
    if (/^\d/.test(inner)) return inner; // [5] working days, [13 months]: the draft's suggested value
    if (/^OWNER FULL LEGAL NAME/i.test(inner)) return cfg.operator || unresolved();
    if (/^SSM (REGISTRATION )?NO/i.test(inner)) return cfg.ssm || unresolved();
    if (/^(REGISTERED BUSINESS )?ADDRESS/i.test(inner)) return cfg.address || unresolved();
    if (/^SST/i.test(inner)) return cfg.tax || unresolved();
    if (/^DATE$/i.test(inner)) return cfg.updated || unresolved();
    return unresolved();
  });
}

function inline(raw) {
  let s = esc(raw);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[([^\]]+)\]\(((?:\/|https?:\/\/|mailto:)[^)\s]*)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/(^|[\s(>])([A-Za-z0-9._-]+@mirrormirror\.cloud)(?![^<]*<\/a>)/g, '$1<a href="mailto:$2">$2</a>');
  s = s.replaceAll(TBC, '<span class="tbc">').replaceAll(TBC_END, '</span>');
  return s;
}

export function markdownToHtml(md, cfg = legalConfig()) {
  const stats = { unresolved: 0 };
  const lines = fill(String(md).replace(/<!--[\s\S]*?-->/g, ''), cfg, stats).split(/\r?\n/);
  const out = [];
  let i = 0;
  const startsBlock = (l) => /^(#{1,3} |> |\||- |\* |\d+\. |---+\s*$)/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,3}) (.*)$/.exec(l))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (l.startsWith('>')) {
      const q = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
      continue;
    }
    if (l.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|[\s:|]*-[\s:|-]*$/.test(r)).map(cells);
      const head = body.length && body[0].some(Boolean) ? body.shift() : (body.shift(), null);
      out.push(`<div class="tablewrap"><table>${head ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(- |\* )/.test(l)) {
      const items = [];
      while (i < lines.length && /^(- |\* )/.test(lines[i])) items.push(lines[i++].slice(2));
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+\. /.test(l)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ''));
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      continue;
    }
    const p = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) p.push(lines[i++].trim());
    if (!p.length) { p.push(lines[i++].trim()); }
    out.push(`<p>${inline(p.join(' '))}</p>`);
  }
  return { html: out.join('\n'), unresolved: stats.unresolved };
}

// Reads and renders every legal page once. Never throws: a file that cannot be read gives a page that says so.
export function loadLegal(cfg = legalConfig(), dir = new URL('./legal/', import.meta.url)) {
  const pages = new Map();
  for (const p of LEGAL_PAGES) {
    let md;
    try { md = readFileSync(new URL(p.file, dir), 'utf8'); } catch (e) { md = `# ${p.title}\n\nThis page could not be loaded just now. Please write to ${CONTACT.hello}.`; }
    const { html, unresolved } = markdownToHtml(md, cfg);
    // The notice shows only while a detail is still missing. Owner decision 2026-11-12: no lawyer-review label.
    pages.set(p.path, { ...p, html, draft: unresolved > 0, unresolved });
  }
  return pages;
}

export const LEGAL_CSS = `
.legal h1 { font-size:clamp(30px,4.5vw,42px); }
.legal h2 { font-family:var(--display); font-weight:600; letter-spacing:-0.02em; font-size:22px; margin:30px 0 8px; }
.legal h3 { font-size:17px; margin:20px 0 6px; }
.legal p, .legal li { color:#3b414a; }
.legal ol, .legal ul { margin:0 0 16px; }
.legal li { margin-bottom:6px; }
.legal blockquote { margin:18px 0; padding:12px 16px; background:var(--band); border-radius:10px; color:#3b414a; font-size:15px; }
.legal hr { border:0; border-top:1px solid var(--line); margin:26px 0; }
.legal .tablewrap { overflow-x:auto; margin:0 0 18px; }
.legal table { width:100%; border-collapse:collapse; font-size:15px; }
.legal th, .legal td { text-align:left; vertical-align:top; padding:10px 12px 10px 0; border-top:1px solid var(--line); }
.legal th { font-size:13px; letter-spacing:.03em; text-transform:uppercase; color:var(--grey); border-top:0; }
.legal td:first-child { color:var(--ink); font-weight:600; width:32%; }
.legal .tbc { background:#fdf3e2; color:#a15c07; padding:0 6px; border-radius:6px; font-weight:600; white-space:nowrap; }
.legal .draft { background:#fdf3e2; color:#7a4a05; border-radius:10px; padding:10px 14px; font-size:14px; margin:0 0 20px; }
.legal .others { margin-top:34px; padding-top:18px; border-top:1px solid var(--line); font-size:15px; }
`;
