'use strict';
/**
 * Renders the page's result panel exactly as a browser would, by executing the
 * real page script against a real normalize() result.
 *
 * Why: reading the HTML proves the source is syntactically valid, not that the
 * visitor sees a sensible label. A button reading "Download the " + problems +
 * " problem row" would be syntactically perfect and still be a visible defect.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { normalize } = require('../lib/normalize');

const page = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const script = inline.find((s) => /function\s+run\s*\(/.test(s));

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + ' :: ' + e.message); }
}

console.log('\n  What a visitor actually sees after clicking Check it\n');

// A minimal DOM that records what the page writes.
const els = {};
function el(id) {
  if (!els[id]) {
    const o = { _html: '', _text: '', value: '', checked: true, textContent: '' };
    const strip = (v) => String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // Mirror the HTML into readable text so assertions check what a person sees,
    // not which property the page happened to assign. Plain fields, not accessors:
    // a getter/setter pair on the same name recurses into a stack overflow.
    Object.defineProperties(o, {
      innerHTML: { get() { return o._html; }, set(v) { o._html = v; o._text = strip(v); } },
      innerText: { get() { return o._text; }, set(v) { o._text = strip(v); } },
    });
    els[id] = o;
  }
  return els[id];
}
const sandbox = {
  console,
  performance: { now: () => 0 },
  document: {
    getElementById: el,
    createElement: () => ({ style: {}, click() {}, remove() {} }),
    body: { appendChild() {} },
    querySelectorAll: () => [],
  },
  Blob: class { constructor(p) { this.p = p; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  setTimeout,
  fetch: async () => ({ ok: true, json: async () => ({ api_key: 'k', credits: 25 }) }),
  InvoiceNormalize: normalize,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'index.html' });

// The "Broken totals" sample the visitor is most likely to click.
sandbox.s(1);
sandbox.run();

const out = el('out').innerHTML;
const msg = el('msg').innerText;
const stats = el('stats').innerText;

console.log('  headline :', msg);
console.log('  stats    :', stats.replace(/\n/g, ' '));
console.log('\n  buttons visible:');
for (const m of out.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)) {
  const label = m[1].replace(/<[^>]+>/g, '').trim();
  console.log(`    "${label}"`);
}
console.log('');

check('result panel is populated', () => {
  assert.ok(out.includes('<table'), 'no results table rendered');
});

check('no raw JavaScript leaks into any button label', () => {
  for (const m of out.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)) {
    const label = m[1].replace(/<[^>]+>/g, '').trim();
    assert.ok(!/\+\s*problems|\?\s*:\s*|''|\bconcat\b|undefined|NaN/.test(label),
      'button label contains code or a bad value: "' + label + '"');
  }
});

check('the problem-rows button states a real count', () => {
  assert.ok(/Download the \d+ flagged rows? \(CSV\)/.test(out),
    'expected a concrete count in the label, got: ' +
    (out.match(/Download the[^<]*/) || ['(none)'])[0]);
});

check('the headline and the button do not contradict each other', () => {
  // "2 rows do not add up" next to "the 5 flagged rows" read as the tool
  // disagreeing with itself. The headline now states both figures explicitly.
  const headline = el('msg').innerText;
  const btn = (out.match(/Download the (\d+) flagged/) || [])[1];
  const blocking = (headline.match(/^(\d+) of/) || [])[1];
  assert.ok(btn && blocking, 'could not read both counts: ' + headline + ' / ' + btn);
  assert.ok(Number(btn) >= Number(blocking),
    'flagged count is lower than the blocking count — impossible: ' + blocking + ' vs ' + btn);
  assert.ok(headline.includes('further') || Number(btn) === Number(blocking),
    'the difference between the two counts is never explained: ' + headline);
});

check('the visitor is told what happened, not just shown numbers', () => {
  assert.ok(msg.length > 20, 'message is too terse to act on');
  assert.ok(/do not add up|warning|Clean/i.test(msg), 'message does not state the outcome: ' + msg);
});

check('a clean file says so plainly', () => {
  sandbox.s(0);
  sandbox.run();
  const cleanMsg = el('msg').innerText;
  assert.ok(/clean|passed every check/i.test(cleanMsg), 'clean result did not read as clean: ' + cleanMsg);
  assert.ok(!/Download the \d/.test(el('out').innerHTML),
    'a clean file still offers a problem-rows download');
});

check('empty input is refused with guidance, not an error dump', () => {
  el('in').value = '';
  sandbox.run();
  const m2 = el('msg').innerText;
  assert.ok(/paste some data/i.test(m2), 'unhelpful message: ' + m2);
});

check('the headline states the problem, not the feature', () => {
  const h1 = page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(h1, 'no h1');
  const text = h1[1].replace(/<[^>]+>/g, '').trim();
  assert.ok(/≠|not add up|do not add up/i.test(text),
    'h1 leads with the feature instead of the failure: ' + text);
});

console.log(fail ? `\n  ${fail} visitor-experience check(s) failed\n` : '\n  the page reads correctly to a visitor\n');
process.exit(fail ? 1 : 0);