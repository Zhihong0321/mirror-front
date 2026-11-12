import test from 'node:test';
import assert from 'node:assert/strict';
import { createFactory } from '../factory.js';

const res = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

test('startPreview posts the company to step 1 with the operator token and returns the report id', async () => {
  let seen;
  const f = createFactory({ url: 'https://factory.test/', token: 'tok', db: {}, fetchImpl: async (u, o) => { seen = { u, o }; return res(202, { id: 'r1', status: 'running' }); } });
  assert.deepEqual(await f.startPreview({ company: 'Acme', country: 'Malaysia', industry: 'General business', website: 'acme.com' }), { reportId: 'r1' });
  assert.equal(seen.u, 'https://factory.test/api/v21/step1');
  assert.equal(seen.o.headers.authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(seen.o.body), { company: 'Acme', country: 'Malaysia', industry: 'General business', website: 'acme.com' });
});

test('startPreview says why it could not start', async () => {
  const bad = createFactory({ url: 'https://factory.test', token: 'tok', db: {}, fetchImpl: async () => res(401, { error: 'bad or missing token' }) });
  await assert.rejects(bad.startPreview({ company: 'A', country: 'B', industry: 'C' }), /401: bad or missing token/);
  await assert.rejects(createFactory({ url: '', token: '', db: {} }).startPreview({ company: 'A' }), /REPORT_HUB_URL and REPORT_HUB_TOKEN/);
  const noId = createFactory({ url: 'https://f.test', token: 't', db: {}, fetchImpl: async () => res(202, {}) });
  await assert.rejects(noId.startPreview({ company: 'A', country: 'B', industry: 'C' }), /without a report id/);
});
