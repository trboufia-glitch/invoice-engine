'use strict';
/**
 * Exercises the browser page's export helpers by extracting them from
 * docs/index.html and running them against a real normalize() result.
 *
 * The download buttons are the conversion mechanism — if they silently emit an
 * empty file, the whole funnel breaks and nothing in the UI would say so.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { normalize } = require('../lib/normalize');

const page = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
// The page now contains two inline <script> blocks: the beacon and the app.
// Splitting on '<script>' and taking .pop() grabbed the beacon, so the helpers
// under test were never defined. Take the LAST inline block instead, which is
// the app, and assert it actually defines them.
const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
// Select by CONTENT, never by position: the analytics beacon is appended last,
// so the final block is not the app. Position-based selection silently tested
// the wrong code and reported nine unrelated failures.
const script = inline.find((s) => /function\s+run\s*\(/.test(s));
if (!script) {
  throw new Error('could not locate the app script block (found ' + inline.length + ' inline blocks)');
}

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + ' :: ' + e.message); }
}

console.log('\n  docs/index.html export helpers\n');

// INV-1 is fully populated and reconciles, so it is genuinely clean and must NOT
// appear in the problem export. INV-2 reconciles wrongly.
const CLEAN_ROW = 'INV-1,2026-01-05,2026-02-04,Acme,USD,1000.00,200.00,1200.00';
const BAD_ROW = 'INV-2,2026-01-06,2026-03-06,Globex,USD,500.00,100.00,9999.00';
const FIXTURE = 'Invoice Number,Invoice Date,Due Date,Vendor,Currency,Subtotal,Tax,Total\n'
  + CLEAN_ROW + '\n' + BAD_ROW;

check('the fixture is genuinely clean except INV-2', () => {
  const d = normalize(FIXTURE, { format: 'csv' });
  assert.strictEqual(d.summary.errors, 1, 'fixture should have exactly 1 error');
  assert.strictEqual(d.summary.warnings, 0, 'fixture should have no warnings');
});

// Minimal DOM so the page script can attach without a browser.
const sandbox = {
  console,
  performance: { now: () => 0 },
  document: {
    getElementById: (id) => ({
      value: '', innerHTML: '', innerText: '', checked: true, textContent: '',
      style: {}, querySelectorAll: () => [],
    }),
    createElement: () => ({ style: {}, click() {}, remove() {}, set href(v) { this._href = v; } }),
    body: { appendChild() {} },
    querySelectorAll: () => [],
  },
  Blob: class { constructor(parts) { this.parts = parts; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  setTimeout,
  InvoiceNormalize: normalize,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'docs/index.html' });

check('page script parses without error', () => {
  assert.strictEqual(typeof sandbox.run, 'function');
});

check('errorCSV() is defined and reachable', () => {
  assert.strictEqual(typeof sandbox.errorCSV, 'function');
  assert.strictEqual(typeof sandbox.toJSON, 'function');
});

const result = normalize(FIXTURE, { format: 'csv' });
sandbox.window._lastResult = result;

check('toJSON() emits parseable JSON with the records', () => {
  const out = sandbox.toJSON();
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.records.length, 2);
  assert.strictEqual(parsed.summary.errors, 1);
});

check('errorCSV() includes a header row and only problem rows', () => {
  const csv = sandbox.errorCSV();
  const lines = csv.split('\n');
  assert.strictEqual(lines.length, 2, 'expected header + the one bad row, got:\n' + csv);
  assert.ok(lines[0].startsWith('source_row,invoice_number'), lines[0]);
  assert.ok(/INV-2/.test(lines[1]), 'the bad row should be INV-2, got: ' + lines[1]);
  assert.ok(!/INV-1/.test(lines[1]), 'the clean row should not be the exported one: ' + lines[1]);
  assert.ok(/INV-2/.test(csv), csv);
});

check('problemCount() counts only rows needing attention', () => {
  sandbox.window._lastResult = normalize(FIXTURE, { format: 'csv' });
  assert.strictEqual(sandbox.problemCount(), 1);
});

check('warnings are marked with ? and errors with !', () => {
  sandbox.window._lastResult = normalize(
    'Invoice Number,Invoice Date,Vendor,Currency,Subtotal,Tax Rate,Tax,Total\n' +
    'INV-1,2026-01-05,Acme,USD,1000.00,20,100.00,1100.00', { format: 'csv' });
  const csv = sandbox.errorCSV();
  assert.ok(/TAX_RATE_MISMATCH\?/.test(csv), csv);
});

check('errorCSV() flags errors with a bang so they sort visibly', () => {
  // Re-set the shared fixture: the preceding check replaced it with a
  // warning-only result, so relying on order here would be flaky.
  sandbox.window._lastResult = normalize(FIXTURE, { format: 'csv' });
  const csv = sandbox.errorCSV();
  assert.ok(/ARITHMETIC_MISMATCH!/.test(csv), csv);
});

check('errorCSV() quotes values containing commas', () => {
  const tricky = normalize(
    'Invoice Number,Vendor,Currency,Subtotal,Tax,Total\n' +
    'INV-9,"Smith, Jones & Co",USD,100.00,20.00,999.00', { format: 'csv' });
  sandbox.window._lastResult = tricky;
  const csv = sandbox.errorCSV();
  assert.ok(/"Smith, Jones & Co"/.test(csv), csv);
});

check('a fully clean file exports header only', () => {
  const ok = normalize(
    'Invoice Number,Invoice Date,Due Date,Vendor,Currency,Subtotal,Tax,Total\n' + CLEAN_ROW,
    { format: 'csv' });
  sandbox.window._lastResult = ok;
  assert.strictEqual(ok.summary.errors, 0);
  assert.strictEqual(ok.summary.warnings, 0);
  assert.strictEqual(sandbox.problemCount(), 0);
  assert.strictEqual(sandbox.errorCSV().split('\n').length, 1); // header only
});

console.log(fail ? `\n  ${fail} export helper check(s) failed\n` : '\n  all export helpers work\n');
process.exit(fail ? 1 : 0);