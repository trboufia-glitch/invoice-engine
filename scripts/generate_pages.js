#!/usr/bin/env node
'use strict';
/**
 * Generates a page per failure mode, each targeting one long-tail search phrase.
 *
 * Why: ranking for "invoice validator" is decided by an EU government portal, a
 * mandatory standard and funded vendors — unwinnable head-on. Long-tail phrases
 * are winnable, and a page per failure mode is the honest way to cover them:
 * each page answers one specific question a European accountant actually types.
 *
 * Every page is generated from one source so the technical claims cannot drift
 * between them, and every page links to the checker.
 *
 * Usage: node scripts/generate_pages.js
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const SITE = 'https://invoice-checker-ie.surge.sh';

// Each entry: the search phrase it answers, and the content that answers it.
// The "proof" is a real input and the real output the engine produces.
const PAGES = [
  {
    slug: 'csv-invoice-total-mismatch',
    h1: 'Subtotal + tax does not equal total — what causes it and how to find the row',
    desc: 'The four causes of an invoice CSV row whose subtotal plus tax does not equal its total, with the arithmetic that identifies each one and a free checker.',
    phrase: 'csv invoice total mismatch',
    lead: 'A row where <code>subtotal + tax ≠ total</code> is not a rounding problem. It is one of four specific defects, and each one has a different fix.',
    sections: [
      {
        h: '1. A tax line that was never filled in',
        body: `<p>An empty cell in a spreadsheet is <b>zero</b>, not missing. So a blank VAT line produces a total that is short by exactly the tax, and it still looks plausible.</p>
        <p>This is the most common cause and the most expensive, because nothing looks broken.</p>
        <pre>subtotal   1,000.00
VAT            0.00   <span style="color:#8b98ab">← the cell was empty, not zero</span>
total       1,000.00   <span style="color:#f87171">← should be 1,200.00</span></pre>
        <p><b>Fix:</b> treat an empty cell as absent. If <code>total − subtotal</code> is non-zero but no tax value was found, the tax is missing — not zero.</p>`,
      },
      {
        h: '2. The stated rate does not produce the stated amount',
        body: `<p>The row reconciles perfectly and is still wrong, because the rate is wrong.</p>
        <pre>subtotal   1,000.00
VAT 20%      100.00   <span style="color:#f87171">← 20% of 1,000 is 200</span>
total       1,100.00   <span style="color:#8b98ab">← internally consistent, externally wrong</span></pre>
        <p><b>Fix:</b> recompute <code>tax ÷ subtotal</code> and compare it to the rate printed on the document.</p>`,
      },
      {
        h: '3. A discount applied twice, or not at all',
        body: `<p>The discrepancy is a round percentage and the tax is proportionally off too.</p>
        <p>Discounts get applied at line level, at invoice level, or both, and exports do not always agree which. When tax is computed on a discounted subtotal but the total subtracts the discount twice, the row stops reconciling.</p>
        <p><b>Fix:</b> recompute from the line items rather than trusting the stated total.</p>`,
      },
      {
        h: '4. European decimals parsed as thousands separators',
        body: `<p>The total is wrong by a factor of a thousand, and only for some suppliers.</p>
        <p>A German or French export writes <code>1.234,56</code>. A parser assuming the US convention reads the dot as a thousands separator.</p>
        <pre><span style="color:#f87171">1.234,56  parsed as 123456   → off by 1000×</span>
<span style="color:#f87171">1.234,56  parsed as 1234.56  → wrong by a decimal place</span>
1.234,56  parsed as 1234.56  <span style="color:#4ade80">← correct</span></pre>
        <p><b>Fix:</b> parse on the <b>last</b> separator. Whichever of <code>.</code> or <code>,</code> comes last is the decimal point.</p>`,
      },
    ],
  },
  {
    slug: 'semicolon-delimited-csv',
    h1: 'Semicolon-delimited CSV: why the whole file collapses into one column',
    desc: 'Locales using a comma decimal separator also use a semicolon field delimiter. A parser that splits on commas reads the entire export as a single cell — silently.',
    phrase: 'semicolon delimited csv',
    lead: 'A <code>;</code>-delimited file read by a comma-splitting parser produces no error at all. It produces one very long column, and every row looks like valid text.',
    sections: [
      {
        h: 'What the file actually contains',
        body: `<pre><span style="color:#8b98ab">// a real German export</span>
Invoice No;Net;MwSt;Gesamt
R-77;1.000,00;190,00;1.190,00
R-78;2.500,50;475,10;2.975,60</pre>`,
      },
      {
        h: 'What a comma-splitting parser sees',
        body: `<pre>field 1: <span style="color:#f87171">"Invoice No;Net;MwSt;Gesamt"</span>
field 1: <span style="color:#f87171">"R-77;1.000,00;190,00;1.190,00"</span>

<span style="color:#8b98ab">// one column. no exception. no error.</span></pre>
        <p>This is the dangerous failure mode. A missing column usually throws. A wrong delimiter does not — it returns structurally valid garbage that is indistinguishable from a real record until somebody queries the invoice.</p>
        <p><b>Fix:</b> count <code>,</code> <code>;</code> tab and <code>|</code> across the first few lines and split on whichever wins. Then confirm the header row produced the column count you expect.</p>`,
      },
      {
        h: 'Where it comes from',
        body: `<p>Excel writes <code>;</code> as the delimiter when the regional settings use a comma as the decimal separator. Exporting to CSV from a German, French, Spanish, Italian or Portuguese locale produces exactly this, and it is correct data being read wrong.</p>
        <p>Two other separators appear in the wild: a space (<code>1 234,56</code>) and an apostrophe (<code>1'234.50</code>, Swiss). A robust parser handles all three.</p>`,
      },
    ],
  },
  {
    slug: 'invoice-tax-rate-mismatch',
    h1: 'Tax rate mismatch: the invoice adds up and is still wrong',
    desc: 'A stated VAT or sales tax rate that does not produce the amount on the document. The row reconciles, so arithmetic checks miss it. How to detect and correct it.',
    phrase: 'tax rate mismatch invoice',
    lead: 'The most dangerous defect is the one that passes every total check. The invoice is internally consistent and externally wrong.',
    sections: [
      {
        h: 'What it looks like',
        body: `<pre>subtotal      1,000.00
rate            20%      <span style="color:#8b98ab">← stated</span>
tax            100.00   <span style="color:#f87171">← 20% of 1,000 is 200.00</span>
total          1,100.00   <span style="color:#8b98ab">← subtotal + tax. reconciles.</span></pre>
        <p>Any check that only verifies <code>subtotal + tax = total</code> passes this row. The error is in the rate, and the rate is the part a customer reads.</p>`,
      },
      {
        h: 'Why it happens',
        body: `<ul>
        <li>An exemption or reduced rate applied without changing the printed rate</li>
        <li>A rate from a different jurisdiction left on the template</li>
        <li>Rounding applied to the tax before it was written</li>
        <li>Zero-rated or reverse-charge lines taxed at the standard rate</li>
        </ul>`,
      },
      {
        h: 'How to detect it',
        body: `<p>Do not trust the rate field. Recompute it:</p>
        <pre>implied rate = tax ÷ subtotal × 100
compare implied rate to stated rate
tolerance: about 0.5% of subtotal</pre>
        <p>A mismatch of more than half a percent of the subtotal is not rounding. On the example above the implied rate is 10%, not the stated 20% — a 10-point gap that no amount of rounding explains.</p>
        <p><b>What this cannot do:</b> tell you which rate was correct. Only your jurisdiction and the transaction type determine that.</p>`,
      },
    ],
  },
];

function page(p) {
  const body = p.sections.map((s) => `    <section>
      <h2>${s.h}</h2>
      ${s.body}
    </section>`).join('\n\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.h1}</title>
<meta name="description" content="${p.desc}">
<style>
  :root{--bg:#0a0c10;--panel:#11151c;--line:#1e2530;--fg:#e6edf6;--dim:#8b98ab;--acc:#4ade80;--err:#f87171;--mono:ui-monospace,Menlo,Consolas,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.68 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:0 20px}
  header{border-bottom:1px solid var(--line);padding:20px 0}
  .logo{font-family:var(--mono);font-weight:700}.logo span{color:var(--acc)}
  h1{font-size:clamp(25px,4.2vw,34px);line-height:1.16;margin:38px 0 14px;letter-spacing:-1px}
  h2{font-size:20px;margin:38px 0 12px;letter-spacing:-.4px}
  p{margin:0 0 15px}
  .lede{color:var(--dim);font-size:18px}
  pre{background:#07090c;border:1px solid var(--line);border-radius:10px;padding:15px;overflow-x:auto;font-family:var(--mono);font-size:12.5px;line-height:1.62;color:#c9d6e5;margin:14px 0}
  code{font-family:var(--mono);font-size:14px;background:#07090c;padding:2px 7px;border-radius:5px;border:1px solid var(--line)}
  ul{padding-left:22px}li{margin:7px 0;color:var(--dim)}
  .cta{background:linear-gradient(180deg,rgba(74,222,128,.09),rgba(74,222,128,.03));border:1px solid rgba(74,222,128,.35);border-radius:14px;padding:22px;margin:30px 0}
  .cta h2{margin:0 0 9px}.cta p{color:var(--dim)}
  .btn{display:inline-block;padding:12px 22px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px;background:var(--acc);color:#04120a;margin:8px 8px 0 0}
  .btn.sec{background:var(--panel);color:var(--fg);border:1px solid var(--line)}
  footer{border-top:1px solid var(--line);margin-top:42px;padding:22px 0;color:var(--dim);font-size:14.5px}
  a{color:var(--acc)}
  .phrase{font-family:var(--mono);font-size:11.5px;color:var(--dim);border:1px solid var(--line);border-radius:20px;padding:3px 10px;display:inline-block;margin-top:6px}
</style>
</head>
<body>
<div class="wrap">
  <header><div class="logo">invoice<span>.engine</span></div></header>

  <h1>${p.h1}</h1>
  <p class="lede">${p.lead}</p>
  <span class="phrase">${p.phrase}</span>

${body}

  <div class="cta">
    <h2>Check a file</h2>
    <p>Paste the CSV and see which rows do not reconcile, with the numbers side by side. It runs in your browser tab — nothing is uploaded, no signup, free with no limits.</p>
    <a class="btn" href="./index.html">Open the checker →</a>
    <a class="btn sec" href="./european-csv-invoice.html">European CSV formats</a>
  </div>

  <footer>
    <a href="./index.html">Free invoice checker</a> ·
    <a href="./why-totals-dont-add-up.html">All five causes</a> ·
    <a href="./api.html">API</a> ·
    <a href="https://github.com/trboufia-glitch/invoice-engine">Source</a><br>
    Deterministic — regex and arithmetic, no model, so no invoice number is ever invented.
  </footer>
</div>
</body>
</html>
`;
}

function main() {
  let written = 0;
  for (const p of PAGES) {
    const file = path.join(DOCS, p.slug + '.html');
    fs.writeFileSync(file, page(p));
    console.log(`  wrote ${p.slug}.html  (targets: ${p.phrase})`);
    written++;
  }

  // Register in sitemap, hub, and the social-meta table.
  const sitemapPath = path.join(DOCS, 'sitemap.xml');
  let xml = fs.readFileSync(sitemapPath, 'utf8');
  for (const p of PAGES) {
    if (xml.includes(p.slug)) continue;
    xml = xml.replace('</urlset>', `  <url>
    <loc>${SITE}/${p.slug}.html</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`);
  }
  fs.writeFileSync(sitemapPath, xml);
  console.log('  sitemap updated');

  const hubPath = path.join(DOCS, 'hub.html');
  let hub = fs.readFileSync(hubPath, 'utf8');
  for (const p of PAGES) {
    if (hub.includes(p.slug)) continue;
    hub = hub.replace('<a href="./european-csv-invoice.html">',
      `<a href="./${p.slug}.html"><b>${p.phrase}</b><span>${p.desc.slice(0, 96)}…</span></a>\n<a href="./european-csv-invoice.html">`);
  }
  fs.writeFileSync(hubPath, hub);
  console.log('  hub updated');

  // Feed the meta generator so new pages get share cards.
  const metaPath = path.join(__dirname, 'add_social_meta.js');
  let meta = fs.readFileSync(metaPath, 'utf8');
  for (const p of PAGES) {
    if (meta.includes(p.slug)) continue;
    meta = meta.replace("  'hub.html': {",
      `  '${p.slug}': {\n    title: ${JSON.stringify(p.h1)},\n    desc: ${JSON.stringify(p.desc)},\n  },\n  'hub.html': {`);
  }
  fs.writeFileSync(metaPath, meta);
  console.log('  social-meta table updated');

  console.log(`\n${written} page(s) generated`);
}

main();