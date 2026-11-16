// Starts the paid full report on the company-diver report factory (POST /api/v21/deeper, operator token, server side
// only). The factory does NOT check for an existing run: every POST makes a new run, which costs money. So the site
// looks first (read only, through reportdb) and starts a run only when the report has none that has not failed.
// Safe to call any number of times for one report. Contract: docs/report-display.md.

export function createFactory({ url, token, db, fetchImpl = fetch, log = console.log }) {
  const base = url ? url.replace(/\/+$/, '') : '';

  // Returns { runId, reused }. Throws when it cannot tell whether a run exists, or cannot start one: the
  // caller (the Stripe webhook) then answers 500 and Stripe retries, so a paid order is never lost or doubled.
  //
  // `again: true` is a second run of a report that already has a finished one (a report credit spent on a re-run, the
  // 60-day check). A finished run ('done' or 'incomplete') does not count then; a run still in flight or with a status
  // this site does not know still does, so a double click never buys two runs.
  async function startReport(reportId, { again = false } = {}) {
    const runs = await db.runs(reportId);
    // Anything that has not failed counts, including a status this site does not know: never risk a second paid run.
    const existing = runs.find((r) => r.status !== 'failed' && !(again && (r.status === 'done' || r.status === 'incomplete')));
    if (existing) return { runId: existing.run_id, reused: true };
    if (!base || !token) throw new Error('REPORT_HUB_URL and REPORT_HUB_TOKEN are needed to start a full report');
    const res = await fetchImpl(`${base}/api/v21/deeper`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ report_id: reportId }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) throw new Error(`factory POST /api/v21/deeper -> ${res.status}: ${data.error ?? text.slice(0, 200)}`);
    return { runId: data.run_id ?? null, reused: false };
  }

  // Starts the free preview of a company: POST /api/v21/step1 makes the report row and returns its id at once (202), then
  // the factory runs the whole chain itself (step 1, 1.5 and 1.6, 2, 3). Returns { reportId }. Throws when it cannot start.
  // Real LLM cost, so the caller only uses it when PREVIEW_AUTO_START=1.
  async function startPreview({ company, country, industry, website }) {
    if (!base || !token) throw new Error('REPORT_HUB_URL and REPORT_HUB_TOKEN are needed to start a preview');
    const res = await fetchImpl(`${base}/api/v21/step1`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ company, country, industry, ...(website ? { website } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) throw new Error(`factory POST /api/v21/step1 -> ${res.status}: ${data.error ?? text.slice(0, 200)}`);
    const reportId = data.id ?? data.report_id;
    if (!reportId) throw new Error('factory POST /api/v21/step1 answered without a report id');
    return { reportId: String(reportId) };
  }

  // Starts the Social Media Ads Research for a keyword (an industry or product) in a country: POST /api/ads-market. The
  // factory captures the live Facebook ads for the keyword and writes one report. Returns { publicId, reused }: reused is
  // true when a run for the same keyword and country was already in flight (the factory answers 200 and returns it).
  // Throws when it cannot start one. Real cost (a browser crawl and a model call), so the caller spends a credit first.
  async function startAdsMarket({ keyword, country, requesterId }) {
    if (!base || !token) throw new Error('REPORT_HUB_URL and REPORT_HUB_TOKEN are needed to start an ads research');
    const res = await fetchImpl(`${base}/api/ads-market`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ keyword, country, requesterId: requesterId ?? 'mirrormirror.cloud' }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) throw new Error(`factory POST /api/ads-market -> ${res.status}: ${data.error ?? text.slice(0, 200)}`);
    const publicId = data.report?.id;
    if (!publicId) throw new Error('factory POST /api/ads-market answered without a report id');
    return { publicId: String(publicId), reused: res.status === 200 };
  }

  return { startReport, startPreview, startAdsMarket };
}
