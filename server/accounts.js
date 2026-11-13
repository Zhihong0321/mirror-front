// Accounts without passwords. An account is an email address; you sign in with a link sent to it.
// Owner's rule: a sign-in link is valid until the owner asks for a NEW link. No expiry time, no single use.
//   - a link the visitor asks for (POST /login) retires the earlier links for that address
//   - a link the site makes by itself (the one in the payment email) retires nothing, and nothing but the
//     visitor's own new request ever retires it
//   - the database keeps only a hash of each link and session token, never the token itself

import crypto from 'node:crypto';
import * as emails from './emails.js';

const SESSION_DAYS = 30;
const RESEND_AFTER_MS = 30_000;       // one new link per address per 30 seconds
const PER_IP = { max: 10, windowMs: 10 * 60_000 }; // and 10 requests per address-of-the-visitor per 10 minutes

export const COOKIE = 'mm_session';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');

export function normalizeEmail(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]{2,}$/.test(e) ? e : null;
}

// Only ever send people to a page on this site.
export function safeNext(raw) {
  const n = String(raw ?? '');
  return /^\/(?![/\\])[\x21-\x7e]*$/.test(n) && n.length <= 500 ? n : '/account';
}

export function createAccounts({ store, mailer, now = Date.now, log = console.log }) {
  const hits = new Map(); // ip -> request times

  function tooMany(ip) {
    const t = now();
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < PER_IP.windowMs);
    recent.push(t);
    hits.set(ip, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < PER_IP.windowMs)) hits.delete(k);
    return recent.length > PER_IP.max;
  }

  // -> { status: 'sent' | 'invalid' | 'wait' | 'busy' | 'failed', email?, wait? }
  async function requestLink({ email: raw, next, base, ip }) {
    const email = normalizeEmail(raw);
    if (!email) return { status: 'invalid' };
    if (tooMany(ip ?? '')) return { status: 'busy' };
    const t = now();
    const live = store.loginLinkFor(email);
    if (live && t - live.created_at < RESEND_AFTER_MS) {
      return { status: 'wait', email, wait: Math.ceil((RESEND_AFTER_MS - (t - live.created_at)) / 1000) };
    }
    const tok = token();
    store.putLoginLink(email, sha256(tok), safeNext(next), t);
    const link = `${base}/login/verify?token=${tok}`;
    const sent = await mailer.send({ to: email, kind: 'magic-link', ...emails.magicLink({ link }) });
    if (!sent.ok) {
      store.deleteLoginLink(sha256(tok)); // nothing was delivered, so do not make the visitor wait 30 seconds to retry; earlier links stay as they were
      return { status: 'failed', email };
    }
    store.retireOtherLinks(email, sha256(tok), t); // the new link is in their inbox: the earlier ones stop working
    return { status: 'sent', email };
  }

  // After a paid order: a sign-in link to the account, so the buyer can follow the report from any device.
  // A payment is not a sign-in request, so the 30-second and per-visitor limits do not apply, and this link cancels
  // no other link. It has no expiry. -> true when the email went out. Never throws.
  async function sendAfterPayment({ email, base, company, invoiceNo }) {
    try {
      const tok = token();
      store.putLoginLink(email, sha256(tok), '/account', now());
      const sent = await mailer.send({
        to: email, kind: 'payment-signin',
        ...emails.paymentSignIn({ link: `${base}/login/verify?token=${tok}`, company, invoiceNo, loginUrl: `${base}/login` }),
      });
      if (!sent.ok) store.deleteLoginLink(sha256(tok)); // nothing was delivered: the buyer can ask for a link at once
      return sent.ok;
    } catch (e) {
      log(`sign-in link after payment for ${email} could not be made: ${e.message}`);
      return false;
    }
  }

  // The link in the email opens a confirm page first (the button signs in).
  // -> { state: 'ok' | 'replaced' | 'unknown', email?, next? }
  function peek(tok) {
    return typeof tok === 'string' && tok ? store.peekLoginLink(sha256(tok)) : { state: 'unknown' };
  }

  // -> { sessionToken, email, next } or null
  function consume(tok) {
    if (typeof tok !== 'string' || !tok) return null;
    const row = store.takeLoginLink(sha256(tok));
    if (!row) return null;
    const t = now();
    store.upsertUser(row.email, t);
    const sessionToken = token();
    store.createSession(sha256(sessionToken), row.email, t, SESSION_DAYS * 86_400_000);
    return { sessionToken, email: row.email, next: safeNext(row.next) };
  }

  function cookieValue(req) {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`).exec(req.headers.cookie ?? '');
    return m ? m[1] : null;
  }

  function currentEmail(req) {
    const v = cookieValue(req);
    return v ? store.sessionEmail(sha256(v), now()) : null;
  }

  function logout(req) {
    const v = cookieValue(req);
    if (v) store.deleteSession(sha256(v));
  }

  const setCookie = (value, secure, maxAgeSeconds) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;

  return {
    requestLink, sendAfterPayment, peek, consume, currentEmail, logout,
    sessionCookie: (value, secure) => setCookie(value, secure, SESSION_DAYS * 86400),
    clearCookie: (secure) => setCookie('', secure, 0),
  };
}
