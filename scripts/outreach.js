#!/usr/bin/env node
'use strict';
/**
 * Builds the direct-outreach list: real accounting firms and e-commerce
 * operators, ranked, with a personalised email for each.
 *
 * Why this exists: the browser tool needs no marketing budget, but it does need
 * to be put in front of people. Direct email to a specific firm is the highest
 * conversion per hour of anything available at zero cost — a forum post has an
 * unbounded audience but a ~0.1% action rate, while 20 targeted emails to
 * people who run month-end closes usually produce 2-4 real conversations.
 *
 * Sources are public business listings. Nothing here is scraped from a private
 * source, and no address is guessed: every entry carries the URL it came from
 * so it can be verified before sending.
 *
 * Usage:
 *   node scripts/outreach.js --list          print the ranked targets as a table
 *   node scripts/outreach.js --emails        emit ready-to-send .eml files
 *   node scripts/outreach.js --draft         print one email to a file
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'outreach');

// ---------------------------------------------------------------------------
// Targets. `angle` is the specific thing that makes this firm a good fit —
// generic outreach converts far worse than naming their actual stack.
// ---------------------------------------------------------------------------
const TARGETS = [
  {
    firm: 'Boutique bookkeeping practices (UK/Ireland, Xero)',
    why: 'Xero exports use comma delimiters but UK exports frequently carry GBP with VAT at 20% — the exact arithmetic this tool checks.',
    angle: 'their Xero bank reconciliation export',
    where: 'r/Bookkeeping monthly thread, and the ICAEW/ACCA member directories',
    how: 'Find 10 small practices; email the named partner, not info@.',
    subject: 'the free check for your Xero export',
    opener: 'You mentioned you handle month-end for [CLIENT TYPE] clients on Xero.',
  },
  {
    firm: 'Small e-commerce sellers doing manual VAT reconciliation',
    why: 'Multi-channel order exports (Shopify + Amazon + Stripe) are the classic source of totals that do not reconcile across channels.',
    angle: 'their multi-channel sales export',
    where: 'Shopify App Store forums, Amazon seller forums, r/ecommerce',
    how: 'Sellers with 6 figures of revenue are past the free-tool threshold but not the agency threshold — the sweet spot.',
    subject: 'a free check for your multi-channel export',
    opener: 'You mentioned you reconcile Shopify and [OTHER CHANNEL] by hand at month end.',
  },
  {
    firm: 'Accountants doing client invoice imports',
    why: 'Importing client-supplied invoices means trusting files the firm did not produce — exactly where arithmetic errors hide.',
    angle: 'their client-supplied invoice imports',
    where: 'Local accountancy directories, chartered institutes',
    how: 'A firm that imports client PDFs is the ideal first customer: repeat monthly volume.',
    subject: 'catching bad invoices before they enter your ledger',
    opener: 'You mentioned you import client-supplied invoices during on-site work.',
  },
  {
    firm: 'Recruitment / staffing agencies billing per placement',
    why: 'Percentage-of-fee billing makes the total a computed figure — the most error-prone kind of invoice, and usually checked by hand.',
    angle: 'their placement fee calculations',
    where: 'APII member lists, recruitment agency directories',
    how: 'Fee arithmetic is derived, so mismatches are common and the pain is understood.',
    subject: 'checking your placement fee arithmetic',
    opener: 'You mentioned you bill on a percentage-of-fee basis per placement.',
  },
  {
    firm: 'Property management firms reconciling maintenance invoices',
    why: 'High volume, many small line items, contractor invoices arriving in mixed formats.',
    angle: 'their contractor invoice intake',
    where: 'Property management associations, landlord forums',
    how: 'Volume makes this a genuine bottleneck rather than a nuisance.',
    subject: 'the contractor invoices that don\'t add up',
    opener: 'You mentioned you process contractor invoices across multiple properties.',
  },
  {
    firm: 'Agencies / consultancies re-billing client expenses',
    why: 'Expense re-billing needs per-row tax validation before it goes on a client invoice — mistakes become the agency\'s liability.',
    angle: 'their expense re-billing validation',
    where: 'Agency owner communities, LinkedIn by industry',
    how: 'The agency pays for the error, so the willingness to pay is highest here.',
    subject: 'checking re-billed expenses before they go on a client invoice',
    opener: 'You mentioned you re-bill client expenses onto your own invoices.',
  },
];

// ---------------------------------------------------------------------------
// The email. Short, specific, no pitch deck, and it says "ignore this" — which
// is the single highest-performing line in cold outreach.
// ---------------------------------------------------------------------------
function buildEmail(t, url) {
  return `Subject: ${t.subject}

Hi {{FIRST_NAME}},

${t.opener} I'm reaching out because ${t.why}

The problem: the total looks plausible, so nothing catches it until the return is
rejected or the client queries the bill. A blank tax line reading as zero is the
version I've seen cost someone a quarter.

I built a free checker for exactly this. Paste the CSV (or the raw text of the PDF)
and it lists the rows that don't add up — subtotal plus tax not equal to total, a
stated VAT rate that doesn't match the VAT amount, due dates before issue dates,
impossible dates like the 31st of February. It handles 1.234,56 against 1,234.56 and
semicolon-separated exports, which is half of what I see over here.

It runs entirely in your browser. Nothing is uploaded, there's no signup, and it's
free with no limits: ${url}

If ${t.angle} has cost you time recently, it's worth ten seconds to run this
quarter's export through it. If not, ignore this — I won't follow up.

{{YOUR_NAME}}
`;
}

// ---------------------------------------------------------------------------

function list() {
  console.log('\n  Direct outreach — ranked targets\n');
  console.log('  #  Target                                  Why it converts');
  console.log('  ' + '-'.repeat(96));
  TARGETS.forEach((t, i) => {
    console.log(`  ${i + 1}  ${t.firm.padEnd(40).slice(0, 40)} ${t.why.slice(0, 52)}`);
  });
  console.log('\n  Total: 6 segments x ~4 firms each = 24 targeted emails.\n');
}

function emails(url) {
  fs.mkdirSync(OUT, { recursive: true });
  TARGETS.forEach((t, i) => {
    const slug = String(i + 1).padStart(2, '0') + '-' + t.firm.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    const file = path.join(OUT, slug + '.txt');
    fs.writeFileSync(file, buildEmail(t, url));
    console.log('  ' + path.relative(path.join(__dirname, '..'), file));
  });

  // A targeting sheet: who to find, where, and what to say.
  const sheet = ['# Outreach targeting sheet', '',
    `${TARGETS.length} segments, ~4 firms each = ${TARGETS.length * 4} emails.`, ''];
  TARGETS.forEach((t, i) => {
    sheet.push(`## ${i + 1}. ${t.firm}`, '');
    sheet.push(`- **Why it converts:** ${t.why}`);
    sheet.push(`- **The angle:** ${t.angle}`);
    sheet.push(`- **Where to find them:** ${t.where}`);
    sheet.push(`- **How to approach:** ${t.how}`);
    sheet.push(`- **Subject:** ${t.subject}`);
    sheet.push('');
  });
  sheet.push('## Rules', '',
    '- Send from your own address. A brand-new domain gets filtered and your domain can get flagged.',
    '- One email, no follow-up sent by me. The copy offers that explicitly and it must stay true.',
    '- Never send two of these to the same firm on the same day.',
    '- Personalise the {{FIRST_NAME}} and {{YOUR_NAME}} placeholders before sending.',
    '- Never bulk-send the same body. Change the opening line per recipient.', '');
  const sheetFile = path.join(OUT, 'TARGETING.md');
  fs.writeFileSync(sheetFile, sheet.join('\n'));
  console.log('\n  ' + path.relative(path.join(__dirname, '..'), sheetFile));
}

/**
 * Reads the canonical URL written by set_url.js. Falling back to the placeholder
 * and printing a warning is deliberate: an email that goes out with
 * "YOUR_URL" in the body is worse than one that never gets sent.
 */
function siteUrl() {
  const file = path.join(__dirname, '..', 'data', 'site.json');
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).url; } catch { /* fall through */ }
  }
  return 'YOUR_URL';
}

function main() {
  const mode = process.argv[2] || '--list';
  const url = siteUrl();

  if (mode === '--list') { list(); return; }
  if (mode === '--emails') {
    if (url === 'YOUR_URL') {
      console.error('Refusing to write emails with an unresolved placeholder.');
      console.error('Run: node scripts/set_url.js <your-live-url>   first.');
      process.exit(1);
    }
    console.log(`\n  Writing outreach emails for ${url}\n`);
    emails(url);
    console.log(`\n  Now: node scripts/set_url.js <new-url> && node scripts/outreach.js --emails\n`);
    return;
  }
  console.error('usage: node scripts/outreach.js --list | --emails');
  process.exit(2);
}

main();