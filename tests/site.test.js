'use strict';
/**
 * Verifies the static site in docs/ is coherent: every internal link resolves,
 * the generated bundle is present and current, and the pages are cross-linked
 * so a visitor landing on any one of them can reach the tool.
 *
 * A broken link in a marketing page is the most expensive trivial bug: it costs
 * the visit, and nothing on the page indicates anything went wrong.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const BUNDLE = path.join(DOCS, 'invoice-normalize.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + ' :: ' + e.message); }
}

console.log('\n  docs/ site integrity\n');

const pages = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html'));
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

check('the expected pages exist', () => {
  for (const required of ['index.html', 'pricing.html', 'api.html', 'hub.html', 'why-totals-dont-add-up.html']) {
    assert.ok(pages.includes(required), `missing ${required}`);
  }
});

check('the generated bundle is present', () => {
  assert.ok(fs.existsSync(BUNDLE), 'invoice-normalize.js is missing — run npm run build:browser');
  assert.ok(fs.statSync(BUNDLE).size > 5000, 'bundle is suspiciously small');
});

check('the bundle is current with lib/normalize.js', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build_browser.js')],
    { cwd: ROOT, stdio: 'pipe' });
  const dirty = execFileSync('git', ['status', '--porcelain', 'docs/invoice-normalize.js'],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(dirty, '', 'bundle differs from lib/normalize.js — rebuild and commit');
});

check('every internal link resolves to a real file', () => {
  const present = fs.readdirSync(DOCS);
  const broken = [];
  for (const f of pages) {
    const html = read(f);
    // Use capture groups rather than slicing the whole match: slicing a
    // `href="./x.html"` string by fixed offsets drops the leading ./ and makes a
    // perfectly valid link look broken.
    for (const m of html.matchAll(/href="(\.\/[^"#]+)"/g)) {
      const target = m[1].replace(/^\.\//, '');
      if (!present.includes(target)) broken.push(`${f} -> ${target}`);
    }
    for (const m of html.matchAll(/src="([^"]+\.js)"/g)) {
      const target = m[1].replace(/^\.\//, '');
      if (!present.includes(target)) broken.push(`${f} -> ${target}`);
    }
  }
  assert.strictEqual(broken.length, 0, 'broken links:\n  ' + broken.join('\n  '));
});

check('every page links to the checker (the conversion path)', () => {
  const missing = pages.filter((f) => f !== 'index.html' && !read(f).includes('./index.html'));
  assert.strictEqual(missing.length, 0, 'no route to the tool from: ' + missing.join(', '));
});

check('hub.html indexes every page', () => {
  const hub = read('hub.html');
  const missing = pages.filter((f) => f !== 'hub.html' && !hub.includes(f));
  assert.strictEqual(missing.length, 0, 'hub does not link: ' + missing.join(', '));
});

check('no page leaks an internal placeholder', () => {
  const bad = [];
  for (const f of pages) {
    read(f).split(/\r?\n/).forEach((line, i) => {
      if (line.includes('YOUR_URL') || line.includes('YOUR_BINANCE_ID')) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.strictEqual(bad.length, 0, 'placeholders: ' + bad.join(', '));
});

check('the checker page declares it runs client-side', () => {
  const html = read('index.html');
  assert.ok(/nothing is uploaded|Nothing is uploaded/i.test(html), 'no privacy claim found');
  assert.ok(/src="invoice-normalize\.js"|src="\.\/invoice-normalize\.js"/.test(html),
    'page does not load the bundle');
});

console.log(fail ? `\n  ${fail} site check(s) failed\n` : `\n  all ${pages.length} pages coherent\n`);
process.exit(fail ? 1 : 0);