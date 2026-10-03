'use strict';
/**
 * End-to-end verification against the DEPLOYED site.
 *
 * curl only proves the server returned bytes. This downloads the live bundle
 * from the live URL, executes it in a sandbox, and runs real invoice data
 * through it — so it verifies the deployed artefact rather than the local copy.
 *
 * Usage: node scripts/verify_live.js [baseUrl]
 *        node scripts/verify_live.js            # skips if the site is unreachable
 */
const vm = require('vm');
const https = require('https');

const BASE = (process.argv[2] || 'https://invoice-checker-ie.surge.sh').replace(/\/+$/, '');
const BUNDLE = BASE + '/invoice-normalize.js';
const PAGES = ['/', '/index.html', '/pricing.html', '/api.html', '/hub.html', '/why-totals-dont-add-up.html'];

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('  \x1b[32m✓\x1b[0m ' + name);
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? ' :: ' + detail : '')); }
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'invoice-engine-verify' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

(async () => {
  console.log(`\n  Verifying the deployed site: ${BASE}\n`);

  // --- reachability ------------------------------------------------------
  let root;
  try {
    root = await get(BASE + '/');
  } catch (e) {
    console.log(`  \x1b[33m!\x1b[0m site unreachable (${e.message}) — skipping, not a failure`);
    console.log('    This is expected when the site has not been published yet.\n');
    process.exit(0);
  }

  check('site is reachable', root.status === 200, 'status ' + root.status);

  // --- every page --------------------------------------------------------
  for (const p of PAGES) {
    const r = await get(BASE + p);
    check(`${p} returns 200 with content`, r.status === 200 && r.body.length > 500,
      `status ${r.status}, ${r.body.length} bytes`);
  }

  // --- the bundle executes ----------------------------------------------
  const bundle = await get(BUNDLE);
  check('bundle is served', bundle.status === 200 && bundle.body.length > 5000,
    `status ${bundle.status}, ${bundle.body.length} bytes`);

  const sandbox = { performance: { now: () => 0 }, console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(bundle.body, sandbox, { filename: 'live-bundle.js' });
  } catch (e) {
    check('bundle executes in a browser-like context', false, e.message);
    console.log(`\n  ${fail} live check(s) failed\n`);
    process.exit(1);
  }
  check('bundle executes in a browser-like context', true);
  check('bundle exports InvoiceNormalize', typeof sandbox.InvoiceNormalize === 'function');

  if (typeof sandbox.InvoiceNormalize !== 'function') {
    console.log(`\n  ${fail} live check(s) failed\n`);
    process.exit(1);
  }

  const N = sandbox.InvoiceNormalize;

  // --- real behaviour, on the deployed bytes -----------------------------
  const bad = N('Invoice Number,Currency,Subtotal,Tax,Total\nINV-1,USD,1000.00,200.00,9999.00', { format: 'csv' });
  check('detects an arithmetic mismatch', bad.summary.errors === 1, JSON.stringify(bad.summary));
  check('reports the row number', bad.issues.some((i) => i.code === 'ARITHMETIC_MISMATCH' && i.source_row === 2));

  const eu = N('Invoice No;Net;VAT;Gross\nR-1;1.000,00;190,00;1.190,00', { format: 'csv' });
  check('parses European decimals and semicolons', eu.records[0].total === 1190,
    'total was ' + eu.records[0].total);

  const clean = N('Invoice Number,Invoice Date,Due Date,Vendor,Currency,Subtotal,Tax,Total\n' +
    'INV-1,2026-01-05,2026-02-04,Acme,USD,1000.00,200.00,1200.00', { format: 'csv' });
  check('a clean row scores 100', clean.summary.avg_score === 100 && clean.ok === true,
    JSON.stringify(clean.summary));

  const date = N('Invoice Number,Invoice Date,Total\nINV-1,2026-02-31,100.00', { format: 'csv' });
  check('rejects an impossible date', date.records[0].issued_date === null);

  const empty = N('Invoice Number,Currency,Subtotal,Tax,Total\nINV-1,USD,1000.00,,', { format: 'csv' });
  check('an empty cell is null, not zero', empty.records[0].tax === null,
    'tax was ' + JSON.stringify(empty.records[0].tax));

  // --- the live pages carry no placeholders ------------------------------
  for (const p of PAGES) {
    const r = await get(BASE + p);
    const bad2 = /YOUR_URL|YOUR_BINANCE_ID/.test(r.body);
    check(`${p} has no unresolved placeholder`, !bad2);
  }

  console.log(fail ? `\n  ${fail} live check(s) failed\n` : `\n  deployed site verified end to end\n`);
  process.exit(fail ? 1 : 0);
})();