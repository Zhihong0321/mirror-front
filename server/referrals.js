// The referral program, the parts that are not pages: referral codes, the USDT wallet check, how a referral is
// attributed to an order, and the "did the client read it" verdict from the visitor tracker.
// See docs/referrals.md. Pure functions: store.js keeps the data, app.js wires the routes, referrals-page.js draws.
//
// Zero kill gates: nothing here may stop a page, an order or a commission. A problem is returned as a label
// (a wallet reason, "held", "unmeasured"), never as a thrown error that removes output.

import crypto from 'node:crypto';

export const COMMISSION_DEFAULT_CENTS = 2000;   // USD 20 per sold report, until the owner sets another in the database
export const COMMISSION_KEY = 'referral_commission_cents';
export const COMMISSION_CURRENCY = 'usd';       // paid in USDT, which is worth one US dollar
export const REF_COOKIE = 'mm_ref';
export const REF_COOKIE_DAYS = 30;

// A referral code is public (it is in every link), so it is random and says nothing about the person.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0 o 1 l i
export const CODE_RE = /^[a-z0-9]{6,12}$/;
export function newCode(length = 8) {
  let out = '';
  for (const b of crypto.randomBytes(length)) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}
export const cleanCode = (raw) => {
  const c = String(raw ?? '').trim().toLowerCase();
  return CODE_RE.test(c) ? c : null;
};

// The commission setting is a number of cents in the settings table. Anything else falls back to the default,
// so a bad value in the database can never stop an order.
export function commissionFromSetting(raw) {
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isInteger(n) && n >= 0 && n <= 10_000_000 ? n : COMMISSION_DEFAULT_CENTS;
}

// "20", "20.5", "$20" -> cents, or null when it is not an amount. For the team's form.
export function dollarsToCents(raw) {
  const s = String(raw ?? '').replace(/[$,\s]/g, '').replace(/^usd/i, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

// ---- The referral cookie: who sent this visitor to which report. 30 days, per report. ----

const REF_COOKIE_RE = new RegExp(`(?:^|;\\s*)${REF_COOKIE}=([a-z0-9]{6,12})~([0-9a-f-]{36})`);
export function refFromCookie(req, reportId) {
  const m = REF_COOKIE_RE.exec(req.headers.cookie ?? '');
  return m && String(reportId ?? '').toLowerCase() === m[2] ? m[1] : null;
}
export const refCookie = (code, reportId, secure) =>
  `${REF_COOKIE}=${code}~${String(reportId).toLowerCase()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${REF_COOKIE_DAYS * 86400}${secure ? '; Secure' : ''}`;

// The ref in a page address (?ref=code), or null.
export const refFromUrl = (url) => cleanCode(url?.searchParams?.get('ref'));

// ---- USDT wallets ----
// Payouts are USDT only, and the person pastes an address and nothing else (owner decision 2026-11-13: no network to
// pick, so it cannot be picked wrongly). The chain is read from the address itself: a TRON (TRC20) address carries a
// checksum, so a typo is caught; a 0x address is the same wallet on Ethereum (ERC20) and on BNB Smart Chain (BEP20),
// and the team chooses the chain it sends on. `erc20` and `bep20` stay known so a wallet saved before that date still
// prints its label.

export const NETWORKS = {
  trc20: { label: 'TRON (TRC20)' },
  evm: { label: 'EVM address (ERC20 or BEP20)' },
  erc20: { label: 'Ethereum (ERC20)' },
  bep20: { label: 'BNB Smart Chain (BEP20)' },
};
export const networkLabel = (n) => NETWORKS[n]?.label ?? String(n ?? '');

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(s) {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch === '1') bytes.unshift(0); else break; }
  return Buffer.from(bytes);
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

// -> { ok: true, address, network } or { ok: false, reason: 'empty' | 'format' | 'checksum' }
// The network is read from the address: nothing else is asked, so a TRON address is never saved as Ethereum.
export function checkWallet(raw) {
  const address = String(raw ?? '').trim();
  if (!address) return { ok: false, reason: 'empty' };
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    const raw25 = base58Decode(address);
    if (!raw25 || raw25.length !== 25 || raw25[0] !== 0x41) return { ok: false, reason: 'format' };
    const sum = sha256(sha256(raw25.subarray(0, 21))).subarray(0, 4);
    return sum.equals(raw25.subarray(21)) ? { ok: true, address, network: 'trc20' } : { ok: false, reason: 'checksum' };
  }
  if (address.startsWith('T')) return { ok: false, reason: address.length === 34 ? 'checksum' : 'format' };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/.test(address)) return { ok: false, reason: 'format' };
  return { ok: true, address, network: 'evm' };
}

export const WALLET_REASONS = {
  empty: 'Paste your USDT wallet address.',
  format: 'That does not look like a USDT address. A TRON (TRC20) address starts with T and has 34 characters; an EVM address starts with 0x and has 42.',
  checksum: 'That TRON address has a typo (its checksum does not match). Copy it again from your wallet.',
};

// Shown instead of the full address wherever a wallet is listed.
export const shortWallet = (a) => (String(a ?? '').length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : String(a ?? ''));

// ---- Did the client read it? From the tracker rows (visits.js referrerViews). ----

export const READ_SCROLL = 60;      // scrolled at least this far (percent) ...
export const READ_MS = 30_000;      // ... and stayed at least this long, and it counts as read

// rows: tracker rows for ONE preview page, bots included. Returns the verdict and the numbers behind it.
// state: 'none' (nobody opened it) | 'bots' (only a bot or chat-app link preview fetched it) | 'opened' | 'read'
export function readership(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const humans = all.filter((r) => !r.is_bot);
  const bots = all.length - humans.length;
  const people = new Set(humans.map((r) => r.visitor_id || `${r.ip ?? ''}|${r.ua ?? ''}|${r.id}`)).size;
  const measured = humans.filter((r) => r.js);
  const totalMs = humans.reduce((t, r) => t + (Number(r.active_ms) || 0), 0);
  const scrolls = humans.map((r) => r.scroll_pct).filter((s) => s != null).map(Number);
  const maxScroll = scrolls.length ? Math.max(...scrolls) : null;
  const times = humans.map((r) => Number(r.created_at)).filter(Number.isFinite);
  const best = Math.max(0, ...humans.map((r) => Number(r.active_ms) || 0));
  // "Read" is judged on the best single visit: one proper read, not ten glances added up.
  const bestScroll = Math.max(0, ...humans.map((r) => (Number(r.active_ms) >= READ_MS ? Number(r.scroll_pct) || 0 : 0)));
  let state = 'none';
  if (humans.length) state = best >= READ_MS && bestScroll >= READ_SCROLL ? 'read' : 'opened';
  else if (bots) state = 'bots';
  return {
    state, views: humans.length, people, bots, totalMs, bestMs: best, maxScroll,
    unmeasured: humans.length > 0 && measured.length === 0, // opened, but the browser reported no time (script blocked, or the factory's own page)
    firstAt: times.length ? Math.min(...times) : null,
    lastAt: times.length ? Math.max(...times) : null,
  };
}

export const STATE_LABEL = {
  none: ['Not opened yet', ''],
  bots: ['Not opened by a person yet', 'wait'],
  opened: ['Opened', 'wait'],
  read: ['Read it', 'ok'],
};

// "3 hours ago". `now` is passed in so tests can fix it.
export function ago(ms, now) {
  const s = Math.round((Number(now) - Number(ms)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
