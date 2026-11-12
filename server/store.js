// The website's own small database (SQLite, built into Node): accounts, magic links, sessions, paid orders
// and the log of every email we tried to send. One file, DATA_DIR/mirrormirror.db. Use ':memory:' in tests.
//
// An account is just an email address. There are no passwords.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { openVisits } from './visits.js';
import { newCode, cleanCode, commissionFromSetting, COMMISSION_KEY, COMMISSION_DEFAULT_CENTS, COMMISSION_CURRENCY } from './referrals.js';

export const MAX_START_ATTEMPTS = 3; // times the site tries to start one request on the factory
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

  // Where each request stands on the report factory: its report id once the site has started it there (this is the exact
  // link between a request and v21_report), how many starts failed, the last error, and when it was started.
  for (const [col, type] of [['factory_report_id', 'TEXT'], ['factory_attempts', 'INTEGER NOT NULL DEFAULT 0'], ['factory_error', 'TEXT'], ['factory_started_at', 'INTEGER']]) {
    if (!db.prepare('PRAGMA table_info(preview_requests)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE preview_requests ADD COLUMN ${col} ${type}`);
  }

  // Referral program (docs/referrals.md). Any account can refer: it gets a referral code on first use, and can save a
  // USDT wallet to be paid to. `settings` holds numbers the owner changes without a deploy (the commission per sold
  // report). A commission is one row per sold order, made when the payment arrives; its amount is fixed at that moment.
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS referral_commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE,
      referrer_email TEXT NOT NULL,
      buyer_email TEXT,
      report_id TEXT,
      company TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL,
      note TEXT,
      source TEXT,
      created_at INTEGER NOT NULL,
      paid_at INTEGER,
      paid_network TEXT,
      paid_wallet TEXT,
      paid_tx TEXT
    );
    CREATE INDEX IF NOT EXISTS referral_commissions_referrer ON referral_commissions (referrer_email);
    -- One row per checkout started for a report: was a referrer detected, who, and how. Written when the checkout is
    -- created (before any payment), so a checkout that is never paid is on record too. detected = 0 means no referrer.
    CREATE TABLE IF NOT EXISTS checkout_referrals (
      stripe_session_id TEXT PRIMARY KEY,
      report_id TEXT,
      company TEXT,
      buyer_email TEXT,
      detected INTEGER NOT NULL DEFAULT 0,
      referrer_code TEXT,
      referrer_email TEXT,
      source TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS checkout_referrals_created ON checkout_referrals (created_at);
  `);
  for (const [col, type] of [['referral_code', 'TEXT'], ['payout_network', 'TEXT'], ['payout_wallet', 'TEXT'], ['payout_updated_at', 'INTEGER']]) {
    if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code ON users (referral_code)');

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
    previewStarted: q('UPDATE preview_requests SET factory_report_id = ?, factory_started_at = ?, factory_error = NULL WHERE id = ?'),
    previewStartFailed: q('UPDATE preview_requests SET factory_attempts = factory_attempts + ?, factory_error = ? WHERE id = ?'),
    previewsToStart: q("SELECT * FROM preview_requests WHERE status = 'requested' AND factory_report_id IS NULL AND factory_attempts < ? ORDER BY created_at, id LIMIT ?"),
    previewsAhead: q("SELECT count(*) AS n FROM preview_requests WHERE status = 'requested' AND (created_at < ? OR (created_at = ? AND id < ?))"),
    userByEmail: q('SELECT * FROM users WHERE email = ?'),
    userByCode: q('SELECT email FROM users WHERE referral_code = ?'),
    setReferralCode: q('UPDATE users SET referral_code = ? WHERE email = ? AND referral_code IS NULL'),
    getSetting: q('SELECT value FROM settings WHERE key = ?'),
    putSetting: q('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'),
    putWallet: q('UPDATE users SET payout_network = ?, payout_wallet = ?, payout_updated_at = ? WHERE email = ?'),
    insertCheckoutReferral: q(`INSERT OR IGNORE INTO checkout_referrals (stripe_session_id, report_id, company, buyer_email, detected, referrer_code, referrer_email, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    checkoutReferral: q('SELECT * FROM checkout_referrals WHERE stripe_session_id = ?'),
    commissionByOrder: q('SELECT * FROM referral_commissions WHERE order_id = ?'),
    commissionById: q('SELECT * FROM referral_commissions WHERE id = ?'),
    insertCommission: q(`INSERT OR IGNORE INTO referral_commissions (order_id, referrer_email, buyer_email, report_id, company, amount_cents, currency, status, note, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    commissionsByReferrer: q('SELECT * FROM referral_commissions WHERE referrer_email = ? ORDER BY created_at DESC, id DESC'),
    allCommissions: q("SELECT * FROM referral_commissions ORDER BY (status IN ('pending', 'held')) DESC, created_at DESC, id DESC LIMIT ?"),
    payCommission: q("UPDATE referral_commissions SET status = 'paid', paid_at = ?, paid_network = ?, paid_wallet = ?, paid_tx = ? WHERE id = ?"),
    statusCommission: q('UPDATE referral_commissions SET status = ?, note = ? WHERE id = ?'),
    requesterOfReport: q("SELECT email FROM preview_requests WHERE lower(report_id) = ? OR lower(factory_report_id) = ? ORDER BY id LIMIT 1"),
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
    markPreviewStarted: (id, reportId, now) => { s.previewStarted.run(String(reportId), now, id); },
    // `by` = how many attempts to count (use MAX_START_ATTEMPTS to stop retrying a request that can never start).
    markPreviewStartFailed: (id, error, by = 1) => { s.previewStartFailed.run(by, String(error).slice(0, 300), id); },
    previewsToStart: (limit = 3) => s.previewsToStart.all(MAX_START_ATTEMPTS, limit).map(plain),
    // How many open requests (any account) were asked before this one: its place in line.
    previewsAhead: (p) => s.previewsAhead.get(p.created_at, p.created_at, p.id).n,
    markPreviewReady: (id, reportId, now) => {
      const rid = String(reportId).toLowerCase();
      s.previewReady.run(rid, rid, now, id);
      return plain(s.previewById.get(id));
    },
    allPreviews: (limit = 300) => s.allPreviews.all(limit).map(plain), // open requests first, then newest
    markPreviewReadyEmailed: (id, now) => { s.previewReadyEmailed.run(now, id); },

    // ---- Referral program (referrals.js, docs/referrals.md) ----

    // The account's referral code. Made on first use; null only when the account does not exist.
    referralCode: (email) => {
      const row = s.userByEmail.get(email);
      if (!row) return null;
      if (row.referral_code) return row.referral_code;
      for (let i = 0; i < 8; i += 1) {
        try { s.setReferralCode.run(newCode(8), email); break; } catch { /* the code is taken: try another */ }
      }
      return s.userByEmail.get(email)?.referral_code ?? null;
    },
    emailForReferralCode: (code) => {
      const c = cleanCode(code);
      return c ? (s.userByCode.get(c)?.email ?? null) : null;
    },
    getSetting: (key) => s.getSetting.get(key)?.value ?? null,
    setSetting: (key, value, now) => { s.putSetting.run(key, String(value), now); },
    // Commission per sold report, in cents. Never throws: a missing or bad value is the default.
    commissionCents: () => { try { return commissionFromSetting(s.getSetting.get(COMMISSION_KEY)?.value ?? null); } catch { return COMMISSION_DEFAULT_CENTS; } },

    payoutWallet: (email) => {
      const u = s.userByEmail.get(email);
      return u?.payout_wallet ? { network: u.payout_network, address: u.payout_wallet, updatedAt: u.payout_updated_at } : null;
    },
    setPayoutWallet: (email, network, address, now) => { s.putWallet.run(network, address, now, email); },
    clearPayoutWallet: (email) => { s.putWallet.run(null, null, null, email); },

    // Safe to call twice for one order: the second call returns the commission that is already there.
    // -> { commission, created }
    recordCommission: (c) => {
      const before = s.commissionByOrder.get(c.orderId);
      if (before) return { commission: plain(before), created: false };
      s.insertCommission.run(c.orderId, c.referrerEmail, c.buyerEmail ?? null, c.reportId ?? null, c.company ?? null, c.amountCents,
        c.currency ?? COMMISSION_CURRENCY, c.status, c.note ?? null, c.source ?? null, c.now);
      return { commission: plain(s.commissionByOrder.get(c.orderId)), created: true };
    },
    // The referrer found when a checkout was created (or none). c: { sessionId, reportId, company, buyerEmail, code, referrerEmail, source, now }
    recordCheckoutReferral: (c) => {
      s.insertCheckoutReferral.run(c.sessionId, c.reportId ?? null, c.company ?? null, c.buyerEmail ?? null, c.code ? 1 : 0,
        c.code ?? null, c.referrerEmail ?? null, c.source ?? null, c.now);
    },
    checkoutReferral: (sessionId) => plain(s.checkoutReferral.get(sessionId)),
    // Newest checkouts first, with whether each was paid and whether it produced a commission. For the team page.
    recentCheckouts: (limit = 100) => db.prepare(`SELECT k.*, o.id AS order_id, o.paid_at, c.status AS commission_status
        FROM checkout_referrals k
        LEFT JOIN orders o ON o.stripe_session_id = k.stripe_session_id
        LEFT JOIN referral_commissions c ON c.order_id = o.id
        ORDER BY k.created_at DESC LIMIT ?`).all(limit).map(plain),
    commissionById: (id) => plain(s.commissionById.get(id)),
    commissionsFor: (email) => s.commissionsByReferrer.all(email).map(plain),
    allCommissions: (limit = 500) => s.allCommissions.all(limit).map(plain),
    // The team's decisions on one commission. Each returns the updated row, or null when there is no such commission.
    markCommissionPaid: (id, { network, wallet, tx }, now) => {
      s.payCommission.run(now, network ?? null, wallet ?? null, tx ?? null, id);
      return plain(s.commissionById.get(id));
    },
    setCommissionStatus: (id, status, note) => {
      s.statusCommission.run(status, note ?? null, id);
      return plain(s.commissionById.get(id));
    },
    // One row per referrer: what they are owed, what was paid, and their wallet. For the team page.
    referrerTotals: () => db.prepare(`SELECT c.referrer_email AS email,
        count(*) AS sales,
        coalesce(sum(CASE WHEN c.status = 'pending' THEN c.amount_cents END), 0) AS pending_cents,
        coalesce(sum(CASE WHEN c.status = 'held' THEN c.amount_cents END), 0) AS held_cents,
        coalesce(sum(CASE WHEN c.status = 'paid' THEN c.amount_cents END), 0) AS paid_cents,
        u.payout_network, u.payout_wallet
      FROM referral_commissions c LEFT JOIN users u ON u.email = c.referrer_email
      GROUP BY c.referrer_email ORDER BY pending_cents DESC, c.referrer_email`).all().map(plain),
    // The account that asked for a preview of this report: who a plain /p/<id> link is credited to when it carries no ref.
    previewRequester: (reportId) => {
      const id = String(reportId ?? '').toLowerCase();
      return id ? (s.requesterOfReport.get(id, id)?.email ?? null) : null;
    },

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
