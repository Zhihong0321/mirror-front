// What the Full reports page tells a buyer about a paid report: real facts, never a vague label, never nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullReportProgress } from '../report-progress.js';

const now = Date.parse('2026-11-13T12:00:00Z');
const order = { report_id: '0b6f3f1e-8f0a-4c52-9a53-0d1f6e0c7a11', paid_at: now - 29 * 60_000, invoice_no: 'MM-2026-0004' };
const at = (mins) => new Date(now - mins * 60_000).toISOString();

test('no run yet: it says so plainly, with the payment time, and marks the start step as not done', () => {
  const p = fullReportProgress({ order, runs: [], now });
  assert.equal(p.label, 'Not started');
  assert.equal(p.tone, 'bad');
  assert.match(p.line, /Paid 29 minutes ago, but the report factory has no run/);
  assert.deepEqual(p.steps.map((s) => s.state), ['done', 'bad', 'todo', 'todo']);
});

test('running: the stage, when it started, which run, and how long it usually takes', () => {
  const p = fullReportProgress({ order, runs: [{ run_id: 'abcdef123456', status: 'running', stage: 'Analysing the market', created_at: at(12), has_html: false }], now, typical: 120 });
  assert.equal(p.label, 'Being written');
  assert.match(p.line, /Started 12 minutes ago \(run abcdef12\)\. Now: Analysing the market\. Usually about 120 minutes\./);
  assert.deepEqual(p.steps.map((s) => s.state), ['done', 'done', 'now', 'todo']);
});

test('queued is not described as running', () => {
  const p = fullReportProgress({ order, runs: [{ run_id: 'r1', status: 'queued', created_at: at(1), has_html: false }], now });
  assert.equal(p.label, 'Waiting in the factory queue');
});

test('failed: the stage it stopped at and the factory\'s own words are shown', () => {
  const p = fullReportProgress({ order, runs: [{ run_id: 'r1', status: 'failed', stage: 'step 2', error: 'LLM quota exceeded', created_at: at(40), has_html: false }], now });
  assert.equal(p.label, 'Hit a problem');
  assert.match(p.line, /failed at "step 2"\. The factory said: LLM quota exceeded/);
  assert.deepEqual(p.steps.map((s) => s.state), ['done', 'done', 'bad', 'todo']);
});

test('ready is labelled ready, with when it finished', () => {
  const p = fullReportProgress({ order, runs: [{ run_id: 'r1', status: 'done', created_at: at(150), finished_at: at(30), has_html: true }], now });
  assert.equal(p.label, 'Ready');
  assert.match(p.line, /Finished 30 minutes ago/);
});

test('the factory cannot be read: the row says so and says why, never an empty label', () => {
  const p = fullReportProgress({ order, runs: null, readError: 'timed out', now });
  assert.equal(p.label, 'Status unavailable');
  assert.match(p.line, /\(timed out\)/);
  assert.ok(p.steps.length >= 2);
});

test('an order with no report id says so', () => {
  const p = fullReportProgress({ order: { ...order, report_id: null }, runs: null, now });
  assert.equal(p.label, 'No report linked');
});

test('garbage in the run row never throws', () => {
  const p = fullReportProgress({ order, runs: [{ run_id: null, status: 'running', created_at: 'not a date' }], now });
  assert.equal(p.label, 'Being written');
  assert.match(p.line, /time not recorded/);
});
