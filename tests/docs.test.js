'use strict';
/**
 * Verifies that the examples shown in docs/api.html are the output the engine
 * actually produces. Documentation that lies about its own response is worse
 * than no documentation: an integrator trusts the sample and builds against it.
 */
const assert = require('assert');
const { normalize } = require('../lib/normalize');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + ' :: ' + e.message); }
}

console.log('\n  docs/api.html examples must match real output\n');

// The "quickstart" example: one bad row.
const bad = normalize('Invoice Number,Currency,Subtotal,Tax,Total\nINV-1,USD,1000.00,200.00,9999.00', { format: 'auto' });

check('quickstart: ok is false', () => assert.strictEqual(bad.ok, false));
check('quickstart: row_count is 1', () => assert.strictEqual(bad.row_count, 1));
check('quickstart: exactly 1 error', () => assert.strictEqual(bad.summary.errors, 1));
check('quickstart: record total is 9999', () => assert.strictEqual(bad.records[0].total, 9999));
check('quickstart: subtotal 1000 + tax 200', () => {
  assert.strictEqual(bad.records[0].subtotal, 1000);
  assert.strictEqual(bad.records[0].tax, 200);
});
check('quickstart: ARITHMETIC_MISMATCH at source_row 2', () => {
  const i = bad.records[0].issues.find((x) => x.code === 'ARITHMETIC_MISMATCH');
  assert.ok(i, 'missing ARITHMETIC_MISMATCH');
  assert.strictEqual(i.severity, 'error');
  assert.strictEqual(i.source_row, 2);
});
check('quickstart: message says "off by 8799"', () => {
  const i = bad.records[0].issues.find((x) => x.code === 'ARITHMETIC_MISMATCH');
  assert.ok(/off by 8799/.test(i.message), i.message);
});
check('quickstart: currency is USD', () => {
  assert.strictEqual(bad.records[0].currency, 'USD');
});
check('quickstart: 3 warnings, avg_score 54 as documented', () => {
  assert.strictEqual(bad.summary.warnings, 3);
  assert.strictEqual(bad.summary.avg_score, 54);
});

// The "clean row" examples: one that still warns on absent optional fields, and
// one fully populated row that scores 100.
const clean = normalize('Invoice Number,Currency,Subtotal,Tax,Total\nINV-1,USD,1000.00,200.00,1200.00', { format: 'auto' });
check('clean row: ok is true with 0 errors', () => {
  assert.strictEqual(clean.ok, true);
  assert.strictEqual(clean.summary.errors, 0);
});
check('clean row: 3 warnings and avg_score 79 as documented', () => {
  assert.strictEqual(clean.summary.warnings, 3);
  assert.strictEqual(clean.summary.avg_score, 79);
});
check('fully populated row scores 100 with no warnings', () => {
  const full = normalize(
    'Invoice Number,Invoice Date,Due Date,Vendor,Currency,Subtotal,Tax,Total\n' +
    'INV-1,2026-01-05,2026-02-04,Acme,USD,1000.00,200.00,1200.00', { format: 'csv' });
  assert.strictEqual(full.summary.errors, 0);
  assert.strictEqual(full.summary.warnings, 0);
  assert.strictEqual(full.summary.avg_score, 100);
});

// Score formula documented as 100 - 25*errors - 7*warnings.
check('score = 100 - 25*errors - 7*warnings', () => {
  const errs = bad.records[0].issues.filter((i) => i.severity === 'error').length;
  const warns = bad.records[0].issues.filter((i) => i.severity === 'warning').length;
  const expected = Math.max(0, 100 - errs * 25 - warns * 7);
  assert.strictEqual(bad.records[0].score, expected);
});

// Documented claim: an empty cell is null, never 0.
check('empty cell yields null, not 0', () => {
  const r = normalize('Invoice Number,Subtotal,Tax,Total\nINV-2,1000.00,,\n', { format: 'csv' });
  assert.strictEqual(r.records[0].tax, null);
});

// Documented: 2026-02-31 is rejected.
check('2026-02-31 is rejected as invalid', () => {
  const r = normalize('Invoice Number,Invoice Date,Total\nINV-3,2026-02-31,100.00', { format: 'csv' });
  assert.strictEqual(r.records[0].issued_date, null);
});

// Documented: fuzzy header mapping.
check('"Doc Number (old)" maps to invoice_number', () => {
  const r = normalize('Doc Number (old),Grand Total\nINV-9,480.00', { format: 'csv' });
  assert.strictEqual(r.records[0].invoice_number, 'INV-9');
  assert.strictEqual(r.records[0].total, 480);
});

// Documented locale handling.
check("1.234,56 parses as 1234.56", () => {
  const r = normalize('Net;VAT;Gross\n1.234,56;190,00;1.424,56', { format: 'csv' });
  assert.strictEqual(r.records[0].subtotal, 1234.56);
  assert.strictEqual(r.records[0].tax, 190);
});

console.log(fail ? `\n  ${fail} documentation example(s) do not match reality\n` : '\n  all documentation examples match real output\n');
process.exit(fail ? 1 : 0);