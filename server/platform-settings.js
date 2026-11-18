// Platform settings (/myoffice/settings): numbers the owner changes from the office, without a deploy.
// Now: the package price (the full report bundle). It is kept in the site database (settings.package_price_cents).
// When nothing is saved there, the price is PRICE_CENTS from Railway (default USD 89), as before.
//
// A bad value in the database never stops a sale or a page: it falls back to the Railway price.

import { esc } from './pages.js';
import { officePage } from './office-shell.js';
import { DASHBOARD_CSS } from './dashboard-css.js';

export const PRICE_KEY = 'package_price_cents';
// Stripe refuses a card payment under USD 0.50; the office form asks for at least USD 1. Upper end: a typo guard.
export const PRICE_MIN_CENTS = 100;
export const PRICE_MAX_CENTS = 10_000_000;

// The price written into the public pages in site/ (index.html, refer.html). The server swaps it for the current price.
export const STATIC_PRICE = { label: 'USD 89', short: '$89' };

// The saved price in cents, or `fallback` when nothing (or nothing usable) is saved.
export function priceFromSetting(raw, fallback) {
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isInteger(n) && n >= PRICE_MIN_CENTS && n <= PRICE_MAX_CENTS ? n : fallback;
}

// 8900 -> { label: 'USD 89', short: '$89' }; 8950 -> { label: 'USD 89.50', short: '$89.50' }
export function priceLabels(cents, currency = 'usd') {
  const c = Number(cents);
  const amount = c % 100 ? (c / 100).toFixed(2) : String(c / 100);
  return { label: `${String(currency || 'usd').toUpperCase()} ${amount}`, short: `$${amount}` };
}

// Swaps the price written in a public page (STATIC_PRICE) for the current one. Never throws: on any problem the page
// goes out as it was.
export function withPrice(page, labels) {
  try {
    if (!labels || (labels.label === STATIC_PRICE.label && labels.short === STATIC_PRICE.short)) return page;
    return String(page)
      .replace(/USD 89(?![\d.])/g, labels.label)
      .replace(/\$89(?![\d.])/g, labels.short);
  } catch { return page; }
}

const NOTICES = {
  price_saved: ['ok', 'Price saved. New checkouts and every page now use it.'],
  price_reset: ['ok', 'Saved price removed. The site uses the Railway price again.'],
  price_bad: ['bad', 'That is not a price. Type an amount in USD, for example 89 or 89.50 (at least 1).'],
};

const CSS = `${DASHBOARD_CSS}
form.setting { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:14px; }
form.setting input { margin:0; max-width:160px; }
.nowprice { font-family:var(--display); font-size:44px; font-weight:600; letter-spacing:-0.03em; color:var(--ink); line-height:1; margin:14px 0 6px; }
.fine { font-size:14px; color:var(--grey); }
code.k { font-size:13px; background:var(--band); padding:2px 6px; border-radius:6px; }
ul.uses { margin:10px 0 0; padding-left:20px; color:var(--grey); font-size:15px; }
ul.uses li { margin:4px 0; }
`;

// d: { email, badges, notice, priceCents, defaultCents, saved: { cents, raw, updatedAt } | null, currency, tz }
export function settingsPage(d) {
  const n = d.notice ? NOTICES[d.notice] : null;
  const now = priceLabels(d.priceCents, d.currency);
  const def = priceLabels(d.defaultCents, d.currency);
  const saved = d.saved ?? null;
  let when = '';
  try { if (saved?.updatedAt) when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: d.tz || 'UTC' }).format(new Date(Number(saved.updatedAt))); } catch { when = ''; }
  const source = saved?.cents != null
    ? `Saved here${when ? ` on ${esc(when)}` : ''}. Without it the price would be ${esc(def.label)} (Railway <code class="k">PRICE_CENTS</code>).`
    : `Not saved here yet: this is the Railway price (<code class="k">PRICE_CENTS</code>).`;
  const unusable = saved && saved.cents == null && saved.raw != null && saved.raw !== ''
    ? `<p class="notice bad">The saved value <code class="k">${esc(saved.raw)}</code> is not a usable price, so the site uses ${esc(def.label)}. Save a new price to fix it.</p>` : '';
  const body = `
<div class="top"><div><h1>Platform settings</h1></div></div>
${n ? `<p class="notice ${n[0] === 'ok' ? '' : n[0]}">${esc(n[1])}</p>` : ''}
${unusable}
<section class="blk">
<h2>Package price</h2>
<p class="lead">The full report bundle: 2 full reports and 1 Social Media Ads report, one payment.</p>
<div class="nowprice">${esc(now.label)}</div>
<p class="fine">${source}</p>
<form class="setting" method="post" action="/myoffice/settings/price">
<label class="f" for="usd" style="margin:0">USD</label>
<input id="usd" name="usd" type="text" inputmode="decimal" value="${esc((Number(d.priceCents) / 100).toFixed(2))}" required>
<button class="btn sm" type="submit">Save price</button>
</form>
${saved?.cents != null || unusable ? `<form class="setting" method="post" action="/myoffice/settings/price"><input type="hidden" name="reset" value="1"><button class="btn quiet sm" type="submit">Use the Railway price (${esc(def.label)})</button></form>` : ''}
<p class="fine" style="margin-top:18px">A change applies at once to:</p>
<ul class="uses">
<li>what Stripe charges at checkout (orders already paid keep the amount they paid)</li>
<li>the order page, the free preview pages and the customer account pages</li>
<li>the home page and the referral page (<a href="/" target="_blank" rel="noopener">/</a>, <a href="/refer" target="_blank" rel="noopener">/refer</a>)</li>
</ul>
<p class="fine" style="margin-top:12px">Not changed: the referral commission (set on <a href="/myoffice/referrals">Referral payouts</a>) and the "worth" values on the order page.</p>
</section>`;
  return officePage('Platform settings', body, { on: '/myoffice/settings', email: d.email, badges: d.badges, css: CSS });
}
