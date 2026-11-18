import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformance, tzOffset } from '../performance.js';
import { officeHomePage } from '../office-home.js';

const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no summer time
const OFF = 8 * 3600000;
// Wednesday 18 Nov 2026, 22:00 in Kuala Lumpur.
const NOW = Date.UTC(2026, 10, 18, 14, 0);
const day = (ms) => Math.floor((ms + OFF) / 86400000);

test('the office time zone offset is read, and an unknown zone counts as UTC', () => {
  assert.equal(tzOffset(KL, NOW), OFF);
  assert.equal(tzOffset('Not/AZone', NOW), 0);
});

test('previews, visitors and sales are counted by week (from Monday), by month and in total, in the office time zone', () => {
  const previews = [
    { published_at: '2026-11-16T00:30:00+08:00' }, // Monday this week (local)
    { published_at: '2026-11-15T23:30:00+08:00' }, // Sunday: last week
    { published_at: '2026-10-31T23:30:00+08:00' }, // October (but 15:30 UTC: still Oct in both)
    { published_at: '2026-11-01T01:00:00+08:00' }, // 1 Nov local, 31 Oct UTC: counts as November
    { published_at: null }, // no date: skipped and reported
  ];
  const visitorDays = [
    { who: 'a', day: day(Date.UTC(2026, 10, 17)) }, { who: 'a', day: day(Date.UTC(2026, 10, 18)) }, // same visitor twice this week
    { who: 'b', day: day(Date.UTC(2026, 10, 10)) }, // last week
    { who: 'c', day: day(Date.UTC(2026, 9, 5)) }, // October
  ];
  const orders = [
    { paid_at: Date.UTC(2026, 10, 17, 3), amount_cents: 9900, currency: 'usd' },
    { paid_at: Date.UTC(2026, 9, 20), amount_cents: 4900, currency: 'USD' },
    { paid_at: 'nonsense', amount_cents: 100, currency: 'usd' },
  ];
  const p = buildPerformance({ previews, visitorDays, visitorsTotal: 3, orders, now: NOW, tz: KL });

  assert.equal(p.thisWeek.label, 'This week (from 16 Nov)');
  assert.equal(p.thisWeek.previews, 1);
  assert.equal(p.thisWeek.visitors, 1, 'one visitor on two days is one unique visitor');
  assert.equal(p.thisWeek.orders, 1);
  assert.deepEqual(p.thisWeek.revenue, { usd: 9900 });
  assert.equal(p.weeks[1].previews, 1);
  assert.equal(p.weeks[1].visitors, 1);
  assert.equal(p.weeks.length, 12);

  assert.equal(p.thisMonth.label, 'This month (Nov 2026)');
  assert.equal(p.thisMonth.previews, 3, 'Monday, Sunday and 1 Nov local time');
  assert.equal(p.thisMonth.visitors, 2);
  assert.equal(p.months[1].label, 'Oct 2026');
  assert.equal(p.months[1].previews, 1);
  assert.equal(p.months[1].visitors, 1);
  assert.deepEqual(p.months[1].revenue, { usd: 4900 }, 'currency is case-insensitive');

  assert.equal(p.total.previews, 4);
  assert.equal(p.total.visitors, 3);
  assert.equal(p.total.orders, 2);
  assert.deepEqual(p.total.revenue, { usd: 14800 });
  assert.deepEqual(p.skipped, { previews: 1, orders: 1 });
});

test('odd input never throws', () => {
  const p = buildPerformance({ previews: [null, {}], visitorDays: [null, { day: 'x' }], orders: [null, { paid_at: 1 }], tz: 'bad zone' });
  assert.equal(p.total.previews, 0);
  assert.equal(p.total.orders, 0);
  assert.doesNotThrow(() => buildPerformance());
});

test('the dashboard shows the overview first, labels a part it could not read and still shows the rest', () => {
  const data = buildPerformance({ previews: [{ published_at: NOW - 3600000 }], visitorDays: [{ who: 'a', day: day(NOW) }, { who: 'b', day: day(NOW) }], visitorsTotal: 2,
    orders: [{ paid_at: NOW, amount_cents: 9900, currency: 'usd' }], now: NOW, tz: KL });
  const page = officeHomePage({ email: 'team@example.com', now: NOW, tz: KL, perf: { data, errors: {}, testMode: true } });
  assert.match(page, /<h2>1\. Platform performance overview<\/h2>[\s\S]*<h2>2\. External tool health/);
  assert.match(page, /This week[\s\S]*?<b>1<\/b><span>Published preview reports[\s\S]*?<b>2<\/b><span>Unique visitors[\s\S]*?<b>2\.0<\/b><span>Visitors per preview[\s\S]*?<b>USD 99<\/b><span>Sales · 1 order</);
  assert.match(page, /By week[\s\S]*By month/);
  assert.match(page, /test payments/);

  const broken = officeHomePage({ email: 'team@example.com', now: NOW, tz: KL, perf: { data, errors: { previews: 'connection refused' }, testMode: false } });
  assert.match(broken, /Published previews could not be read \(report database\): connection refused/);
  assert.match(broken, /<b>–<\/b><span>Published preview reports/);
  assert.match(broken, /<b>2<\/b><span>Unique visitors/, 'visitors still show');
  assert.doesNotMatch(broken, /test payments/);

  assert.match(officeHomePage({ email: 'x', now: NOW, tz: KL, perf: { data: null, error: 'boom' } }), /performance figures could not be worked out just now: boom/);
});
