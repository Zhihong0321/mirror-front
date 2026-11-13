import test from 'node:test';
import assert from 'node:assert/strict';
import { page, orderPage } from '../pages.js';
import { reportFrame } from '../report-pages.js';
import { magicLink } from '../emails.js';

test('brand: every page shell carries the logo and the tab icon', () => {
  const html = page('Hello', '<p>x</p>');
  assert.match(html, /assets\/logo\/mirrormirror-logo\.svg/);
  assert.match(html, /rel="icon" href="\/assets\/logo\/favicon\.svg"/);
  assert.match(orderPage({ dive: { publicId: 'x', company: 'Acme' }, price: 'USD 89', testMode: false, email: null }), /assets\/logo\/mirrormirror-logo\.svg/);
  assert.match(reportFrame({ company: 'Acme', label: 'l', src: '/r/x/raw' }), /assets\/logo\/mirrormirror-logo\.svg/);
});

test('brand: emails show the logo as a PNG on the public address', () => {
  const m = magicLink({ link: 'https://mirrormirror.cloud/x', minutes: 15 });
  assert.match(m.html, /https:\/\/mirrormirror\.cloud\/assets\/logo\/mirrormirror-logo-email\.png/);
});
