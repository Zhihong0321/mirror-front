// What to tell a buyer about a free preview that is not ready yet: where it is in line, whether the report factory has
// started it, and which step it is on. Pure (no database, no clock of its own), so it is easy to test.
//
// The site and the factory are linked only by the company: the request has a name and a website, the factory's
// v21_report row has the same two. So "started" means: a factory report for the same company that was created after
// the request. When none can be found (or the factory database cannot be read) the buyer is told it is waiting to
// start, and nothing breaks: this never throws and never hides the row.

const SUFFIX = /\b(sdn|bhd|berhad|pte|ltd|limited|pty|llc|inc|co|corp|corporation|company|plt)\b/g;

export const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();

export function domainOf(s) {
  const t = String(s ?? '').trim().toLowerCase();
  if (!t) return '';
  return t.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[\/?#\s]/)[0];
}

// Newest factory report that is the same company as the request and was created after it (a minute of slack for clocks).
export function matchFactory(request, rows) {
  const want = normName(request?.company);
  const dom = domainOf(request?.website);
  const since = Number(request?.created_at) - 60_000;
  let best = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const made = Date.parse(r?.created_at);
    if (!Number.isFinite(made) || made < since) continue;
    const same = (dom && domainOf(r.website) === dom) || (want && normName(r.company) === want);
    if (same && (!best || made > Date.parse(best.created_at))) best = r;
  }
  return best;
}

export function ago(ms, now) {
  const mins = Math.floor((Number(now) - Number(ms)) / 60_000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.floor(h / 24)} days ago`;
}

const stepState = (v) => {
  const s = String(v ?? '').toLowerCase();
  if (s === 'done' || s === 'ok') return 'done';
  if (s === 'running' || s === 'queued' || s === 'in_progress') return 'now';
  if (s === 'failed' || s === 'error') return 'bad';
  return 'todo';
};

const FACTORY_STEPS = [
  ['step1_status', 'Researching the company'],
  ['step1_5_status', 'Checking the people behind it'],
  ['step2_status', 'Analysing what we found'],
  ['step3_status', 'Writing your preview'],
];

// -> { badge: { label, tone }, line, steps: [{ label, state: 'done'|'now'|'todo'|'bad', note }] }
export function previewProgress({ request, ahead = null, factory = null, now = Date.now() }) {
  const steps = [{ label: 'Request received', state: 'done', note: ago(request?.created_at, now) }];

  if (!factory) {
    const place = ahead === 0 ? 'You are next in line.'
      : Number.isFinite(ahead) && ahead > 0 ? `${ahead} request${ahead === 1 ? '' : 's'} ahead of yours.` : '';
    steps.push({ label: 'Waiting to start', state: 'now', note: place });
    for (const [, label] of FACTORY_STEPS) steps.push({ label, state: 'todo', note: '' });
    steps.push({ label: 'Ready: we email you the link', state: 'todo', note: '' });
    return { badge: { label: 'In line', tone: 'wait' }, line: `Not started yet. ${place}`.trim(), steps };
  }

  const made = Date.parse(factory.created_at);
  steps.push({ label: 'Started', state: 'done', note: Number.isFinite(made) ? ago(made, now) : '' });
  const states = FACTORY_STEPS.map(([key]) => stepState(factory[key]));
  const firstOpen = states.findIndex((s) => s !== 'done');
  FACTORY_STEPS.forEach(([, label], i) => {
    let state = states[i];
    let note = state === 'now' ? 'working on it now' : state === 'bad' ? 'this step hit a problem; we are looking into it' : '';
    if (state === 'todo' && i === firstOpen && !states.includes('now') && !states.includes('bad')) { state = 'now'; note = 'up next'; }
    steps.push({ label, state, note });
  });
  const allDone = firstOpen === -1;
  const anyBad = states.includes('bad');
  steps.push({
    label: 'Ready: we email you the link', state: allDone ? 'now' : 'todo',
    note: allDone ? 'written; our team is giving it a last look' : '',
  });
  const current = FACTORY_STEPS[firstOpen]?.[1];
  const updated = Date.parse(factory.updated_at);
  const upd = Number.isFinite(updated) ? ` Last update ${ago(updated, now)}.` : '';
  if (anyBad) return { badge: { label: 'Hit a problem', tone: 'bad' }, line: `Started, but a step hit a problem. We are looking into it.${upd}`, steps };
  if (allDone) return { badge: { label: 'Almost ready', tone: 'wait' }, line: `Written. Our team is giving it a last look.${upd}`, steps };
  return { badge: { label: 'Working on it', tone: 'wait' }, line: `Started ${ago(made, now)}. Now: ${current.toLowerCase()}.${upd}`, steps };
}
