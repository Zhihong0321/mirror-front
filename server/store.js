// The website's own small database (SQLite, built into Node): accounts, magic links, sessions, paid orders
// and the log of every email we tried to send. One file, DATA_DIR/mirrormirror.db. Use ':memory:' in tests.
//
// An account is just an email address. There are no passwords.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { openVisits } from './visits.js';

export const MAX_OPEN_PREVIEWS = 10; // previews one account may have waiting at once

export function openStore(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    -- email is the primary key: one live sign-in link per address. A new link replaces the old one.
    CREATE TABLE IF NOT EXISTS login_links (
      email TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      next TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stripe_session_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      dive_id INTEGER,
      dive_public_id TEXT,
      company TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      paid_at INTEGER NOT NULL,
      report_url TEXT,
      invoice_no TEXT,
      invoice_emailed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS orders_email ON orders (email);
    -- Every email we tried to send, sent or not. A failed one stays here with its error.
    CREATE TABLE IF NOT EXISTS mail_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      to_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject TEXT,
      status TEXT NOT NULL,
      provider_id TEXT,
      error TEXT
    );
  `);

  // The company-diver report this order bought (v21_report.report_id). It is what lets the site check who may
  // open a full report (docs/report-display.md). Added to databases made before it existed.
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'report_id')) db.exec('ALTER TABLE orders ADD COLUMN report_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS orders_report ON orders (report_id)');

  // When the sign-in link that follows a payment was emailed (once per order). Added to databases made before it existed.
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'signin_emailed_at')) db.exec('ALTER TABLE orders ADD COLUMN signin_emailed_at INTEGER');

  // Free previews an account asked for. The team makes the preview, then marks the request ready with the
  // company-diver report_id (POST /api/previews/<id>/ready); the buyer is emailed the link.
  db.exec(`
    CREATE TABLE IF NOT EXISTS preview_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      company TEXT NOT NULL,
      who TEXT NOT NULL,
      country TEXT,
      website TEXT,
      status TEXT NOT NULL DEFAULT 'requested',
      report_id TEXT,
      created_at INTEGER NOT NULL,
      ready_at INTEGER,
      ready_emailed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS preview_requests_email ON preview_requests (email);
  `);

  const q = (sql) => db.prepare(sql);
  const s = {
    upsertUser: q('INSERT INTO users (email, created_at, last_login_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at'),
    putLink: q('INSERT OR REPLACE INTO login_links (email, token_hash, next, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    linkByEmail: q('SELECT * FROM login_links WHERE email = ?'),
    linkByHash: q('SELECT * FROM login_links WHERE token_hash = ?'),
    delLinkByEmail: q('DELETE FROM login_links WHERE email = ?'),
    delExpiredLinks: q('DELETE FROM login_links WHERE expires_at < ?'),
    putSession: q('INSERT INTO sessions (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    sessionByHash: q('SELECT * FROM sessions WHERE token_hash = ?'),
    delSession: q('DELETE FROM sessions WHERE token_hash = ?'),
    delExpiredSessions: q('DELETE FROM sessions WHERE expires_at < ?'),
    insertOrder: q(`INSERT INTO orders (stripe_session_id, email, dive_id, dive_public_id, company, amount_cents, currency, paid_at, report_url, report_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(stripe_session_id) DO NOTHING`),
    setReportId: q('UPDATE orders SET report_id = ? WHERE id = ?'),
    orderForReport: q('SELECT id FROM orders WHERE email = ? AND report_id = ? LIMIT 1'),
    orderByStripe: q('SELECT * FROM orders WHERE stripe_session_id = ?'),
    orderById: q('SELECT * FROM orders WHERE id = ?'),
    setInvoiceNo: q('UPDATE orders SET invoice_no = ? WHERE id = ?'),
    setReportUrl: q('UPDATE orders SET report_url = ? WHERE id = ?'),
    setEmail: q('UPDATE orders SET email = ? WHERE id = ?'),
    setEmailed: q('UPDATE orders SET invoice_emailed_at = ? WHERE id = ?'),
    setSigninEmailed: q('UPDATE orders SET signin_emailed_at = ? WHERE id = ?'),
    ordersByEmail: q('SELECT * FROM orders WHERE email = ? ORDER BY paid_at DESC, id DESC'),
    insertMail: q('INSERT INTO mail_log (created_at, to_email, kind, subject, status, provider_id, error) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    mailLog: q('SELECT * FROM mail_log ORDER BY id DESC LIMIT ?'),
    insertPreview: q('INSERT INTO preview_requests (email, company, who, country, website, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    previewById: q('SELECT * FROM preview_requests WHERE id = ?'),
    previewsByEmail: q('SELECT * FROM preview_requests WHERE email = ? ORDER BY created_at DESC, id DESC'),
    openPreviewSame: q("SELECT * FROM preview_requests WHERE email = ? AND lower(company) = lower(?) AND status = 'requested' LIMIT 1"),
    openPreviewCount: q("SELECT count(*) AS n FROM preview_requests WHERE email = ? AND status = 'requested'"),
    // A different report than before means the buyer has not been told about this one: clear "emailed".
    previewReady: q("UPDATE preview_requests SET status = 'ready', ready_emailed_at = CASE WHEN report_id IS ? THEN ready_emailed_at ELSE NULL END, report_id = ?, ready_at = ? WHERE id = ?"),
    allPreviews: q("SELECT * FROM preview_requests ORDER BY (status = 'requested') DESC, created_at DESC, id DESC LIMIT ?"),
    previewReadyEmailed: q('UPDATE preview_requests SET ready_emailed_at = ? WHERE id = ?'),
  };
  const plain = (row) => (row ? { ...row } : null);
  // Visitor analytics (visits.js): one row per page view.
  const visits = openVisits(db);

  return {
    close: () => db.close(),
    visits,

    upsertUser: (email, now) => { s.upsertUser.run(email, now, now); },

    // A new link for an address replaces the one before it.
    putLoginLink: (email, tokenHash, next, now, ttlMs) => {
      s.delExpiredLinks.run(now);
      s.putLink.run(email, tokenHash, next ?? null, now, now + ttlMs);
    },
    loginLinkFor: (email) => plain(s.linkByEmail.get(email)),
    deleteLoginLink: (email) => { s.delLinkByEmail.run(email); },
    // Looks a link up without using it up (the confirm page shows before the button is pressed).
    peekLoginLink: (tokenHash, now) => {
      const row = s.linkByHash.get(tokenHash);
      return row && row.expires_at >= now ? plain(row) : null;
    },
    // Single use: the link is gone once taken.
    takeLoginLink: (tokenHash, now) => {
      const row = s.linkByHash.get(tokenHash);
      if (!row) return null;
      s.delLinkByEmail.run(row.email);
      return row.expires_at >= now ? plain(row) : null;
    },

    createSession: (tokenHash, email, now, ttlMs) => {
      s.delExpiredSessions.run(now);
      s.putSession.run(tokenHash, email, now, now + ttlMs);
    },
    sessionEmail: (tokenHash, now) => {
      const row = s.sessionByHash.get(tokenHash);
      if (!row) return null;
      if (row.expires_at < now) { s.delSession.run(tokenHash); return null; }
      return row.email;
    },
    deleteSession: (tokenHash) => { s.delSession.run(tokenHash); },

    // Safe to call again for the same Stripe session: it returns the order that already exists.
    recordOrder: (o) => {
      o = { ...o, reportId: o.reportId ? String(o.reportId).toLowerCase() : null };
      s.insertOrder.run(o.stripeSessionId, o.email, o.diveId ?? null, o.divePublicId ?? null, o.company ?? null,
        o.amountCents, o.currency, o.paidAt, o.reportUrl ?? null, o.reportId ?? null);
      let order = s.orderByStripe.get(o.stripeSessionId);
      if (!order.invoice_no) {
        const year = new Date(order.paid_at).getUTCFullYear();
        s.setInvoiceNo.run(`MM-${year}-${String(order.id).padStart(4, '0')}`, order.id);
        order = s.orderById.get(order.id);
      }
      if (o.reportUrl && o.reportUrl !== order.report_url) { s.setReportUrl.run(o.reportUrl, order.id); order = s.orderById.get(order.id); }
      if (o.email && o.email !== order.email) { s.setEmail.run(o.email, order.id); order = s.orderById.get(order.id); }
      if (o.reportId && o.reportId !== order.report_id) { s.setReportId.run(o.reportId, order.id); order = s.orderById.get(order.id); }
      return plain(order);
    },
    // Has this account bought this report? The payment check in front of every full report.
    hasReportOrder: (email, reportId) => !!(email && reportId && s.orderForReport.get(email, String(reportId).toLowerCase())),
    orderById: (id) => plain(s.orderById.get(id)),
    ordersFor: (email) => s.ordersByEmail.all(email).map(plain),
    markInvoiceEmailed: (id, now) => { s.setEmailed.run(now, id); },
    markSigninEmailed: (id, now) => { s.setSigninEmailed.run(now, id); },

    // Free previews. addPreviewRequest -> { request, duplicate }: asking again for the same company while the first
    // is still open returns the first one instead of a second.
    addPreviewRequest: (p, now) => {
      const same = s.openPreviewSame.get(p.email, p.company);
      if (same) return { request: plain(same), duplicate: true };
      if (s.openPreviewCount.get(p.email).n >= MAX_OPEN_PREVIEWS) return { request: null, limited: true };
      const { lastInsertRowid } = s.insertPreview.run(p.email, p.company, p.who, p.country ?? null, p.website ?? null, now);
      return { request: plain(s.previewById.get(Number(lastInsertRowid))), duplicate: false };
    },
    openPreviewCount: (email) => s.openPreviewCount.get(email).n,
    previewsFor: (email) => s.previewsByEmail.all(email).map(plain),
    previewById: (id) => plain(s.previewById.get(id)),
    markPreviewReady: (id, reportId, now) => {
      const rid = String(reportId).toLowerCase();
      s.previewReady.run(rid, rid, now, id);
      return plain(s.previewById.get(id));
    },
    allPreviews: (limit = 300) => s.allPreviews.all(limit).map(plain), // open requests first, then newest
    markPreviewReadyEmailed: (id, now) => { s.previewReadyEmailed.run(now, id); },

    logMail: (m) => { s.insertMail.run(m.at, m.to, m.kind, m.subject ?? null, m.status, m.providerId ?? null, m.error ?? null); },
    recentMail: (limit = 50) => s.mailLog.all(limit).map(plain),

    // ---- Team page /myoffice/users (users-page.js). Read only. ----

    // Every account, most recently active first, with its previews, orders and visits counted.
    allUsers: (limit = 2000) => db.prepare(`SELECT * FROM (
        SELECT u.email, u.created_at, u.last_login_at,
          (SELECT count(*) FROM preview_requests p WHERE p.email = u.email) AS previews,
          (SELECT count(*) FROM preview_requests p WHERE p.email = u.email AND p.status = 'requested') AS open_previews,
          (SELECT count(*) FROM orders o WHERE o.email = u.email) AS orders,
          (SELECT coalesce(sum(amount_cents), 0) FROM orders o WHERE o.email = u.email) AS paid_cents,
          (SELECT max(currency) FROM orders o WHERE o.email = u.email) AS currency,
          (SELECT count(*) FROM visits v WHERE v.account_email = u.email) AS views,
          (SELECT max(created_at) FROM visits v WHERE v.account_email = u.email) AS last_seen_at
        FROM users u)
      ORDER BY max(coalesce(last_login_at, 0), coalesce(last_seen_at, 0), created_at) DESC LIMIT ?`).all(limit).map(plain),
    userByEmail: (email) => plain(db.prepare('SELECT * FROM users WHERE email = ?').get(email)),
    mailTo: (email, limit = 100) => db.prepare('SELECT * FROM mail_log WHERE to_email = ? ORDER BY id DESC LIMIT ?').all(email, limit).map(plain),
    activeSessions: (email, now) => db.prepare('SELECT count(*) AS n FROM sessions WHERE email = ? AND expires_at >= ?').get(email, now).n,

    // ---- Operator tools (ops.js). Read only: the statement runs with query_only on, so nothing can be changed. ----
    tables: () => db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()
      .map((t) => ({ name: t.name, rows: db.prepare(`SELECT count(*) AS n FROM ${quoteIdent(t.name)}`).get().n })),
    columns: (table) => db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all()
      .map((c) => ({ name: c.name, type: c.type, pk: c.pk > 0 })),
    readSql: (text, params = []) => {
      db.exec('PRAGMA query_only = ON');
      try {
        return db.prepare(text).all(...params).map(plain);
      } finally {
        db.exec('PRAGMA query_only = OFF');
      }
    },
  };
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}
