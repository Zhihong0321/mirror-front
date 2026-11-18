// The office dashboard's "Platform performance overview" (owner, 2026-11-18): published free preview reports against
// unique visitors, and sales, by week, by month and in total.
// Pure: the caller (app.js) reads the rows and hands them in. Odd rows (no date, bad amount) are counted as skipped and
// reported, never thrown on. Weeks start on Monday; days and months are in the office's time zone.

const DAY = 86400000;

// The time zone's offset from UTC at `at` (ms). An unknown zone counts as UTC.
export function tzOffset(tz, at = Date.now()) {
  try {
    const d = new Date(at);
    const local = Date.parse(d.toLocaleString('en-US', { timeZone: tz }));
    const utc = Date.parse(d.toLocaleString('en-US', { timeZone: 'UTC' }));
    const off = local - utc;
    return Number.isFinite(off) ? off : 0;
  } catch { return 0; }
}

const toMs = (v) => { const t = typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(v); return Number.isFinite(t) ? t : null; };
const dayOf = (ms, off) => Math.floor((ms + off) / DAY); // local day number
const weekOf = (day) => day - ((day + 3) % 7); // the Monday of that day's week (day 0, 1970-01-01, was a Thursday)
const monthOf = (day) => { const d = new Date(day * DAY); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (day) => { const d = new Date(day * DAY); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const monthLabel = (m) => `${MONTHS[m % 12]} ${Math.floor(m / 12)}`;

// previews: [{ published_at }]. visitorDays: [{ who, day }] (day = local day number, see visits.visitorDays).
// visitorsTotal: distinct visitors ever. orders: [{ paid_at, amount_cents, currency, stripe_session_id }]. An order
// paid with Stripe test keys (session id cs_test_..., or test: true) is fake money: it is counted apart as a test
// payment (testOrders, testRevenue) and never added to orders or revenue.
// Returns { weeks: [row], months: [row], total: row, thisWeek: row, thisMonth: row, skipped: { previews, orders } },
// row = { label, previews, visitors, orders, revenue: { usd: cents, ... }, testOrders, testRevenue, current }. Newest period first.
export function buildPerformance({ previews = [], visitorDays = [], visitorsTotal = null, orders = [], now = Date.now(), tz = 'UTC', weeks = 12, months = 12 } = {}) {
  const off = tzOffset(tz, now);
  const today = dayOf(now, off);
  const curWeek = weekOf(today);
  const curMonth = monthOf(today);

  const blank = (label, current = false) => ({ label, previews: 0, visitors: 0, orders: 0, revenue: {}, testOrders: 0, testRevenue: {}, current, who: new Set() });
  const weekRows = new Map();
  for (let i = 0; i < weeks; i += 1) {
    const w = curWeek - 7 * i;
    weekRows.set(w, blank(i === 0 ? `This week (from ${dayLabel(w)})` : `Week of ${dayLabel(w)}`, i === 0));
  }
  const monthRows = new Map();
  for (let i = 0; i < months; i += 1) {
    const m = curMonth - i;
    monthRows.set(m, blank(i === 0 ? `This month (${monthLabel(m)})` : monthLabel(m), i === 0));
  }
  const total = blank('All time');
  const skipped = { previews: 0, orders: 0 };

  const each = (day, fn) => {
    const w = weekRows.get(weekOf(day));
    const m = monthRows.get(monthOf(day));
    if (w) fn(w);
    if (m) fn(m);
    fn(total);
  };

  for (const p of previews ?? []) {
    const t = toMs(p?.published_at);
    if (t == null) { skipped.previews += 1; continue; }
    each(dayOf(t, off), (r) => { r.previews += 1; });
  }
  for (const v of visitorDays ?? []) {
    const day = Number(v?.day);
    if (!Number.isFinite(day) || v?.who == null) continue;
    each(day, (r) => r.who.add(String(v.who)));
  }
  for (const o of orders ?? []) {
    const t = toMs(o?.paid_at);
    const cents = Number(o?.amount_cents);
    if (t == null || !Number.isFinite(cents)) { skipped.orders += 1; continue; }
    const cur = String(o?.currency || '?').toLowerCase();
    const fake = o?.test === true || /^cs_test_/i.test(String(o?.stripe_session_id ?? ''));
    each(dayOf(t, off), (r) => {
      if (fake) { r.testOrders += 1; r.testRevenue[cur] = (r.testRevenue[cur] ?? 0) + cents; } else { r.orders += 1; r.revenue[cur] = (r.revenue[cur] ?? 0) + cents; }
    });
  }

  const done = (r) => { const { who, ...rest } = r; return { ...rest, visitors: who.size }; };
  const totalRow = done(total);
  if (Number.isFinite(Number(visitorsTotal)) && visitorsTotal != null) totalRow.visitors = Number(visitorsTotal);
  const weekList = [...weekRows.values()].map(done);
  const monthList = [...monthRows.values()].map(done);
  return { weeks: weekList, months: monthList, total: totalRow, thisWeek: weekList[0], thisMonth: monthList[0], skipped };
}
