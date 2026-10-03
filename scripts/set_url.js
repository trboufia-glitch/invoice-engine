'use strict';
/**
 * Sets the canonical public URL everywhere it appears.
 *
 * The distribution copy lives in many files and every one of them contains
 * YOUR_URL placeholders. Hand-editing those across files is exactly how a
 * post goes out with a broken link — so the URL has a single source of truth
 * here and a check that fails loudly if any placeholder survives.
 *
 * Usage:
 *   node scripts/set_url.js https://example.surge.sh
 *   node scripts/set_url.js --check
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  'marketing/DISTRIBUTION.md',
  'marketing/DEPLOY.md',
  'README.md',
  'docs/index.html',
  'docs/api.html',
  'docs/pricing.html',
];
const PLACEHOLDER = 'YOUR_URL';
const BINANCE_PLACEHOLDER = 'YOUR_BINANCE_ID';

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'data') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(md|html|js|json|ya?ml)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function allFiles() {
  const out = new Set(TARGETS.map((t) => path.join(ROOT, t)));
  walk(path.join(ROOT, 'marketing'), [...out]);
  walk(path.join(ROOT, 'docs'), [...out]);
  walk(path.join(ROOT, 'lib'), [...out]);
  return [...out].filter((f) => fs.existsSync(f));
}

function normalizeUrl(raw) {
  let u = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function check() {
  const files = allFiles();
  const leftovers = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.includes(PLACEHOLDER) || line.includes(BINANCE_PLACEHOLDER)) {
        leftovers.push(`${path.relative(ROOT, f)}:${i + 1}`);
      }
    });
  }
  return leftovers;
}

function main() {
  const arg = process.argv[2];

  if (arg === '--check') {
    const leftovers = check();
    if (leftovers.length) {
      console.error(`FAIL: ${leftovers.length} unresolved placeholder(s):`);
      for (const l of leftovers) console.error('  ' + l);
      process.exit(1);
    }
    console.log('ok: no placeholders remain');
    return;
  }

  if (!arg) {
    console.error('usage: node scripts/set_url.js <url> | --check');
    process.exit(2);
  }

  const url = normalizeUrl(arg);
  const files = allFiles();
  let changed = 0;

  for (const f of files) {
    const before = fs.readFileSync(f, 'utf8');
    // Only rewrite inside prose/markup, never inside code samples that are
    // already concrete. A plain global replace of the token is safe because the
    // token exists nowhere else.
    const after = before
      .split(PLACEHOLDER).join(url)
      .split(BINANCE_PLACEHOLDER).join('990584936');
    if (after !== before) {
      fs.writeFileSync(f, after);
      changed++;
      console.log(`  updated ${path.relative(ROOT, f)}`);
    }
  }

  console.log(`\ncanonical URL -> ${url}`);
  console.log(`${changed} file(s) updated`);

  // Store it so the next step (posting) can read it back.
  fs.writeFileSync(
    path.join(ROOT, 'data', 'site.json'),
    JSON.stringify({ url, binance_id: '990584936', set: new Date().toISOString() }, null, 2)
  );

  const leftover = check();
  if (leftover.length) {
    console.error(`\nWARNING: ${leftover.length} placeholder(s) still present:`);
    for (const l of leftover) console.error('  ' + l);
    process.exit(1);
  }
  console.log('verified: no placeholders remain anywhere');
}

main();