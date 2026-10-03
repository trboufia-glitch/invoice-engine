'use strict';
/**
 * Records the build experiments in data/experiments.jsonl so the ledger
 * endpoint shows the real history, including the failures and their causes.
 * Idempotent: re-running does not duplicate rows (keyed by name+hypothesis).
 */
const store = require('../lib/store');

// Canonical definitions shared with generate_seed.js, so the local runtime
// ledger and the shipped seed can never drift apart.
const EXPERIMENTS = require('./experiments.data.js');

function main() {
  const existing = new Set(store.listExperiments(1000).map((r) => r.name));
  let added = 0;
  for (const e of EXPERIMENTS) {
    if (existing.has(e.name)) continue;
    store.logExperiment(e);
    added++;
  }
  console.log(`local ledger: ${added} new, ${EXPERIMENTS.length - added} already present`);
  console.log(JSON.stringify(store.revenueSummary(), null, 2));
}

main();