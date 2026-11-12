// The hub (ee-auto) API, called server side with the hub token. The browser never sees the token.
// API reference: docs/website-guide.md sections 3 and 4.

export function createHub({ url, token, dryRun = false, fetchImpl = fetch, log = console.log }) {
  const base = url.replace(/\/+$/, '');

  async function call(method, path, body) {
    const res = await fetchImpl(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
    if (!res.ok) throw new Error(`hub ${method} ${path} -> ${res.status}: ${data.error ?? 'error'}`);
    return data;
  }

  // One company from the admin pipeline list, found by the public id in its preview link.
  // The list holds the newest 200 companies, so older dives are not found.
  async function findDive(publicId) {
    const { companies } = await call('GET', '/api/dive-deeper/pipeline');
    const row = companies.find((c) => c.preview_url?.endsWith(`/dp/${publicId}`));
    if (!row) return null;
    return {
      diveId: row.dive_id,
      publicId,
      company: row.company,
      diveStatus: row.dive_status,
      previewUrl: row.preview_url,
      report: row.report, // { run_id, status, report_url } or null
    };
  }

  // Starts the full report for a paid order, or reuses the one already made for this company.
  // A failed run is retried instead of started again. Returns { runId, reportUrl, reused }.
  async function startReport(diveId, publicId) {
    const dive = await findDive(publicId);
    if (!dive || dive.diveId !== diveId) throw new Error(`company dive #${diveId} (${publicId}) not found on the hub`);
    const r = dive.report;
    if (r && r.status !== 'failed') return { runId: r.run_id, reportUrl: r.report_url, reused: true };
    if (dryRun) {
      log(`[hub dry run] would ${r ? `retry run #${r.run_id}` : `start a full report on dive #${diveId}`}`);
      return { runId: null, reportUrl: null, reused: false, dryRun: true };
    }
    const out = r
      ? await call('POST', `/api/dive-deeper/${r.run_id}/retry`)
      : await call('POST', '/api/dive-deeper', { dive_id: diveId });
    return { runId: out.id ?? r?.run_id, reportUrl: out.report_url ?? r?.report_url, reused: false };
  }

  return { findDive, startReport };
}
