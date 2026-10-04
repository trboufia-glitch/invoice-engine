'use strict';
/**
 * Sends the outreach campaign to the verified target list.
 *
 * One message at a time with spacing: several cold emails fired back-to-back
 * from one inbox is the pattern spam filters key on, and a filtered campaign
 * costs the whole domain its sender reputation.
 *
 * Usage:
 *   SMTP_USER=... SMTP_PASS=... node scripts/campaign.js --dry-run
 *   SMTP_USER=... SMTP_PASS=... node scripts/campaign.js --send
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

// Verified contacts, from marketing/TARGETS.md. Never guessed: a guessed address
// bounces and the bounce rate is what gets a domain throttled.
const TARGETS = [
  {
    // Bounced 2026-10-03. The address is published on their own site and the
    // domain has valid MX, so their server rejects it — not a bad guess. Do not
    // retry: repeat bounces are what get a sending domain throttled.
    firm: 'Sterling Accountants (BOUNCED — do not retry)',
    to: 'contact@sterlingaccountants.uk',
    skip: true,
    subject: 'the free check for your Shopify and Xero exports',
    angle: 'Shopify payout reconciliation',
    note: 'ACCA firm in Slough; states the payout-mismatch problem explicitly',
  },
  {
    firm: 'UpCounting',
    to: 'hello@upcounting.com',
    subject: 'a VAT check for your eCommerce clients',
    angle: 'month-end VAT reconciliation',
    note: 'Growth accountants for eCommerce brands, Xero-based',
  },
  {
    firm: 'Probal Global',
    to: 'hello@probalglobal.com',
    subject: 'the reconciliation step you probably do by hand',
    angle: 'multi-channel marketplace reconciliation',
    note: 'Calls reconciliation a core service; multi-currency and OSS',
  },
  {
    firm: 'CronosNow',
    to: 'hello@cronosnow.com',
    subject: 'a free pre-check on the exports you send us',
    angle: 'due-diligence-ready financials',
    note: 'Audit-grade accuracy is the bar — error detection matters to them',
  },
  {
    firm: 'Bookkeeper360',
    to: 'sales@bookkeeper360.com',
    subject: 'a white-label invoice check for your bookkeepers',
    angle: 'bulk client file validation',
    note: 'US volume player; 2012 vintage, high volume of client files',
  },
  {
    firm: 'ConnectCPA',
    to: 'admin@connectcpa.ca',
    subject: 'invoice validation for your scaling clients',
    angle: 'plug-and-play virtual accounting',
    note: 'Serves scaling companies; pipeline-friendly buyer',
  },
  {
    firm: 'EcomBalance',
    to: 'support@ecombalance.com',
    subject: 'the payout arithmetic check',
    angle: 'Amazon/Shopify/eBay settlement review',
    note: 'Monthly bookkeeping service — recurring volume',
  },
  {
    firm: 'Link My Books (second, distinct angle)',
    to: 'support@linkmybooks.com',
    subject: 'one question about your reconciliation pipeline',
    angle: 'automation depth',
    note: 'Follow-up to the first email; asks the qualifying question directly',
    followUp: true,
  },
];

const FROM = process.env.SMTP_FROM || 'Oussama Boufia <pontboufia@gmail.com>';

function buildBody(t) {
  if (t.followUp) {
    return `Hi,

One question, then I'll leave you alone: do your clients ever run invoice exports through anything automated — a script, a scheduled job, an integration — rather than checking them by hand?

If yes, I built something that would drop into that path and is worth a conversation. If no, then it isn't for you and I won't follow up again.

Free either way, no signup: https://invoice-checker-ie.surge.sh

Best,
Oussama`;
  }

  return `Hi,

You handle ${t.angle} for clients, which means files arrive that somebody else produced — and a total that looks plausible until someone queries it.

I built a small free checker for that layer. Paste an invoice CSV, or the raw text of a PDF invoice, and it returns the rows that don't add up:

  · subtotal + tax does not equal total
  · a stated VAT rate that doesn't match the VAT amount
  · due dates before issue dates
  · impossible dates, like the 31st of February
  · 1.234,56 read as 1,234.56
  · a semicolon export that lost its delimiters

That last one is worth a minute of your attention: if a parser hardcodes the comma separator, every European supplier's file collapses into a single column. Nothing errors, you just get structurally valid garbage.

It runs entirely in the browser. Nothing uploaded, no signup, free with no limits:

  https://invoice-checker-ie.surge.sh

One question, because it decides whether this is useful to you: does any of your work run these checks automatically — a script, a scheduled job, an integration — or is it always by hand? If automated, I have an API version and would like to know what it would take to be worth paying for.

Either way, no follow-up from me.

Best,
Oussama`;
}

function send(to, subject, body) {
  const tmp = path.join(ROOT, 'data', 'campaign-body.txt');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, `Subject: ${subject}\n\n${body}`);
  const args = [path.join(ROOT, 'scripts', 'send_email.js'), '--to', to, '--file', tmp, '--from', FROM];
  const out = execFileSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
  return out;
}

function main() {
  const dry = process.argv.includes('--dry-run');
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  let list = only ? TARGETS.filter((t) => t.firm.toLowerCase().includes(only.toLowerCase())) : TARGETS;
  list = list.filter((t) => !t.skip);

  console.log(`\n  Campaign: ${list.length} message(s)${dry ? ' — DRY RUN' : ''}\n`);

  if (dry) {
    for (const t of list) {
      console.log(`  → ${t.to}  (${t.firm})`);
      console.log(`    subject: ${t.subject}`);
      console.log(`    note   : ${t.note}`);
    }
    console.log('');
    return;
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('Set SMTP_USER and SMTP_PASS.');
    process.exit(2);
  }

  let sent = 0, failed = 0;
  list.forEach((t, i) => {
    try {
      const out = send(t.to, t.subject, buildBody(t));
      if (/SENT ok/.test(out)) {
        sent++;
        console.log(`  [${i + 1}/${list.length}] sent -> ${t.to}`);
      } else {
        failed++;
        console.log(`  [${i + 1}/${list.length}] NOT SENT -> ${t.to}`);
      }
    } catch (e) {
      failed++;
      console.log(`  [${i + 1}/${list.length}] FAILED -> ${t.to}: ${String(e.message).split('\n')[0]}`);
    }
  });

  console.log(`\n  sent ${sent}, failed ${failed}\n`);
  process.exit(failed ? 1 : 0);
}

main();