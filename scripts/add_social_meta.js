#!/usr/bin/env node
'use strict';
/**
 * Injects Open Graph and Twitter card metadata into every page in docs/.
 *
 * Why this matters concretely: when the URL is pasted into WhatsApp, Slack,
 * LinkedIn or X, the platform fetches the page and renders a card from og:*
 * tags. Without them the share is a bare naked link with no title and no image,
 * which is the single largest brake on someone forwarding the tool to a
 * colleague. This runs over the files rather than editing six pages by hand so
 * the metadata cannot drift between them.
 *
 * Usage: node scripts/add_social_meta.js
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const SITE = 'https://invoice-checker-ie.surge.sh';

// One description per page. A single generic description across six pages reads
// as spam to both the platform and the person deciding whether to click.
const META = {
  'index.html': {
    title: 'Free invoice CSV checker — finds the rows that do not add up',
    desc: 'Paste an invoice CSV and see which rows fail: subtotal + tax ≠ total, tax rate mismatches, impossible dates. Runs in your browser, nothing uploaded.',
  },
  'why-totals-dont-add-up.html': {
    title: 'Why your invoice totals do not add up — the five real causes',
    desc: 'Blank tax lines, rate mismatches, double discounts, European decimals parsed as thousands separators, and lost semicolon delimiters.',
  },
  'pricing.html': {
    title: 'Free forever in your browser — when the API is worth paying for',
    desc: 'The browser checker is free with no limits. The paid API exists for one reason: running the check automatically inside your own pipeline.',
  },
  'api.html': {
    title: 'Invoice validation API — one POST, every broken row',
    desc: 'Deterministic invoice and CSV validation API. No model call, so no invented invoice numbers and identical output for identical input.',
  },
  'european-csv-invoice.html': {
    title: 'European invoice CSV: fix 1.234,56, semicolons and comma decimals',
    desc: 'A CSV with 1.234,56 and semicolon delimiters breaks most validators silently — wrong numbers, no error. Here is what goes wrong and a free checker that handles it.',
  },
  'hub.html': {
    title: 'invoice.engine — clean, validated invoice data',
    desc: 'A deterministic invoice and CSV validator that runs entirely in your browser. No signup, no upload.',
  },
};

// A generated SVG keeps the repo dependency-free while still giving every share
// a real image. Written to docs/ so it is served alongside the pages.
const OG_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0a0c10"/>
  <rect x="0" y="0" width="1200" height="6" fill="#4ade80"/>
  <text x="80" y="150" font-family="Menlo,Consolas,monospace" font-size="30" fill="#4ade80">invoice.engine</text>
  <text x="80" y="260" font-family="Helvetica,Arial,sans-serif" font-size="66" font-weight="700" fill="#e6edf6">Invoices that</text>
  <text x="80" y="336" font-family="Helvetica,Arial,sans-serif" font-size="66" font-weight="700" fill="#e6edf6">do not add up</text>
  <text x="80" y="410" font-family="Menlo,Consolas,monospace" font-size="27" fill="#8b98ab">subtotal + tax  ≠  total</text>
  <text x="80" y="470" font-family="Menlo,Consolas,monospace" font-size="27" fill="#f87171">&#8599; found, with the row number</text>
  <text x="80" y="540" font-family="Menlo,Consolas,monospace" font-size="23" fill="#8b98ab">runs in your browser &#183; nothing uploaded</text>
</svg>
`;

function metaTags(key) {
  const m = META[key];
  const url = key === 'index.html' ? `${SITE}/` : `${SITE}/${key}`;
  const title = m.title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const desc = m.desc.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="invoice.engine">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${SITE}/og-cover.svg">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="invoice.engine — finds invoices that do not add up">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${SITE}/og-cover.svg">`,
  ].join('\n  ');
}

function main() {
  fs.writeFileSync(path.join(DOCS, 'og-cover.svg'), OG_IMAGE);
  console.log('wrote og-cover.svg');

  let touched = 0;
  for (const key of Object.keys(META)) {
    const file = path.join(DOCS, key);
    if (!fs.existsSync(file)) {
      console.log(`  skip ${key} (not found)`);
      continue;
    }
    let html = fs.readFileSync(file, 'utf8');

    // Idempotent: remove any previous block, then re-insert.
    html = html.replace(/\n\s*<!-- OG:START -->[\s\S]*?<!-- OG:END -->\n?/g, '\n');

    const block = `\n  <!-- OG:START — generated by scripts/add_social_meta.js. Do not edit by hand. -->\n  ${metaTags(key)}\n  <!-- OG:END -->\n`;
    if (!html.includes('</head>')) {
      console.log(`  skip ${key} (no </head>)`);
      continue;
    }
    html = html.replace('</head>', `${block}</head>`);
    fs.writeFileSync(file, html);
    touched++;
    console.log(`  meta added: ${key}`);
  }
  console.log(`\n${touched} page(s) updated`);
}

main();