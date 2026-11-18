// The site's mailbox: email sent TO @mirrormirror.cloud (hello@, corrections@, privacy@, admin@ ...).
// Mailjet receives it (the domain's MX points at parse.mailjet.com) and posts each message as JSON to
// POST /mail/inbound?key=<key> (Mailjet "Parse API" route). The team reads it at /myoffice/mail.
//
// Nothing is ever dropped (owner rule): every post is stored, whatever its shape. A post without the right key is still
// kept and labelled "unverified"; a body that is not JSON is kept as text and labelled; a body too large to keep is a
// row that says so. The full payload (minus attachment bytes) is kept as raw_json so no field is lost.

import crypto from 'node:crypto';

export const MAX_INBOUND_BYTES = 40 * 1024 * 1024; // a post larger than this is recorded as a labelled row, not kept

// The key Mailjet puts on the inbound URL. Derived from the Mailjet secret key, so no extra setting is needed.
export function inboundKeyFrom(secret) {
  return secret ? crypto.createHmac('sha256', String(secret)).update('mirrormirror-mail-inbound').digest('hex').slice(0, 40) : '';
}

export function keyMatches(given, key) {
  if (!key || typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function openMailbox(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_mail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at INTEGER NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0, -- 1 = posted with the right key (from our Mailjet route)
      mail_from TEXT,      -- the From header ("Name <a@b>")
      sender TEXT,         -- the envelope sender
      recipient TEXT,      -- the envelope recipient: which of our addresses it was sent to
      to_header TEXT,
      cc TEXT,
      reply_to TEXT,
      subject TEXT,
      date_header TEXT,
      text_body TEXT,
      html_body TEXT,
      spam_score REAL,
      attachments INTEGER NOT NULL DEFAULT 0,
      raw_size INTEGER,
      problem TEXT,        -- anything wrong with the post, labelled; the message is still kept
      raw_json TEXT,       -- the whole payload, attachment bytes replaced by a note
      read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS inbound_mail_received ON inbound_mail (received_at);
    CREATE TABLE IF NOT EXISTS inbound_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mail_id INTEGER NOT NULL,
      part TEXT,
      filename TEXT,
      content_type TEXT,
      inline INTEGER NOT NULL DEFAULT 0,
      size INTEGER,
      data BLOB
    );
    CREATE INDEX IF NOT EXISTS inbound_attachments_mail ON inbound_attachments (mail_id);
  `);
  const q = (sql) => db.prepare(sql);
  const s = {
    insert: q(`INSERT INTO inbound_mail (received_at, verified, mail_from, sender, recipient, to_header, cc, reply_to, subject, date_header,
      text_body, html_body, spam_score, attachments, raw_size, problem, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertAtt: q('INSERT INTO inbound_attachments (mail_id, part, filename, content_type, inline, size, data) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    list: q(`SELECT id, received_at, verified, mail_from, sender, recipient, to_header, subject, spam_score, attachments, problem, read_at,
      substr(coalesce(text_body, ''), 1, 160) AS snippet FROM inbound_mail ORDER BY received_at DESC, id DESC LIMIT ?`),
    byId: q('SELECT * FROM inbound_mail WHERE id = ?'),
    atts: q('SELECT id, mail_id, part, filename, content_type, inline, size FROM inbound_attachments WHERE mail_id = ? ORDER BY id'),
    att: q('SELECT * FROM inbound_attachments WHERE id = ? AND mail_id = ?'),
    markRead: q('UPDATE inbound_mail SET read_at = ? WHERE id = ? AND read_at IS NULL'),
    markUnread: q('UPDATE inbound_mail SET read_at = NULL WHERE id = ?'),
    unread: q('SELECT count(*) AS n FROM inbound_mail WHERE read_at IS NULL'),
    recipients: q("SELECT lower(coalesce(recipient, '')) AS recipient, count(*) AS n, sum(read_at IS NULL) AS unread FROM inbound_mail GROUP BY 1 ORDER BY n DESC"),
  };
  const plain = (row) => (row ? { ...row } : null);

  return {
    // m: the result of parseInbound(). Returns the new mail id. One transaction, so a message is never half stored.
    save(m, now) {
      db.exec('BEGIN');
      try {
        const r = s.insert.run(now, m.verified ? 1 : 0, m.from, m.sender, m.recipient, m.to, m.cc, m.replyTo, m.subject, m.date,
          m.text, m.html, m.spamScore, m.attachments.length, m.rawSize, m.problems.length ? m.problems.join(' · ') : null, m.rawJson);
        const id = Number(r.lastInsertRowid);
        for (const a of m.attachments) s.insertAtt.run(id, a.part, a.filename, a.contentType, a.inline ? 1 : 0, a.data.length, a.data);
        db.exec('COMMIT');
        return id;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },
    list: (limit = 500) => s.list.all(limit).map(plain),
    get: (id) => plain(s.byId.get(id)),
    attachmentsOf: (id) => s.atts.all(id).map(plain),
    attachment: (mailId, attId) => plain(s.att.get(attId, mailId)),
    markRead: (id, now) => { s.markRead.run(now, id); },
    markUnread: (id) => { s.markUnread.run(id); },
    unreadCount: () => Number(s.unread.get()?.n ?? 0),
    recipients: () => s.recipients.all().map(plain),
  };
}

const str = (v, max = 100_000) => {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, max);
  if (Array.isArray(v)) return v.map((x) => str(x, max)).filter(Boolean).join(', ').slice(0, max) || null;
  if (typeof v === 'object') { try { return JSON.stringify(v).slice(0, max); } catch { return null; } }
  return String(v).slice(0, max);
};

// Header lookup that ignores case. Mailjet sends Headers as an object; a header seen twice may be an array.
function header(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? str(headers[key], 4000) : null;
}

// filename="x.pdf" or name=x.pdf, from Content-Disposition / Content-Type.
function paramOf(value, name) {
  const m = new RegExp(`(?:^|;)\\s*${name}\\*?=\\s*(?:"([^"]*)"|([^;]*))`, 'i').exec(String(value ?? ''));
  if (!m) return null;
  let v = (m[1] ?? m[2] ?? '').trim();
  const rfc2231 = /^[\w-]*'[\w-]*'(.*)$/.exec(v); // filename*=utf-8''na%20me.pdf
  if (rfc2231) { try { v = decodeURIComponent(rfc2231[1]); } catch { v = rfc2231[1]; } }
  return v || null;
}

const ATTACHMENT_KEY = /^(Inline)?Attachment\d+$/i;

function decodeBase64(value) {
  if (typeof value !== 'string') return Buffer.from(str(value) ?? '', 'utf8');
  try { return Buffer.from(value.replace(/\s+/g, ''), 'base64'); } catch { return Buffer.from(value, 'utf8'); }
}

// Turns one inbound post into a message to store. Never throws: anything odd becomes a labelled problem.
//   body: Buffer or string of the request body. verified: was the key right. rawSize: bytes received.
export function parseInbound(body, { verified = false, rawSize = null, tooLarge = false } = {}) {
  const problems = [];
  if (!verified) problems.push('unverified: posted without the mailbox key, so it may not come from Mailjet');
  const empty = { verified, rawSize, from: null, sender: null, recipient: null, to: null, cc: null, replyTo: null, subject: null,
    date: null, text: null, html: null, spamScore: null, attachments: [], rawJson: null, problems };
  if (tooLarge) {
    problems.push(`too large to keep: ${rawSize ?? '?'} bytes (the limit is ${MAX_INBOUND_BYTES} bytes); only this note was stored`);
    return empty;
  }
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
  let p;
  try { p = JSON.parse(text); } catch (e) {
    problems.push(`not JSON (${e.message}); the body is kept as text`);
    return { ...empty, text: text.slice(0, 2_000_000) };
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    problems.push('the JSON is not an object; it is kept as text');
    return { ...empty, text: text.slice(0, 2_000_000) };
  }

  const headers = p.Headers && typeof p.Headers === 'object' ? p.Headers : {};
  const attachments = [];
  const seen = new Set();
  const addAttachment = (key, partHeaders) => {
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const data = decodeBase64(p[key]);
      const disp = header(partHeaders, 'Content-Disposition');
      const ctype = header(partHeaders, 'Content-Type');
      attachments.push({
        part: key,
        filename: paramOf(disp, 'filename') ?? paramOf(ctype, 'name') ?? key,
        contentType: (ctype ?? 'application/octet-stream').split(';')[0].trim().slice(0, 200) || 'application/octet-stream',
        inline: /^inline/i.test(key) || /^inline/i.test(disp ?? ''),
        data,
      });
    } catch (e) { problems.push(`attachment ${key} could not be read: ${e.message}`); }
  };
  for (const part of Array.isArray(p.Parts) ? p.Parts : []) {
    const ref = typeof part?.ContentRef === 'string' ? part.ContentRef : null;
    if (ref && ATTACHMENT_KEY.test(ref) && p[ref] != null) addAttachment(ref, part.Headers);
  }
  for (const key of Object.keys(p)) if (ATTACHMENT_KEY.test(key)) addAttachment(key, null); // an attachment Parts did not list

  // The payload as received, with attachment bytes swapped for a note: every other field is kept as it came.
  let rawJson = null;
  try {
    const copy = { ...p };
    for (const key of seen) copy[key] = `[${attachments.find((a) => a.part === key)?.data.length ?? '?'} bytes, stored as an attachment]`;
    rawJson = JSON.stringify(copy).slice(0, 4_000_000);
  } catch (e) { problems.push(`raw payload could not be kept: ${e.message}`); }

  const score = Number.parseFloat(p.SpamAssassinScore ?? header(headers, 'X-Spam-Score'));
  const textBody = str(p['Text-part'] ?? p.TextPart ?? p.Text, 2_000_000);
  const htmlBody = str(p['Html-part'] ?? p.HtmlPart ?? p.Html, 4_000_000);
  if (!textBody && !htmlBody) problems.push('no text or HTML body in the post');
  const recipient = str(p.Recipient ?? header(headers, 'Delivered-To') ?? header(headers, 'To'), 1000);
  if (!recipient) problems.push('no recipient in the post');

  return {
    ...empty,
    from: str(p.From ?? header(headers, 'From'), 1000),
    sender: str(p.Sender ?? header(headers, 'Return-Path'), 1000),
    recipient,
    to: str(header(headers, 'To') ?? p.To, 4000),
    cc: str(header(headers, 'Cc') ?? p.Cc, 4000),
    replyTo: str(header(headers, 'Reply-To') ?? p.ReplyTo, 1000),
    subject: str(p.Subject ?? header(headers, 'Subject'), 2000),
    date: str(p.Date ?? header(headers, 'Date'), 200),
    text: textBody,
    html: htmlBody,
    spamScore: Number.isFinite(score) ? score : null,
    attachments,
    rawJson,
  };
}

// Reads a request body up to MAX_INBOUND_BYTES. Past the limit it keeps reading (and discarding) so the sender gets an
// answer, and reports tooLarge. Never rejects on size.
export function readInbound(req, max = MAX_INBOUND_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('end', () => resolve({ body: size <= max ? Buffer.concat(chunks) : null, size, tooLarge: size > max }));
    req.on('error', reject);
  });
}
