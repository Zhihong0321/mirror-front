// The minimum withdrawal for referrers (USD 50, docs/referrals.md). A label, never a gate: the helper only says
// whether the amount owed has reached the minimum and how far short it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payoutStatus, MIN_PAYOUT_CENTS } from '../referrals.js';

test('the minimum withdrawal is USD 50', () => {
  assert.equal(MIN_PAYOUT_CENTS, 5000);
});

test('USD 20 owed is below the minimum, USD 30 short', () => {
  const p = payoutStatus(2000);
  assert.equal(p.reached, false);
  assert.equal(p.shortCents, 3000);
  assert.equal(p.owedCents, 2000);
});

test('exactly USD 50 reaches the minimum', () => {
  const p = payoutStatus(5000);
  assert.equal(p.reached, true);
  assert.equal(p.shortCents, 0);
});

test('two USD 20 sales (USD 40) are still below; a third makes USD 60 and reaches it', () => {
  assert.equal(payoutStatus(2000 + 2000).reached, false);
  assert.equal(payoutStatus(2000 * 3).reached, true);
});

test('a bad or missing amount counts as nothing owed and never throws', () => {
  for (const raw of [undefined, null, '', 'abc', NaN, -500]) {
    const p = payoutStatus(raw);
    assert.equal(p.owedCents, 0);
    assert.equal(p.reached, false);
    assert.equal(p.shortCents, 5000);
  }
});
