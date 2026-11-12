// Shows company-diver reports (docs/report-display.md).
//
//   GET /p/{report_id}          the free preview: drawn here from the database rows with preview-template/ (the factory's
//                               template, exported); if that cannot be done, the factory's public page. Anyone with the link.
//   GET /r/{report_id}          the full report: the stored page. Public: anyone with the link (owner, 2026-11-12).
//   GET /r/{report_id}/raw      the stored page alone (what the frame on /r/ loads). Public too.
//
// A report that exists is always shown, with a plain label when something is odd. Nothing here hides one.

import * as view from './report-pages.js';
import { reportPage } from './preview-template/page.js';

export const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox';

const LABELS = {
  incomplete: 'Some parts of this report could not be completed.',
  olderBuilding: 'A newer version of this report is being prepared. You are seeing the last finished version.',
  olderFailed: 'A newer version of this report could not be completed. You are seeing the last finished version.',
};

// Which run to show, from the run list (newest first, no page bodies). Pure, so it is easy to test.
//   { kind: 'none' }                      no run yet
//   { kind: 'report', run, label }        show run's stored page; label is a line to put above it, or null
//   { kind: 'progress', run }             queued or running, nothing to show yet
//   { kind: 'failed', run }               failed, nothing to show
//   { kind: 'unknown', run }              a status we do not know, nothing to show
export function chooseView(runs) {
  const newest = runs?.[0];
  if (!newest) return { kind: 'none' };
  if (newest.has_html) {
    if (newest.status === 'done') return { kind: 'report', run: newest, label: null };
    if (newest.status === 'incomplete') return { kind: 'report', run: newest, label: LABELS.incomplete };
    // A page is stored but the status is not a finished one: show the page, say so.
    return { kind: 'report', run: newest, label: `This report is shown as stored (status: ${newest.status}).` };
  }
  const older = runs.find((r) => r.has_html);
  if (older) return { kind: 'report', run: older, label: newest.status === 'failed' ? LABELS.olderFailed : LABELS.olderBuilding };
  if (newest.status === 'queued' || newest.status === 'running') return { kind: 'progress', run: newest };
  if (newest.status === 'failed') return { kind: 'failed', run: newest };
  return { kind: 'unknown', run: newest };
}

export function createReports({ db, hubUrl, store, accounts, siteOrigin = () => '', fetchImpl = fetch, log = console.log }) {
  const hubBase = hubUrl ? hubUrl.replace(/\/+$/, '') : '';

  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', ...extra });
    res.end(body);
  };

  // ---- Free preview ----

  // The preview page drawn from the database, or null (no database, no rows yet, or the template threw).
  async function drawPreview(req, id) {
    if (!db.configured) return null;
    try {
      const data = await db.previewData(id);
      if (!data) return null;
      const price = await db.price().catch(() => null);
      return reportPage(data.report, data.s2, { price, ref: id.slice(0, 8).toUpperCase(), orderUrl: `${siteOrigin(req)}/order?report=${id}` });
    } catch (e) {
      log(`preview ${id}: could not draw it from the database: ${e.message}`);
      return null;
    }
  }

  async function preview(req, res, id) {
    if (!REPORT_ID.test(id)) return send(res, 404, view.reportNotFound());
    // First: draw it here from the database rows, with the factory's own template (preview-template/, exported from
    // company-diver). Anything that goes wrong falls through to the factory's page below; it never shows an error.
    const drawn = await drawPreview(req, id.toLowerCase());
    if (drawn) return send(res, 200, drawn);
    if (!hubBase) {
      log('preview: REPORT_HUB_URL is not set, so no preview can be shown. Set it to the report factory\'s public address.');
      return send(res, 503, view.previewWaiting(), { 'retry-after': '60' });
    }
    try {
      const r = await fetchImpl(`${hubBase}/v21/r/${id.toLowerCase()}`, { signal: AbortSignal.timeout(25_000), headers: { accept: 'text/html' } });
      if (r.status === 200) { res.asStored = true; return send(res, 200, await r.text()); } // passed through unchanged (visits.js records it)
      if (r.status !== 404 && r.status !== 503) log(`preview ${id}: the factory answered ${r.status}`);
      return send(res, r.status === 404 ? 404 : 503, view.previewWaiting(), { 'retry-after': '60' });
    } catch (e) {
      log(`preview ${id}: the factory could not be reached: ${e.message}`);
      return send(res, 503, view.previewWaiting(), { 'retry-after': '60' });
    }
  }

  // ---- Full report ----

  // No payment or sign-in check here (owner, 2026-11-12): /r/<id> is public, like /p/<id>. The site's own login and
  // access rules are the owner's to add on top; this file only shows the report.

  // The company name for the page title. Never allowed to stop a page: null when it cannot be read.
  const companyOf = async (id) => { try { return (await db.card(id))?.company ?? null; } catch { return null; } };

  async function report(req, res, rawId) {
    const id = rawId.toLowerCase();
    if (!REPORT_ID.test(id)) return send(res, 404, view.reportNotFound());

    let runs;
    try {
      if (!db.configured) throw new Error('REPORT_DB_URL is not set');
      runs = await db.runs(id);
    } catch (e) {
      log(`report ${id}: could not read the report database: ${e.message}`);
      return send(res, 503, view.reportUnavailable({ company: null }), { 'retry-after': '30' });
    }
    const chosen = chooseView(runs);

    if (chosen.kind === 'report') {
      // Unlabelled: the stored page alone, exactly as stored. Labelled: a frame with the label above it.
      if (!chosen.label) return rawPage(res, id, chosen.run.run_id);
      return send(res, 200, view.reportFrame({ company: await companyOf(id), label: chosen.label, src: `/r/${id}/raw?run=${encodeURIComponent(chosen.run.run_id)}` }));
    }

    const company = await companyOf(id);
    if (chosen.kind === 'progress') return send(res, 200, view.reportProgress({ company, stage: chosen.run.stage }));
    if (chosen.kind === 'failed') {
      log(`ALERT report ${id}: the full report run ${chosen.run.run_id} failed and the buyer is waiting.`);
      return send(res, 200, view.reportFailed({ company }));
    }
    if (chosen.kind === 'unknown') {
      log(`report ${id}: run ${chosen.run.run_id} has a status this site does not know: ${chosen.run.status}`);
      return send(res, 200, view.reportProgress({ company, stage: chosen.run.stage, label: `Status: ${chosen.run.status}` }));
    }
    return send(res, 200, view.reportNone({ company }));
  }

  // The stored page of one run, alone, as text/html. The run must belong to this report.
  // `sandboxed` (the framed copy, /r/<id>/raw): the browser runs the page in its own opaque origin, scripts allowed,
  // so nothing in a report can reach this site's cookies or pages. Same rules the brief gives for an iframe.
  async function rawPage(res, id, runId, { sandboxed = false } = {}) {
    let html;
    try { html = await db.html(id, runId); } catch (e) {
      log(`report ${id}: could not read the page of run ${runId}: ${e.message}`);
      return send(res, 503, view.reportUnavailable({ company: null }), { 'retry-after': '30' });
    }
    if (!html) return send(res, 404, view.reportNotFound());
    res.asStored = true; // visits.js: record the view, but send the page exactly as stored (no time-on-page script)
    return send(res, 200, html, sandboxed ? { 'content-security-policy': SANDBOX } : {});
  }

  async function raw(req, res, rawId, url) {
    const id = rawId.toLowerCase();
    if (!REPORT_ID.test(id)) return send(res, 404, view.reportNotFound());
    const runId = url.searchParams.get('run') ?? '';
    if (!runId || runId.length > 100) return send(res, 404, view.reportNotFound());
    return rawPage(res, id, runId, { sandboxed: true });
  }

  // Routes: returns a handler for `route` ("GET /r/<id>"), or null when it is not a report route.
  function match(route, url) {
    let m = /^GET \/p\/([^/]+)$/.exec(route);
    if (m) return (req, res) => preview(req, res, m[1]);
    m = /^GET \/r\/([^/]+)$/.exec(route);
    if (m) return (req, res) => report(req, res, m[1]);
    m = /^GET \/r\/([^/]+)\/raw$/.exec(route);
    if (m) return (req, res) => raw(req, res, m[1], url);
    return null;
  }

  return { match };
}
