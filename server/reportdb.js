// Read-only access to the company-diver report database (Postgres), where the report factory keeps its reports.
// Contract and rules: docs/report-display.md. The factory owns these tables; this file only ever SELECTs.
//
//   v21_report       one row per report: company, country, industry, website, created_at (the title and card)
//   v21_deeper_run   one row per full-report run: status, stage, report_html (the finished page)
//
// Never read here: v21_raw, v21_deeper_lane, and the run's log, error, blocked_html, gate_failures (internal).
// report_html can be several MB, so it is read on its own, for one run, only when it is about to be shown.

import pg from 'pg';

// `query(text, params)` is injectable so tests need no database. Without it a pool is opened on `url`, and every
// connection is set read-only at the database, so even a full-access login cannot change a v21_ table from here.
export function createReportDb({ url, query } = {}) {
  let pool;
  const getPool = () => {
    pool ??= new pg.Pool({
      connectionString: url, max: 3, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, statement_timeout: 20_000,
      options: '-c default_transaction_read_only=on',
    });
    return pool;
  };
  const run = query ?? ((text, params) => getPool().query(text, params));

  return {
    configured: Boolean(query || url),
    close: () => pool?.end(),

    // Operator query (ops.js): ONE statement, inside a READ ONLY transaction, so nothing can change even on a
    // full-access login. Returns the rows.
    async readSql(text, params = []) {
      if (query) return (await query(text, params)).rows;
      const client = await getPool().connect();
      try {
        await client.query('BEGIN READ ONLY');
        const out = await client.query(text, params);
        await client.query('COMMIT');
        return out.rows;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },

    // The card for a report: { company, country, industry, website, created_at }, or null when there is no such report.
    async card(reportId) {
      const out = await run(
        'select company, country, industry, website, created_at from v21_report where report_id = $1', [reportId]);
      return out.rows[0] ?? null;
    },

    // Every run of the report, newest first, WITHOUT the page itself. `has_html` says whether a page is stored.
    async runs(reportId) {
      const out = await run(
        `select run_id, status, stage, created_at, finished_at, (report_html is not null and report_html <> '') as has_html
           from v21_deeper_run where report_id = $1 order by created_at desc limit 20`, [reportId]);
      return out.rows;
    },

    // What the free preview is drawn from (owner, 2026-11-12: the site draws it itself with preview-template/):
    // the newest written 'report' row of the report, and the Step 2 'result' row it points at. { report, s2 } or null.
    // These are the only two v21_raw rows read; never the raw research, the judge answers or the log.
    async previewData(reportId) {
      const r = await run(
        `select payload from v21_raw where report_id = $1 and kind = 'report' and status in ('ok', 'blocked', 'failed') order by id desc limit 1`, [reportId]);
      const report = r.rows[0]?.payload;
      const s2Id = Number(report?.step2_row_id);
      if (!report || !Number.isFinite(s2Id)) return null;
      const s2 = await run(`select payload from v21_raw where report_id = $1 and id = $2`, [reportId, s2Id]);
      return s2.rows[0]?.payload ? { report, s2: s2.rows[0].payload } : null;
    },

    // The full-report price for the preview's order button, e.g. "$59". null when it is not set or cannot be read.
    async price() {
      const out = await run(`select value from hub_setting where key = 'full_report_price'`);
      const raw = String(out.rows[0]?.value ?? '').replace(/^\s*\$/, '').trim();
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n <= 0) return null;
      return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
    },

    // ---- Team lists (/myoffice/reports/*). The owner asked for a page listing every report (2026-11-12). ----

    // Every report, newest first, with whether its free preview has been written (same rows previewData reads).
    async allReports(limit = 2000) {
      const out = await run(
        `select r.report_id, r.company, r.country, r.industry, r.website, r.created_at,
                exists (select 1 from v21_raw w where w.report_id = r.report_id and w.kind = 'report'
                        and w.status in ('ok', 'blocked', 'failed')) as has_preview
           from v21_report r order by r.created_at desc nulls last limit $1`, [limit]);
      return out.rows;
    },

    // Every full-report run, newest first, WITHOUT the page itself, with the report's card. Grouped by the caller.
    async allRuns(limit = 3000) {
      const out = await run(
        `select d.report_id, d.run_id, d.status, d.stage, d.created_at, d.finished_at,
                (d.report_html is not null and d.report_html <> '') as has_html,
                r.company, r.country, r.industry, r.website
           from v21_deeper_run d left join v21_report r on r.report_id = d.report_id
          order by d.created_at desc nulls last limit $1`, [limit]);
      return out.rows;
    },

    // The finished page of one run of this report, exactly as stored. null when there is none.
    async html(reportId, runId) {
      const out = await run('select report_html from v21_deeper_run where run_id = $1 and report_id = $2', [runId, reportId]);
      const html = out.rows[0]?.report_html;
      return typeof html === 'string' && html.length ? html : null;
    },
  };
}
