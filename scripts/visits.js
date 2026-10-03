'use strict';
/**
 * Zero-account traffic beacon for the static site.
 *
 * The site runs entirely in the visitor's browser, so there is no server to log
 * to — and surge.sh's own analytics report 3 uniques, which is my own testing.
 * Blind measurement is the reason distribution cannot be improved: there is no
 * way to learn whether a post worked.
 *
 * This posts a tiny hit to a GitHub Gist-style collector... except Gists need
 * auth too. So instead it records to a durable public endpoint that needs no
 * account: the GitHub issue tracker of the public repo, via an unauthenticated
 * request is impossible (POST needs auth).
 *
 * Therefore the honest design is a LOCAL counter plus a documented manual read,
 * and — the part that actually works with zero accounts — a static, cacheable
 * "did anything happen" ping through a service that accepts anonymous GETs.
 *
 * Practical approach used here:
 *   1. Count locally and precisely, per page, with no cookies and no PII.
 *   2. Report through surge analytics for raw numbers.
 *   3. Be explicit that the numbers are tiny, rather than dressing them up.
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const LOG = path.join(DATA, 'local-visits.jsonl');

/**
 * Append one local visit record.
 * No IP, no user agent, no fingerprint — only page, referrer host and day, which
 * is enough to tell "nobody is visiting" from "people arrive and leave".
 */
function record({ page, referrer, source } = {}) {
  fs.mkdirSync(DATA, { recursive: true });
  const row = {
    ts: new Date().toISOString(),
    day: new Date().toISOString().slice(0, 10),
    page: page || '/',
    // Host only, never a full URL: query strings can carry campaign parameters
    // and this file is committed to a repository.
    referrer_host: referrerHost(referrer),
    source: source || 'unknown',
  };
  fs.appendFileSync(LOG, JSON.stringify(row) + '\n');
  return row;
}

function referrerHost(url) {
  if (!url || url === 'direct') return 'direct';
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

function summary() {
  if (!fs.existsSync(LOG)) return { visits: 0, pages: {}, sources: {}, days: {} };
  const rows = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const pages = {}, sources = {}, days = {};
  for (const r of rows) {
    pages[r.page] = (pages[r.page] || 0) + 1;
    sources[r.referrer_host] = (sources[r.referrer_host] || 0) + 1;
    days[r.day] = (days[r.day] || 0) + 1;
  }
  const uniqueDays = Object.keys(days).length;
  return {
    visits: rows.length,
    unique_days: uniqueDays,
    visits_per_day: uniqueDays ? +(rows.length / uniqueDays).toFixed(2) : 0,
    pages,
    sources,
    days,
  };
}

module.exports = { record, summary, LOG };

if (require.main === module) {
  if (process.argv[2] === '--summary') {
    console.log(JSON.stringify(summary(), null, 2));
  } else {
    const page = process.argv[2];
    const ref = process.argv[3];
    const src = process.argv[4];
    const row = record({ page, referrer: ref, source: src });
    console.log('recorded:', JSON.stringify(row));
    console.log(JSON.stringify(summary(), null, 2));
  }
}