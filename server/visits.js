// Visitor analytics, built in (no third party). Owner decision 2026-11-12: record each page view with IP, location,
// device and time on page.
//
// How it works:
//   1. Every HTML page the server sends (GET, any status, labelled with it) is recorded as one row in `visits` at the moment it is sent:
//      IP, location (local GeoIP file, geo.js), browser / OS / device (from the user agent), referrer, page, and the
//      signed-in account if any. So a visitor whose browser runs no script is still counted.
//   2. A small inline script is added before </body>. It sends a beacon to POST /api/v on load (screen, language,
//      time zone, a visitor id kept in localStorage) and again when the page is hidden or closed, with the time the
//      page was visible (active time on page).
//
// No kill gates: nothing here can stop or change a page except adding the script. Every step is wrapped; a problem
// is logged and the page goes out as it was. Bots are recorded and labelled, not dropped.
// Not recorded: /myoffice pages, /api, and the sandboxed report frame (it has its own security policy).
// The stored full report (/r/<id>) is recorded without the script: it must be sent exactly as stored, so its time
// on page is not measured.

import crypto from 'node:crypto';

const MAX_MS = 24 * 3600 * 1000; // a time on page above a day is a broken clock: clamp it
const SECRET_PARAM = /token|secret|key|password|session|code|sig/i; // never stored from a URL query

export function openVisits(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      view_id TEXT NOT NULL UNIQUE,
      visitor_id TEXT,
      account_email TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      path TEXT,
      title TEXT,
      referrer TEXT,
      referrer_host TEXT,
      ip TEXT,
      country TEXT,
      country_code TEXT,
      region TEXT,
      city TEXT,
      lat REAL,
      lon REAL,
      ua TEXT,
      browser TEXT,
      os TEXT,
      device TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0,
      screen TEXT,
      lang TEXT,
      tz TEXT,
      active_ms INTEGER,
      js INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS visits_created ON visits (created_at);
    CREATE INDEX IF NOT EXISTS visits_visitor ON visits (visitor_id);
    CREATE INDEX IF NOT EXISTS visits_ip ON visits (ip);
  `);
  // Added later: page_key (the page without its query, one key per page: /p/<report id>) and scroll depth.
  const cols = new Set(db.prepare('PRAGMA table_info(visits)').all().map((c) => c.name));
  if (!cols.has('page_key')) db.exec('ALTER TABLE visits ADD COLUMN page_key TEXT');
  if (!cols.has('scroll_pct')) db.exec('ALTER TABLE visits ADD COLUMN scroll_pct INTEGER');
  if (!cols.has('status')) db.exec('ALTER TABLE visits ADD COLUMN status INTEGER'); // HTTP status of the page sent
  db.exec('CREATE INDEX IF NOT EXISTS visits_page ON visits (page_key, created_at)');
  for (const r of db.prepare('SELECT id, path FROM visits WHERE page_key IS NULL').all()) {
    db.prepare('UPDATE visits SET page_key = ? WHERE id = ?').run(pageKey(String(r.path ?? '/').split('?')[0]), r.id);
  }
  const insert = db.prepare(`INSERT INTO visits (view_id, visitor_id, account_email, created_at, last_seen_at, path, title, referrer,
    referrer_host, ip, country, country_code, region, city, lat, lon, ua, browser, os, device, is_bot, page_key, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(view_id) DO NOTHING`);
  const byView = db.prepare('SELECT id, os, device, active_ms, scroll_pct FROM visits WHERE view_id = ?');
  const beacon = db.prepare(`UPDATE visits SET visitor_id = coalesce(?, visitor_id), screen = coalesce(?, screen), lang = coalesce(?, lang),
    tz = coalesce(?, tz), title = coalesce(?, title), active_ms = ?, scroll_pct = ?, last_seen_at = ?, os = ?, device = ?, js = 1 WHERE id = ?`);

  // Filters for the team page. Every value is a bound parameter.
  function where(f = {}) {
    const parts = ['created_at >= ?'];
    const args = [Number(f.since) || 0];
    if (f.ip) { parts.push('ip = ?'); args.push(String(f.ip)); }
    if (f.visitor) { parts.push('visitor_id = ?'); args.push(String(f.visitor)); }
    if (f.path) { parts.push('path = ?'); args.push(String(f.path)); }
    if (f.page) { parts.push('page_key = ?'); args.push(String(f.page)); }
    if (f.prefix) { parts.push('substr(page_key, 1, ?) = ?'); args.push(String(f.prefix).length, String(f.prefix)); }
    if (f.humans) parts.push('is_bot = 0');
    // One account: its signed-in views, plus every view from the same browsers (also before it signed in).
    if (f.account) {
      parts.push('(account_email = ? OR visitor_id IN (SELECT visitor_id FROM visits WHERE account_email = ? AND visitor_id IS NOT NULL))');
      args.push(String(f.account), String(f.account));
    }
    return { sql: parts.join(' AND '), args };
  }
  const WHO = "coalesce(visitor_id, ip || '|' || coalesce(ua, ''))"; // one browser
  const q = (t) => WHO.replace(/visitor_id|ip|ua/g, `${t}.$&`); // WHO, for a named table
  const GROUPS = { page: 'page_key', path: 'path', country: 'country', device: 'device', browser: 'browser', os: 'os', referrer: 'referrer_host', city: "city || ', ' || coalesce(country_code, '')" };

  return {
    record(v) {
      insert.run(v.viewId, v.visitorId ?? null, v.accountEmail ?? null, v.at, v.at, v.path ?? null, v.title ?? null, v.referrer ?? null,
        v.referrerHost ?? null, v.ip ?? null, v.country ?? null, v.countryCode ?? null, v.region ?? null, v.city ?? null,
        v.lat ?? null, v.lon ?? null, v.ua ?? null, v.browser ?? null, v.os ?? null, v.device ?? null, v.isBot ? 1 : 0, v.pageKey ?? null, v.status ?? null);
    },
    // Returns false when the view id is unknown (nothing to update).
    beacon(viewId, b, at) {
      const row = byView.get(viewId);
      if (!row) return false;
      let { os, device } = row;
      // iPads say "Macintosh" in their user agent; a touch screen gives them away.
      if (os === 'macOS' && b.touch > 1) { os = 'iPadOS'; device = 'tablet'; }
      const ms = Math.max(row.active_ms ?? 0, b.ms ?? 0);
      const scroll = b.scroll == null ? row.scroll_pct : Math.max(row.scroll_pct ?? 0, b.scroll);
      beacon.run(b.visitorId ?? null, b.screen ?? null, b.lang ?? null, b.tz ?? null, b.title ?? null, ms, scroll ?? null, at, os, device, row.id);
      return true;
    },
    summary(f) {
      const w = where(f);
      return { ...db.prepare(`SELECT count(*) AS views,
          count(DISTINCT ${WHO}) AS visitors,
          avg(scroll_pct) AS avg_scroll,
          coalesce(sum(is_bot), 0) AS bots,
          coalesce(sum(js), 0) AS with_js,
          avg(CASE WHEN active_ms > 0 THEN active_ms END) AS avg_ms,
          coalesce(sum(active_ms), 0) AS total_ms,
          min(created_at) AS first_at, max(created_at) AS last_at
        FROM visits WHERE ${w.sql}`).get(...w.args) };
    },
    top(f, group, limit = 10) {
      const col = GROUPS[group];
      if (!col) return [];
      const w = where(f);
      return db.prepare(`SELECT ${col} AS k, count(*) AS n, avg(CASE WHEN active_ms > 0 THEN active_ms END) AS avg_ms
        FROM visits WHERE ${w.sql} GROUP BY 1 ORDER BY n DESC LIMIT ?`).all(...w.args, limit).map((r) => ({ ...r }));
    },
    // One row per page (page_key): views, visitors, time, scroll, last visit. Most viewed first.
    pages(f, limit = 1000) {
      const w = where(f);
      return db.prepare(`SELECT page_key AS page, count(*) AS views, count(DISTINCT ${WHO}) AS visitors,
          coalesce(sum(is_bot), 0) AS bots, avg(CASE WHEN active_ms > 0 THEN active_ms END) AS avg_ms,
          coalesce(sum(active_ms), 0) AS total_ms, avg(scroll_pct) AS avg_scroll,
          min(created_at) AS first_at, max(created_at) AS last_at,
          (SELECT title FROM visits t WHERE t.page_key = visits.page_key AND t.title IS NOT NULL ORDER BY t.id DESC LIMIT 1) AS title
        FROM visits WHERE ${w.sql} GROUP BY page_key ORDER BY views DESC, last_at DESC LIMIT ?`).all(...w.args, limit).map((r) => ({ ...r }));
    },
    // One row per visitor (browser) within the filter: who they are, how often, how long, how far they scrolled.
    people(f, limit = 300) {
      const w = where(f);
      return db.prepare(`SELECT ${WHO} AS who, max(visitor_id) AS visitor_id, count(*) AS views,
          coalesce(sum(active_ms), 0) AS total_ms, max(scroll_pct) AS max_scroll,
          min(created_at) AS first_at, max(created_at) AS last_at, max(is_bot) AS is_bot,
          group_concat(DISTINCT ip) AS ips, max(account_email) AS account_email,
          (SELECT city || ', ' || coalesce(country_code, '') FROM visits l WHERE ${q('l')} = ${q('visits')} AND l.city IS NOT NULL ORDER BY l.id DESC LIMIT 1) AS place,
          max(device) AS device, max(os) AS os, max(browser) AS browser
        FROM visits WHERE ${w.sql} GROUP BY 1 ORDER BY last_at DESC LIMIT ?`).all(...w.args, limit).map((r) => ({ ...r }));
    },
    // For a referrer's own tracker page (referrals.js): views of preview pages that are theirs, never their own visits.
    //   keys  page keys (/p/<report id>) of the previews they asked for: every view of those counts.
    //   code  their referral code: views of any other preview that arrived through a link carrying ?ref=<code> also count.
    // Their own browsers are left out (signed in as them, or the same browser id as one of their signed-in visits).
    // Bots stay in, flagged, so the page can say "only a chat app fetched it". Returns the rows with the IP removed.
    referrerViews({ email, code, keys = [], limit = 3000 }) {
      const own = [...new Set(keys.map((k) => pageKey(k)))];
      const marks = own.length ? own.map(() => '?').join(',') : "''";
      const rows = db.prepare(`SELECT id, page_key, path, created_at, last_seen_at, country, country_code, city, device, os, browser, is_bot,
          active_ms, scroll_pct, js, visitor_id, referrer_host, status
        FROM visits
        WHERE page_key LIKE '/p/%' AND (status IS NULL OR status = 200)
          AND (page_key IN (${marks}) OR path LIKE ?)
          AND coalesce(account_email, '') <> ?
          AND (visitor_id IS NULL OR visitor_id NOT IN (SELECT visitor_id FROM visits WHERE account_email = ? AND visitor_id IS NOT NULL))
        ORDER BY id DESC LIMIT ?`).all(...own, `%ref=${code ?? '\u0000'}%`, String(email), String(email), limit);
      const mine = new Set(own);
      const via = new RegExp(`[?&]ref=${String(code ?? '').replace(/[^a-z0-9]/gi, '')}(?:&|$)`);
      return rows.filter((r) => mine.has(r.page_key) || (code && via.test(String(r.path ?? '')))).map((r) => ({ ...r }));
    },

    // Newest first. `before`: an id, for the next page.
    log(f, { before, limit = 100 } = {}) {
      const w = where(f);
      const extra = before ? ' AND id < ?' : '';
      return db.prepare(`SELECT * FROM visits WHERE ${w.sql}${extra} ORDER BY id DESC LIMIT ?`)
        .all(...w.args, ...(before ? [Number(before)] : []), limit).map((r) => ({ ...r }));
    },
  };
}

// One key per page: the path without its query or a trailing slash. Report ids are lower case, so /P/ABC = /p/abc.
export function pageKey(pathname) {
  let p = String(pathname ?? '/').replace(/\/+$/, '') || '/';
  if (/^\/(p|r)\/[0-9a-f-]{36}/i.test(p)) p = p.toLowerCase();
  return p.slice(0, 300);
}

// ---- User agent -> browser, OS, device. Small on purpose; the raw string is kept on every row. ----

export function parseUA(ua) {
  const s = String(ua ?? '');
  const isBot = !s || /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|python|curl|wget|httpclient|go-http|axios|node-fetch|okhttp|java\/|monitor|uptime|scan/i.test(s);
  let os = 'Other';
  if (/Windows/.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';
  const browsers = [
    ['Facebook app', /FBAN|FBAV/], ['Instagram app', /Instagram/], ['WhatsApp', /WhatsApp/], ['LinkedIn app', /LinkedInApp/],
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/], ['Opera', /(?:OPR|Opera)\/(\d+)/], ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['Chrome', /(?:CriOS|Chrome)\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/],
  ];
  let browser = isBot ? 'Bot' : 'Other';
  for (const [name, re] of browsers) {
    const m = re.exec(s);
    if (m) { browser = m[1] ? `${name} ${m[1]}` : name; break; }
  }
  if (isBot) browser = (/([A-Za-z-]*(?:bot|crawler|spider)[A-Za-z-]*)/i.exec(s)?.[1] ?? s.split(/[\s/;]/)[0] ?? 'Bot').slice(0, 40) || 'Bot';
  let device = 'desktop';
  if (isBot) device = 'bot';
  else if (/iPad|Tablet/i.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android/.test(s)) device = 'mobile';
  return { browser, os, device, isBot };
}

// ---- The page hook and the beacon endpoint ----

const clip = (v, max) => (v == null ? null : String(v).replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max) || null);

// The visitor's IP. Railway's proxy puts the client first in x-forwarded-for.
export function clientIp(req) {
  const raw = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || String(req.headers['x-real-ip'] ?? '').trim() || req.socket?.remoteAddress || '';
  return raw.replace(/^::ffff:/, '').slice(0, 64);
}

// The page address to store: path plus query, without anything that looks like a secret (sign-in tokens etc).
export function safePath(url) {
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) q.append(k, SECRET_PARAM.test(k) ? '(hidden)' : v);
  const s = q.toString();
  return clip(url.pathname + (s ? `?${s}` : ''), 500);
}

function refInfo(header, ownHost) {
  const ref = clip(header, 500);
  if (!ref) return { referrer: null, referrerHost: null };
  try {
    const u = new URL(ref);
    if (u.host === ownHost) return { referrer: clip(u.pathname + u.search, 500), referrerHost: '(this site)' };
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, '(hidden)');
    return { referrer: clip(u.href, 500), referrerHost: u.host.replace(/^www\./, '') };
  } catch { return { referrer: ref, referrerHost: null }; }
}

// The script added to each page. `v` is this page view's id. Plain ES5, wrapped so it can never break the page.
function script(viewId) {
  return `<script>(function(){try{var v=${JSON.stringify(viewId)},d=document,n=navigator,id=null,t=0,s=d.visibilityState==="visible"?Date.now():0;
try{id=localStorage.getItem("mm_vid");if(!id){id=Date.now().toString(36)+Math.random().toString(36).slice(2,10);localStorage.setItem("mm_vid",id)}}catch(e){}
function acc(){if(s){t+=Date.now()-s;s=d.visibilityState==="visible"?Date.now():0}}
var sc=0;function scr(){try{var e=d.documentElement,h=Math.max(e.scrollHeight,d.body?d.body.scrollHeight:0);var p=h>0?Math.min(100,Math.round(100*((window.pageYOffset||e.scrollTop)+window.innerHeight)/h)):100;if(p>sc)sc=p}catch(e){}}
addEventListener("scroll",scr,{passive:true});scr();
function send(){try{var tz="";try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone}catch(e){}
var b=JSON.stringify({v:v,vid:id,ms:t,sc:sc,sw:screen.width,sh:screen.height,tp:n.maxTouchPoints||0,lang:n.language,tz:tz,title:d.title});
if(n.sendBeacon&&n.sendBeacon("/api/v",b))return;fetch("/api/v",{method:"POST",body:b,keepalive:true})["catch"](function(){})}catch(e){}}
d.addEventListener("visibilitychange",function(){if(d.visibilityState==="hidden"){acc();s=0;send()}else{s=Date.now()}});
addEventListener("pagehide",function(){acc();send()});send()}catch(e){}})();</script>`;
}

export function addScript(html, viewId) {
  const tag = script(viewId);
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}

const SKIP = /^\/(myoffice|api)(\/|$)/;

export function createTracker({ visits, geo, currentEmail = () => null, now = Date.now, log = console.log }) {
  const lookup = (ip) => { try { return geo?.lookup(ip) ?? {}; } catch { return {}; } };

  function record(req, url, status) {
    const viewId = crypto.randomBytes(12).toString('base64url');
    try {
      const ua = clip(req.headers['user-agent'], 400);
      const ip = clientIp(req);
      let email = null;
      try { email = currentEmail(req); } catch { /* not signed in, or no session table: leave empty */ }
      visits.record({
        viewId, at: now(), accountEmail: email, path: safePath(url), pageKey: pageKey(url.pathname), status, ip, ua, ...parseUA(ua), ...lookup(ip),
        ...refInfo(req.headers.referer, req.headers['x-forwarded-host'] ?? req.headers.host),
      });
    } catch (e) { log(`visits: could not record a page view: ${e.message}`); }
    return viewId;
  }

  return {
    // Hooks one response: if it turns out to be a full HTML page, the view is recorded and the script added.
    // Never throws, and never changes anything else about the response.
    wrap(req, res, url) {
      try {
        if (req.method !== 'GET' || SKIP.test(url.pathname)) return;
        const writeHead = res.writeHead;
        const end = res.end;
        let html = false;
        let code = null;
        res.writeHead = function (status, ...rest) {
          try {
            const headers = (typeof rest[0] === 'string' ? rest[1] : rest[0]) ?? {};
            const h = {};
            for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
            const type = String(h['content-type'] ?? res.getHeader('content-type') ?? '');
            code = Number(status) || null;
            // Every HTML page counts, whatever its status: a preview not written yet (404) is still someone opening the link.
            // Not a page view: the browser fetching something else (an icon, an image) that got an HTML error page.
            const dest = String(req.headers['sec-fetch-dest'] ?? '');
            const notPage = (dest && dest !== 'document') || (code !== 200 && /\.[a-z0-9]{2,5}$/i.test(url.pathname));
            html = !notPage && /text\/html/i.test(type) && !h['content-security-policy'] && !h['content-encoding'] && !h['content-length'];
          } catch { html = false; }
          return writeHead.call(this, status, ...rest);
        };
        res.end = function (body, ...rest) {
          if (html && body != null && typeof body !== 'function') {
            try {
              const viewId = record(req, url, code);
              // A page that must go out exactly as stored (the full report) is recorded but not changed.
              if (!res.asStored) body = addScript(Buffer.isBuffer(body) ? body.toString('utf8') : String(body), viewId);
            } catch (e) { log(`visits: could not add the script: ${e.message}`); }
          }
          return end.call(this, body, ...rest);
        };
      } catch (e) { log(`visits: could not hook the response: ${e.message}`); }
    },

    // POST /api/v. Always answers 204; a bad beacon is logged and ignored (it is a browser's report, not a page).
    async beacon(req, res, readBody) {
      try {
        const b = JSON.parse((await readBody(req)) || '{}');
        const viewId = typeof b.v === 'string' && /^[A-Za-z0-9_-]{8,32}$/.test(b.v) ? b.v : null;
        if (viewId) {
          const sw = Number(b.sw), sh = Number(b.sh);
          const ms = Math.min(Math.max(Math.round(Number(b.ms) || 0), 0), MAX_MS);
          const known = visits.beacon(viewId, {
            visitorId: typeof b.vid === 'string' && /^[a-z0-9]{6,40}$/i.test(b.vid) ? b.vid : null,
            screen: sw > 0 && sh > 0 && sw < 20000 && sh < 20000 ? `${Math.round(sw)}x${Math.round(sh)}` : null,
            lang: clip(b.lang, 35), tz: clip(b.tz, 64), title: clip(b.title, 200),
            touch: Number(b.tp) || 0, ms,
            scroll: Number.isFinite(Number(b.sc)) && b.sc != null ? Math.min(Math.max(Math.round(Number(b.sc)), 0), 100) : null,
          }, now());
          if (!known) log(`visits: beacon for an unknown page view ${viewId}`);
        }
      } catch (e) { log(`visits: unreadable beacon: ${e.message}`); }
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
    },
  };
}
