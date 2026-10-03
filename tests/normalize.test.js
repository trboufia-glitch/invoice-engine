'use strict';
const assert = require('assert');
const { normalize, parseDate, toNumber, detectCurrency } = require('../lib/normalize');

let pass = 0, fail = 0;
const results = [];
function t(name, fn) {
  try { fn(); pass++; results.push(['PASS', name]); }
  catch (e) { fail++; results.push(['FAIL', name + ' :: ' + e.message]); }
}

// --- number parsing -------------------------------------------------------
t('toNumber: 1,234.56', () => assert.strictEqual(toNumber('1,234.56'), 1234.56));
t('toNumber: 1.234,56 (EU)', () => assert.strictEqual(toNumber('1.234,56'), 1234.56));
t('toNumber: 1 234,56 (space EU)', () => assert.strictEqual(toNumber('1 234,56'), 1234.56));
t('toNumber: 1,234 (thousands only)', () => assert.strictEqual(toNumber('1,234'), 1234));
t("toNumber: 1'234.50 (Swiss)", () => assert.strictEqual(toNumber("1'234.50"), 1234.5));
t('toNumber: 1234,5 (decimal comma)', () => assert.strictEqual(toNumber('1234,5'), 1234.5));
t('toNumber: negative', () => assert.strictEqual(toNumber('(250.00)'), -250) || assert.strictEqual(toNumber('-250.00'), -250));

// --- dates ----------------------------------------------------------------
t('date: ISO', () => assert.strictEqual(parseDate('2026-03-15'), '2026-03-15'));
t('date: 15/03/2026', () => assert.strictEqual(parseDate('15/03/2026'), '2026-03-15'));
t('date: 03/15/2026 US', () => assert.strictEqual(parseDate('03/15/2026'), '2026-03-15'));
t('date: 15-Mar-2026', () => assert.strictEqual(parseDate('15-Mar-2026'), '2026-03-15'));
t('date: Mar 15, 2026', () => assert.strictEqual(parseDate('Mar 15, 2026'), '2026-03-15'));
t('date: 15 March 2026', () => assert.strictEqual(parseDate('15 March 2026'), '2026-03-15'));
t('date: rejects 31 Feb', () => assert.strictEqual(parseDate('2026-02-31'), null));
t('date: 2-digit year -> 2026', () => assert.strictEqual(parseDate('15/03/26'), '2026-03-15'));

t('currency: $ -> USD', () => assert.strictEqual(detectCurrency('Total $1,200.00'), 'USD'));
t('currency: EUR code', () => assert.strictEqual(detectCurrency('Total: EUR 900'), 'EUR'));

// --- CSV happy path -------------------------------------------------------
const CLEAN_CSV = `Invoice Number,Invoice Date,Due Date,Vendor,Supplier Currency,Subtotal,Tax Rate,Tax,Total,Amount Due
INV-1001,2026-01-05,2026-02-04,Acme Industrial Supply,USD,1000.00,20,200.00,1200.00,1200.00
INV-1002,2026-01-09,2026-03-09,Globex Components Ltd,USD,2500.00,8.25,206.25,2706.25,2706.25`;

t('csv: clean file scores 100', () => {
  const r = normalize(CLEAN_CSV, { format: 'csv' });
  assert.strictEqual(r.row_count, 2, 'rows');
  assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.issues));
  assert.strictEqual(r.summary.avg_score, 100);
  assert.strictEqual(r.records[0].invoice_number, 'INV-1001');
  assert.strictEqual(r.records[0].tax_rate, 20);
});

t('csv: semicolon + EU decimals', () => {
  const r = normalize(`Invoice No;Date;Supplier;Currency;Net;VAT;Gross\nR-77;15.03.2026;Müller GmbH;EUR;1.000,00;190,00;1.190,00`, { format: 'csv' });
  assert.strictEqual(r.delimiter, ';');
  assert.strictEqual(r.records[0].subtotal, 1000);
  assert.strictEqual(r.records[0].tax, 190);
  assert.strictEqual(r.records[0].total, 1190);
});

t('csv: arithmetic mismatch flagged', () => {
  const r = normalize(`Invoice Number,Invoice Date,Vendor,Currency,Subtotal,Tax,Total\nINV-9,2026-01-05,X,USD,100.00,20.00,999.00`, { format: 'csv' });
  assert.ok(r.issues.some((i) => i.code === 'ARITHMETIC_MISMATCH'), JSON.stringify(r.issues));
  assert.ok(r.summary.errors >= 1);
});

t('csv: tax rate cross-check', () => {
  const r = normalize(`Invoice Number,Invoice Date,Vendor,Currency,Subtotal,Tax Rate,Tax,Total\nINV-9,2026-01-05,X,USD,1000.00,20,100.00,1100.00`, { format: 'csv' });
  assert.ok(r.issues.some((i) => i.code === 'TAX_RATE_MISMATCH'), JSON.stringify(r.issues));
});

t('csv: fuzzy header mapping', () => {
  const r = normalize(`Doc Number (old),Date Issued,Supplier Name,CCY,Net Amount,VAT Amount,Grand Total\nINV-55,2026-02-02,Zenith,GBP,400.00,80.00,480.00`, { format: 'csv' });
  const rec = r.records[0];
  assert.strictEqual(rec.invoice_number, 'INV-55');
  assert.strictEqual(rec.currency, 'GBP');
  assert.strictEqual(rec.total, 480);
});

// --- text path ------------------------------------------------------------
const RECEIPT = `ACME WIDGET SUPPLY
Invoice #: INV-2026-0042
Date: 2026-02-10
Due Date: 2026-03-12

Subtotal: $900.00
VAT 20%: $180.00
TOTAL DUE: $1080.00
`;

t('text: receipt parse', () => {
  const r = normalize(RECEIPT);
  assert.strictEqual(r.format, 'text');
  const rec = r.records[0];
  assert.strictEqual(rec.invoice_number, 'INV-2026-0042');
  assert.strictEqual(rec.issued_date, '2026-02-10');
  assert.strictEqual(rec.due_date, '2026-03-12');
  assert.strictEqual(rec.currency, 'USD');
  assert.strictEqual(rec.total, 1080);
  assert.strictEqual(rec.subtotal, 900);
  assert.strictEqual(rec.tax_rate, 20);
  assert.strictEqual(r.summary.errors, 0, JSON.stringify(r.issues));
});

t('text: line items + summed total', () => {
  const r = normalize(`NORTHWIND SUPPLY
Receipt 8891
2x Widget A          12.50
3x Widget B          40.00
1x Large Casing     199.99
TOTAL: $336.49`);
  const li = r.line_items || [];
  assert.strictEqual(li.length, 3, JSON.stringify(li));
  assert.strictEqual(li[0].qty, 2);
  assert.strictEqual(li[2].amount, 199.99);
  assert.strictEqual(r.records[0].total, 336.49);
});

t('text: future date flagged', () => {
  const r = normalize(`INVOICE INV-1
Date: 2099-01-01
Total: $10.00`);
  assert.ok(r.issues.some((i) => i.code === 'FUTURE_DATE'), JSON.stringify(r.issues));
});

// --- robustness -----------------------------------------------------------
t('empty input safe', () => {
  const r = normalize('');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.summary.errors, 1);
});

t('null input safe', () => {
  const r = normalize(null);
  assert.strictEqual(r.ok, false);
});

t('garbage input does not throw', () => {
  const r = normalize('!!! ??? ### \x01\x02 %%%');
  assert.ok(r.row_count >= 0);
});

t('malformed quotes do not throw', () => {
  const r = normalize(`Invoice,Total\n"unclosed,10.00\n"a"b,c,,"x`, { format: 'csv' });
  assert.ok(Array.isArray(r.records));
});

t('large file handled', () => {
  let rows = 'Invoice Number,Invoice Date,Vendor,Currency,Subtotal,Tax,Total\n';
  for (let i = 0; i < 3000; i++) rows += `INV-${i},2026-01-05,V,USD,100.00,20.00,120.00\n`;
  const r = normalize(rows, { format: 'csv', maxRows: 5000 });
  assert.strictEqual(r.row_count, 3000);
});

t('truncation flagged', () => {
  let rows = 'Invoice Number,Invoice Date,Vendor,Currency,Subtotal,Tax,Total\n';
  for (let i = 0; i < 100; i++) rows += `INV-${i},2026-01-05,V,USD,100.00,20.00,120.00\n`;
  const r = normalize(rows, { format: 'csv', maxRows: 50 });
  assert.strictEqual(r.row_count, 50);
  assert.strictEqual(r.truncated, true);
});

// --- report ---------------------------------------------------------------
console.log('\n  DARKMIND // normalize test suite\n');
for (const [s, n] of results) {
  console.log(`  ${s === 'PASS' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`);
}
console.log(`\n  ${pass} passed, ${fail} failed, ${results.length} total\n`);
process.exit(fail ? 1 : 0);