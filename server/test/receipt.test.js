// The Official Receipt: the seller's lines print when they are filled in and are left off when blank. Never a gate:
// a receipt is produced either way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoice, sellerLines } from '../emails.js';
import { invoicePage } from '../pages.js';

const order = { invoice_no: 'MM-2026-0007', paid_at: Date.UTC(2026, 10, 17, 8, 0, 0), email: 'client@example.com', company: 'Acme Sdn Bhd', amount_cents: 8900, currency: 'usd', report_url: null };
const urls = { accountUrl: 'https://x.test/account', invoiceUrl: 'https://x.test/account/invoices/7' };

test('a blank seller still gives a receipt: just the name, no empty lines', () => {
  assert.deepEqual(sellerLines({ name: 'MirrorMirror', regNo: '', taxNo: '', address: '', note: '' }), ['MirrorMirror']);
  assert.deepEqual(sellerLines(undefined), []);
  const m = invoice({ order, seller: { name: 'MirrorMirror', regNo: '', taxNo: '', address: '', note: '' }, ...urls });
  assert.equal(m.subject, 'Official Receipt MM-2026-0007: your MirrorMirror report');
  assert.match(m.text, /Official Receipt MM-2026-0007/);
  assert.doesNotMatch(m.text, /Company no\.|Tax ID/);
});

test('filled-in seller details print on the email and on the printed receipt', () => {
  const seller = { name: 'MM Sdn Bhd', regNo: '202601000001', taxNo: 'W10-1234-56789012', address: '1 Jalan Test, Kuala Lumpur', note: 'Thank you' };
  assert.deepEqual(sellerLines(seller), ['MM Sdn Bhd', 'Company no.: 202601000001', 'Tax ID: W10-1234-56789012', '1 Jalan Test, Kuala Lumpur', 'Thank you']);
  const m = invoice({ order, seller, ...urls });
  assert.match(m.text, /MM Sdn Bhd\nCompany no\.: 202601000001\nTax ID: W10-1234-56789012\n1 Jalan Test, Kuala Lumpur/);
  assert.match(m.html, /Company no\.: 202601000001/);
  const page = invoicePage({ order, seller });
  assert.match(page, /<h1>Official Receipt<\/h1>/);
  assert.match(page, /Company no\.: 202601000001/);
  assert.match(page, /Receipt no\.[^]*MM-2026-0007/);
  assert.match(page, /Received from[^]*client@example\.com/);
  assert.match(page, /Amount received[^]*USD 89\.00/);
  assert.match(page, /Payment method[^]*Stripe/);
});

test('seller details from the data are escaped, never trusted as HTML', () => {
  const page = invoicePage({ order, seller: { name: '<b>x</b>', regNo: '', taxNo: '', address: '', note: '' } });
  assert.doesNotMatch(page, /<b>x<\/b>/);
  assert.match(page, /&lt;b&gt;x&lt;\/b&gt;/);
});
