// The team's office: every team page lives under /myoffice and opens with one shared password, OFFICE_KEY
// (owner decision 2026-11-12: not /admin, which every scanner tries; access by key, not by email).
//
// - POST /myoffice/login with the key sets an office cookie for 30 days. The cookie holds an HMAC of the key, never
//   the key itself, so changing OFFICE_KEY on Railway signs every office browser out.
// - No OFFICE_KEY set: the office cannot be opened (the login page says why).
// - Too many wrong keys from one address: that address waits 15 minutes.

import crypto from 'node:crypto';
import { page, esc } from './pages.js';

export const OFFICE = '/myoffice';
const COOKIE = 'mm_office';
const DAYS = 30;
const MAX_TRIES = 10; // wrong keys per address per window
const WINDOW_MS = 15 * 60 * 1000;

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function createOffice({ key, now = Date.now }) {
  const configured = Boolean(key);
  const token = configured ? crypto.createHmac('sha256', key).update('mirrormirror-office-v1').digest('base64url') : '';
  const fails = new Map(); // ip -> { n, since }

  const cookieOf = (req) => {
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return v.join('=');
    }
    return '';
  };

  return {
    configured,
    // Is this browser in the office?
    isIn(req) {
      if (!configured) return false;
      const c = cookieOf(req);
      return Boolean(c) && crypto.timingSafeEqual(digest(c), digest(token));
    },
    // -> 'ok' | 'wrong' | 'wait' | 'off'
    check(given, ip) {
      if (!configured) return 'off';
      const t = now();
      const f = fails.get(ip);
      if (f && t - f.since > WINDOW_MS) fails.delete(ip);
      if ((fails.get(ip)?.n ?? 0) >= MAX_TRIES) return 'wait';
      if (crypto.timingSafeEqual(digest(given ?? ''), digest(key))) { fails.delete(ip); return 'ok'; }
      const cur = fails.get(ip) ?? { n: 0, since: t };
      cur.n += 1;
      fails.set(ip, cur);
      if (fails.size > 10_000) fails.clear(); // never grows without end
      return 'wrong';
    },
    cookie: (secure) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure ? '; Secure' : ''}`,
    clearCookie: (secure) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
  };
}

// Only office pages may be the place to go after the key.
export const safeNext = (next) => (typeof next === 'string' && next.startsWith(`${OFFICE}`) && !next.startsWith('//') && !/[\r\n]/.test(next) ? next : `${OFFICE}/previews`);

export function officeLoginPage({ next = '', error = null, configured = true }) {
  return page('Office', `<h1>Office</h1>
${configured ? '' : '<p class="err">The office key is not set on this server (OFFICE_KEY). Set it on Railway, then come back.</p>'}
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="${OFFICE}/login">
<input type="hidden" name="next" value="${esc(next)}">
<input type="password" name="key" placeholder="Office key" autocomplete="current-password" required autofocus>
<button class="btn" type="submit">Enter</button>
</form>`, { css: 'input[type=password] { width:100%; font:inherit; padding:12px 14px; border:1px solid var(--line); border-radius:10px; margin:0 0 12px; }' });
}
