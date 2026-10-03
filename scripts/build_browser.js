'use strict';
/**
 * Builds a browser-usable bundle of lib/normalize.js for GitHub Pages.
 *
 * Why: lib/normalize.js is CommonJS and pure (no fs, no network), so it can run
 * unchanged in a browser. That turns the validator into a zero-backend,
 * zero-signup demo — the best distribution asset available, because anyone can
 * paste a file and get an answer without an API key, a plan, or a signup.
 *
 * Usage: node scripts/build_browser.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'lib', 'normalize.js');
const OUT_DIR = path.join(ROOT, 'docs');
const OUT_JS = path.join(OUT_DIR, 'invoice-normalize.js');

const source = fs.readFileSync(SRC, 'utf8');

// The library touches exactly one Node global: process.hrtime.bigint(), used only
// for the elapsed_ms field. A browser shim lets the source run verbatim.
const bundle = `/*!
 * invoice-normalize — browser build
 * Generated from lib/normalize.js by scripts/build_browser.js. Do not edit by hand.
 *
 * The engine is pure: no filesystem, no network, no LLM. That is what makes this
 * run client-side with no backend at all.
 */
(function (global) {
  'use strict';

  var process = {
    hrtime: {
      bigint: function () { return BigInt(Math.round(performance.now() * 1000000)); }
    }
  };

  var module = { exports: {} };

  (function (require, module, exports, process) {
${source}
  })(function (name) {
    throw new Error('require("' + name + '") is not available in the browser bundle');
  }, module, module.exports, process);

  global.InvoiceNormalize = module.exports.normalize;
  global.InvoiceCore = module.exports;
})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_JS, bundle);

// Verify before shipping. A bundle that only fails in the visitor's browser is
// worse than no bundle, so parse it AND run real inputs through it.
const sandbox = { performance: { now: () => 0 }, console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(bundle, sandbox, { filename: 'invoice-normalize.js' });

const fn = sandbox.InvoiceNormalize;
if (typeof fn !== 'function') {
  console.error('FAIL: bundle built but InvoiceNormalize was not exported');
  process.exit(1);
}

const probe = fn('Invoice Number,Subtotal,Tax,Total\nI-1,100.00,20.00,1200.00', { format: 'csv' });
if (!probe || probe.row_count !== 1) {
  console.error('FAIL: bundle built but normalize() did not produce a record');
  process.exit(1);
}
if (!(probe.summary.errors >= 1)) {
  console.error('FAIL: expected the arithmetic error to be detected in the browser build');
  process.exit(1);
}

// Confirm the European-decimal path survives bundling — that was the bug that
// silently corrupted half the target market.
const eu = fn('Invoice No;Net;VAT;Gross\nR-1;1.000,00;190,00;1.190,00', { format: 'csv' });
if (!eu || eu.records[0].total !== 1190) {
  console.error('FAIL: European decimal parsing regressed in the browser build');
  process.exit(1);
}

console.log(`browser bundle ok -> ${OUT_JS}`);
console.log(`  size            ${(bundle.length / 1024).toFixed(1)} KB`);
console.log(`  csv/arithmetic  ${probe.row_count} row, ${probe.summary.errors} error detected`);
console.log(`  EU decimals     1.000,00 + 190,00 -> ${eu.records[0].total}`);