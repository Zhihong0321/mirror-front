// Sends email through Mailjet (Send API v3.1). One place for every email the site sends.
//
// `send` NEVER throws and never blocks the caller's work: it always returns { ok, status, error? }, and writes
// every attempt (sent, failed or dry run) to the mail log in the database. A failed email is a labelled row,
// not a crash. Callers decide what to tell the user.

import { emailLegal } from './legal.js';

const MAILJET_URL = 'https://api.mailjet.com/v3.1/send';

export function createMailer({ apiKey, secretKey, from, fromName = 'MirrorMirror', dryRun = false, store, now = Date.now, fetchImpl = fetch, log = console.log }) {
  const configured = Boolean(apiKey && secretKey && from);

  function record(entry) {
    try { store?.logMail({ at: now(), ...entry }); } catch (e) { log(`mail log could not be written: ${e.message}`); }
  }

  // { to, kind, subject, text, html } -> { ok, status: 'sent' | 'dry-run' | 'failed', id?, error? }
  async function send({ to, kind, subject, text, html }) {
    const base = { to: String(to ?? ''), kind: String(kind ?? 'other'), subject };
    try {
      if (!base.to.includes('@')) throw new Error('no recipient address');
      if (dryRun) {
        log(`[mail dry run] ${base.kind} to ${base.to}: ${subject}\n${text ?? ''}`);
        record({ ...base, status: 'dry-run' });
        return { ok: true, status: 'dry-run' };
      }
      if (!configured) throw new Error('mail is not configured (MAILJET_API_KEY, MAILJET_SECRET_KEY, MAIL_FROM)');

      const res = await fetchImpl(MAILJET_URL, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          Messages: [{
            From: { Email: from, Name: fromName },
            To: [{ Email: base.to }],
            Subject: subject,
            TextPart: `${text ?? ''}${emailLegal().text}`,
            HTMLPart: html,
            CustomID: base.kind,
          }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const raw = await res.text();
      let data = null;
      try { data = JSON.parse(raw); } catch { /* not JSON: reported below */ }
      const msg = data?.Messages?.[0];
      if (res.ok && msg?.Status === 'success') {
        const id = String(msg.To?.[0]?.MessageID ?? '');
        record({ ...base, status: 'sent', providerId: id });
        return { ok: true, status: 'sent', id };
      }
      const why = msg?.Errors?.[0]?.ErrorMessage || data?.ErrorMessage || raw.slice(0, 200) || 'no reply';
      throw new Error(`Mailjet ${res.status}: ${why}`);
    } catch (e) {
      const error = String(e?.message ?? e).slice(0, 500);
      log(`email ${base.kind} to ${base.to} FAILED: ${error}`);
      record({ ...base, status: 'failed', error });
      return { ok: false, status: 'failed', error };
    }
  }

  return { send, configured, dryRun };
}
