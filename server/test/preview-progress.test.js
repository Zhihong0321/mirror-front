import test from 'node:test';
import assert from 'node:assert/strict';
import { previewProgress, matchFactory, normName, domainOf, ago } from '../preview-progress.js';

const T0 = Date.UTC(2026, 10, 12, 4, 0, 0);
const req = { company: 'newpages network sdn bhd', website: 'newpages.com.my', created_at: T0 };
const row = (o = {}) => ({ company: 'Newpages Network Sdn. Bhd.', website: 'https://www.newpages.com.my/', created_at: new Date(T0 + 120_000).toISOString(), updated_at: new Date(T0 + 300_000).toISOString(), step1_status: 'done', step1_5_status: 'running', step2_status: 'none', step3_status: 'none', ...o });

test('names and sites are compared the way a person would', () => {
  assert.equal(normName('Acme  Sdn. Bhd.'), normName('acme sdn bhd'));
  assert.equal(domainOf('https://www.Acme.com.my/about?x=1'), 'acme.com.my');
  assert.equal(domainOf(''), '');
  assert.equal(ago(T0, T0 + 90_000), '1 minute ago');
  assert.equal(ago(T0, T0 + 3 * 3600_000), '3 hours ago');
});

test('only a report created after the request, for the same company, counts as started', () => {
  assert.ok(matchFactory(req, [row()]));
  assert.equal(matchFactory(req, [row({ created_at: new Date(T0 - 3600_000).toISOString() })]), null, 'older report is not this request');
  assert.equal(matchFactory(req, [row({ company: 'Other Co', website: 'other.com' })]), null);
  assert.ok(matchFactory(req, [row({ company: 'Other Co' })]), 'same website is enough');
  assert.equal(matchFactory(req, null), null);
  assert.equal(matchFactory(req, [{ created_at: 'junk' }]), null);
});

test('not started: waiting, with the place in line', () => {
  const p = previewProgress({ request: req, ahead: 2, factory: null, now: T0 + 60_000 });
  assert.equal(p.badge.label, 'In line');
  assert.match(p.line, /2 requests ahead/);
  assert.equal(p.steps[1].label, 'Waiting to start');
  assert.ok(p.steps.slice(2).every((s) => s.state === 'todo'));
  assert.match(previewProgress({ request: req, ahead: 0, factory: null, now: T0 }).line, /next in line/);
  assert.equal(previewProgress({ request: req, ahead: null, factory: null, now: T0 }).badge.tone, 'wait');
});

test('started: shows the running step, a problem, and the last look', () => {
  let p = previewProgress({ request: req, factory: row(), now: T0 + 600_000 });
  assert.equal(p.badge.label, 'Working on it');
  assert.match(p.line, /Now: checking the people/);
  assert.deepEqual(p.steps.map((s) => s.state), ['done', 'done', 'done', 'now', 'todo', 'todo', 'todo']);
  p = previewProgress({ request: req, factory: row({ step1_5_status: 'failed' }), now: T0 + 600_000 });
  assert.equal(p.badge.tone, 'bad');
  assert.ok(p.steps.some((s) => s.state === 'bad'));
  p = previewProgress({ request: req, factory: row({ step1_5_status: 'done', step2_status: 'done', step3_status: 'done' }), now: T0 + 600_000 });
  assert.equal(p.badge.label, 'Almost ready');
  p = previewProgress({ request: req, factory: row({ step1_5_status: 'done' }), now: T0 + 600_000 });
  assert.equal(p.steps[4].note, 'up next');
});

test('junk in the factory row never throws', () => {
  const p = previewProgress({ request: {}, factory: { created_at: null, step1_status: 5 }, now: T0 });
  assert.ok(p.steps.length >= 7);
});
