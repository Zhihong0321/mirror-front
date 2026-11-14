// The country picker: the researched countries, the API, the dashboard form, and how a chosen country is saved.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { openStore } from '../store.js';
import { RESEARCHED_COUNTRIES, isResearched } from '../countries.js';
import { previewsPage } from '../dashboard.js';

test('the researched countries are the 25 with a country-layer prompt set; the first four also have industry prompts', () => {
  assert.equal(RESEARCHED_COUNTRIES.length, 25);
  assert.deepEqual(RESEARCHED_COUNTRIES.slice(0, 4).map((c) => c.name), ['Malaysia', 'Singapore', 'Australia', 'South Korea']);
  assert.ok(isResearched(' south korea '));
  assert.ok(isResearched('France'));
  assert.ok(!isResearched('Peru'));
});

const dash = (prefill) => previewsPage({ shell: { email: 'a@b.co', nav: {} }, previews: [], prefill });

test('the dashboard form shows a chip per researched country, Malaysia by default', () => {
  const html = dash({});
  for (const c of RESEARCHED_COUNTRIES) assert.ok(html.includes(`name="country" value="${c.name}"`), c.name);
  assert.match(html, /value="Malaysia" checked/);
  assert.match(html, /name="country_other"/);
});

test('a country from the homepage is preselected; one we have not researched goes in the other box', () => {
  assert.match(dash({ country: 'Singapore' }), /value="Singapore" checked/);
  const other = dash({ country: 'Peru' });
  assert.doesNotMatch(other, /name="country" value="[A-Za-z ]+" checked/);
  assert.match(other, /name="country_other" type="text" maxlength="80" value="Peru"/);
});

let server, origin, store;
before(async () => {
  store = openStore(':memory:');
  const config = { stripeKey: 'sk_test_fake', webhookSecret: 'whsec_x', priceCents: 8900, currency: 'usd',
    siteDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site'), seller: { name: 'S', address: 'A', note: '' }, officeKey: 'k' };
  const mailer = { send: async () => ({ ok: true, status: 'dry-run' }) };
  server = http.createServer(createApp({ stripe: { webhooks: {}, checkout: { sessions: {} } }, hub: { findDive: async () => null }, config, store, mailer, now: Date.now, log: () => {} }));
  await new Promise((r) => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.closeAllConnections(); server?.close(); store?.close(); });

test('GET /api/countries lists the researched countries', async () => {
  const j = await (await fetch(origin + '/api/countries')).json();
  assert.equal(j.countries.length, 25);
  assert.equal(j.countries[0].name, 'Malaysia');
});

test('the homepage has a country chooser on both forms and sends the choice on', async () => {
  const html = await (await fetch(origin + '/')).text();
  assert.equal((html.match(/<fieldset class="who countries" data-countries>/g) ?? []).length, 2);
  assert.equal((html.match(/<input class="other-country"/g) ?? []).length, 2);
  assert.match(html, /'&country=' \+ encodeURIComponent\(k\)/);
  assert.match(html, /We have research prompts for 25 countries/);
});
