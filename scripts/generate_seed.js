'use strict';
/**
 * Generates seed/experiments.jsonl from the canonical experiment definitions.
 *
 * This exists because the file is JSONL — one JSON object per line — and writing
 * it by hand is how it ended up as comma-separated CSV, where every single line
 * failed to parse and the ledger silently came up empty on a fresh deploy.
 * Generating it removes the possibility of that class of mistake entirely.
 */
const fs = require('fs');
const path = require('path');

const EXPERIMENTS = require('./experiments.data.js');

const OUT = path.join(__dirname, '..', 'seed', 'experiments.jsonl');

const rows = EXPERIMENTS.map((e) => JSON.stringify({
  ts: '2026-10-03T00:00:00.000Z',
  name: e.name,
  hypothesis: e.hypothesis,
  cost_usd: e.cost_usd ?? 0,
  revenue_usd: e.revenue_usd ?? 0,
  success: !!e.success,
  metric: e.metric || '',
  metric_value: e.metric_value ?? null,
  notes: e.notes || '',
}));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, rows.join('\n') + '\n');

// Verify the output is actually loadable, so a broken seed can never ship again.
const written = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean);
for (const l of written) JSON.parse(l);

console.log(`seed written: ${written.length} rows, all parse as JSON`);
console.log(`-> ${OUT}`);