// What a buyer sees under a paid full report: the real facts, not a guess. Payment, whether the report factory has a run
// for it, which stage it is on, when it started, how long it has been, and the error when a run failed.
// Pure (no database, no clock of its own). Never throws and never hides: when the status cannot be read the row says so
// and says why, instead of showing nothing. Owner rule 2026-11-13: no hiding critical information from the buyer.

import { chooseView } from './reports.js';

const toMs = (t) => { const n = t instanceof Date ? t.getTime() : Date.parse(t); return Number.isFinite(n) ? n : null; };

export function ago(t, now) {
  const then = typeof t === 'number' ? t : toMs(t);
  if (then == null) return '';
  const mins = Math.floor((Number(now) - then) / 60_000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.floor(h / 24)} days ago`;
}

const short = (id) => String(id ?? '').slice(0, 8);

// order: the orders row. runs: the report's runs newest first (reportdb.runs), or null when they could not be read.
// readError: why they could not be read. typical: usual minutes to finish (a plain estimate, labelled as one).
// -> { label, tone, line, steps: [{ label, state: 'done'|'now'|'todo'|'bad', note }] }
export function fullReportProgress({ order, runs, readError = '', now = Date.now(), typical = null }) {
  const paid = { label: 'Payment received', state: 'done', note: [ago(Number(order?.paid_at), now), order?.invoice_no].filter(Boolean).join(' · ') };
  if (!order?.report_id) {
    return { label: 'No report linked', tone: 'bad', line: 'This order has no report attached to it, so there is nothing to start. Tell us and we will fix it.', steps: [paid, { label: 'Report started', state: 'bad', note: 'no report id on this order' }] };
  }
  if (!Array.isArray(runs)) {
    return {
      label: 'Status unavailable', tone: 'bad',
      line: `We could not read the report factory just now${readError ? ` (${readError})` : ''}. Your payment is recorded. Reload in a minute.`,
      steps: [paid, { label: 'Report started', state: 'todo', note: 'could not check just now' }],
    };
  }
  const v = chooseView(runs);
  const typ = typical ? ` Usually about ${typical} minutes.` : '';
  if (v.kind === 'none') {
    return {
      label: 'Not started', tone: 'bad',
      line: `Paid ${ago(Number(order.paid_at), now)}, but the report factory has no run for this report. The site checks every minute and starts it; if this stays, we have not been able to start it.`,
      steps: [paid, { label: 'Report started', state: 'bad', note: 'no run exists yet' }, { label: 'Writing the report', state: 'todo', note: '' }, { label: 'Ready', state: 'todo', note: '' }],
    };
  }
  const run = v.run;
  const started = { label: 'Report started', state: 'done', note: `${ago(run.created_at, now) || 'start time not recorded'} · run ${short(run.run_id)}` };
  if (v.kind === 'report') {
    const fin = run.finished_at ? `Finished ${ago(run.finished_at, now)}.` : 'Finished.';
    return {
      label: v.label ? 'Ready, with a note' : 'Ready', tone: 'ok', line: v.label || fin,
      steps: [paid, started, { label: 'Writing the report', state: 'done', note: '' }, { label: 'Ready', state: 'done', note: '' }],
    };
  }
  if (v.kind === 'failed') {
    const why = run.error ? ` The factory said: ${String(run.error).slice(0, 300)}` : '';
    return {
      label: 'Hit a problem', tone: 'bad', line: `The run failed${run.stage ? ` at "${run.stage}"` : ''}.${why}`,
      steps: [paid, started, { label: 'Writing the report', state: 'bad', note: run.stage ? `stopped at: ${run.stage}` : 'the run failed' }, { label: 'Ready', state: 'todo', note: '' }],
    };
  }
  if (v.kind === 'unknown') {
    return {
      label: `Status: ${run.status}`, tone: 'wait', line: `The factory reports a status this site does not know: ${run.status}.`,
      steps: [paid, started, { label: 'Writing the report', state: 'now', note: run.stage ? `stage: ${run.stage}` : '' }, { label: 'Ready', state: 'todo', note: '' }],
    };
  }
  // queued or running
  const queued = run.status === 'queued';
  return {
    label: queued ? 'Waiting in the factory queue' : 'Being written', tone: 'wait',
    line: `Started ${ago(run.created_at, now) || '(time not recorded)'} (run ${short(run.run_id)}). ${queued ? 'Waiting for a free slot.' : `Now: ${run.stage || 'working'}.`}${typ}`,
    steps: [paid, started, { label: 'Writing the report', state: 'now', note: queued ? 'queued' : (run.stage || 'working on it') }, { label: 'Ready', state: 'todo', note: '' }],
  };
}
