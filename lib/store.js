'use strict';
/**
 * Durable JSON store: API keys, credit ledger, orders, experiment log.
 * Single-process, synchronous writes. No external dependency, no DB cost.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Data location. On a PaaS container the filesystem is ephemeral: every deploy
// and every restart would wipe API keys and paid credits. Point DATA_DIR at a
// mounted volume to keep them.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'store.json');
const EXP_PATH = path.join(DATA_DIR, 'experiments.jsonl');

const EMPTY = { keys: {}, orders: {}, meta: { created: new Date().toISOString() } };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  seedLedgerIfEmpty();
}

// The experiment ledger is part of the product's credibility, but data/ is
// gitignored (it holds live credentials). A committed seed is copied into
// DATA_DIR on first boot so /v1/ledger is never blank in production.
function seedLedgerIfEmpty() {
  if (fs.existsSync(EXP_PATH)) {
    const nonEmpty = fs.readFileSync(EXP_PATH, 'utf8').trim().length > 0;
    if (nonEmpty) return;
  }
  const seed = path.join(__dirname, '..', 'seed', 'experiments.jsonl');
  if (!fs.existsSync(seed)) return;
  try {
    fs.copyFileSync(seed, EXP_PATH);
  } catch {
    /* best effort: a missing ledger must never stop the service booting */
  }
}

// Loud, early warning: on an ephemeral container filesystem every restart
// silently invalidates all API keys and all paid credits. Better to say so at
// boot than to discover it when a customer's key stops working.
let warnedEphemeral = false;
function warnIfEphemeral() {
  if (warnedEphemeral) return;
  warnedEphemeral = true;
  const container = fs.existsSync('/.dockerenv') || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RENDER;
  if (container && !process.env.DATA_DIR) {
    process.stderr.write(
      '[store] WARNING: running on a container filesystem with DATA_DIR unset.\n' +
      '[store]          API keys, credits and orders will be LOST on restart/deploy.\n' +
      '[store]          Mount a persistent volume and set DATA_DIR before accepting payment.\n'
    );
  }
}

let db;
function load() {
  ensureDir();
  warnIfEphemeral();
  if (db) return db;
  if (fs.existsSync(DB_PATH)) {
    try {
      db = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
    } catch {
      // A corrupt store must not take the service down; preserve it and start clean.
      const bak = DB_PATH + '.corrupt-' + Date.now();
      try { fs.renameSync(DB_PATH, bak); } catch { /* best effort */ }
      db = JSON.parse(JSON.stringify(EMPTY));
    }
  } else {
    db = JSON.parse(JSON.stringify(EMPTY));
  }
  return db;
}

let writeQueued = false;
function persist() {
  if (writeQueued) return;
  writeQueued = true;
  setImmediate(() => {
    writeQueued = false;
    ensureDir();
    // Write to a temp file then rename: a crash mid-write must not truncate the DB.
    const tmp = DB_PATH + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DB_PATH);
    } catch (e) {
      process.stderr.write(`[store] persist failed: ${e.message}\n`);
    }
  });
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/** Create an API key. The plaintext is returned once and never stored. */
function createApiKey({ label = 'default', plan = 'free', credits = 0 } = {}) {
  const d = load();
  const raw = 'dm_' + crypto.randomBytes(20).toString('base64url');
  const keyId = id('k');
  d.keys[keyId] = {
    id: keyId,
    hash: hashKey(raw),
    label,
    plan,
    credits,
    lifetime_calls: 0,
    created: new Date().toISOString(),
    revoked: false,
  };
  persist();
  return { key_id: keyId, api_key: raw, plan, credits };
}

function lookupApiKey(raw) {
  const d = load();
  if (!raw) return null;
  const h = hashKey(raw);
  for (const k of Object.values(d.keys)) {
    if (k.hash === h) return k.revoked ? null : k;
  }
  return null;
}

/** Spend credits atomically. Returns {ok, reason}. */
function consume(keyId, units = 1) {
  const d = load();
  const k = d.keys[keyId];
  if (!k) return { ok: false, reason: 'unknown_key' };
  if (k.revoked) return { ok: false, reason: 'revoked' };
  if (k.plan === 'unlimited') {
    k.lifetime_calls += 1;
    persist();
    return { ok: true, remaining: null };
  }
  if (k.credits < units) return { ok: false, reason: 'insufficient_credits', remaining: k.credits };
  k.credits -= units;
  k.lifetime_calls += 1;
  persist();
  return { ok: true, remaining: k.credits };
}

function addCredits(keyId, units) {
  const d = load();
  const k = d.keys[keyId];
  if (!k) return null;
  k.credits += units;
  if (k.plan === 'free' && k.credits > 0) k.plan = 'metered'; // upgrade on first top-up
  persist();
  return { key_id: keyId, credits: k.credits, plan: k.plan };
}

function getKey(keyId) {
  const d = load();
  return d.keys[keyId] || null;
}

function setPlan(keyId, plan) {
  const d = load();
  const k = d.keys[keyId];
  if (!k) return null;
  k.plan = plan;
  persist();
  return k;
}

function listKeys() {
  const d = load();
  return Object.values(d.keys).map(({ hash, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// Orders (crypto checkout)
// ---------------------------------------------------------------------------

function createOrder({ key_id = null, plan, units, amount_usd, destination, note = '' }) {
  const d = load();
  const orderId = id('ord');
  d.orders[orderId] = {
    id: orderId,
    key_id,
    plan,
    units,
    amount_usd,
    destination,
    note,
    status: 'pending',
    created: new Date().toISOString(),
    paid_at: null,
    tx_ref: null,
  };
  persist();
  return d.orders[orderId];
}

function getOrder(orderId) {
  const d = load();
  return d.orders[orderId] || null;
}

/**
 * Mark an order paid and apply the credits. Idempotent: replaying the same
 * tx_ref must not double-credit an account.
 */
function settleOrder(orderId, txRef) {
  const d = load();
  const o = d.orders[orderId];
  if (!o) return { ok: false, reason: 'unknown_order' };
  if (o.status === 'paid') {
    return { ok: true, already: true, order: o, credits: null };
  }
  if (txRef) {
    for (const other of Object.values(d.orders)) {
      if (other.tx_ref === txRef && other.id !== orderId) {
        return { ok: false, reason: 'tx_already_used', order: other };
      }
    }
  }
  o.status = 'paid';
  o.paid_at = new Date().toISOString();
  o.tx_ref = txRef || null;
  let credits = null;
  if (o.key_id) credits = addCredits(o.key_id, o.units);
  persist();
  return { ok: true, order: o, credits };
}

function listOrders() {
  const d = load();
  return Object.values(d.orders).sort((a, b) => (a.created < b.created ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Experiment log
// ---------------------------------------------------------------------------

/**
 * Append one experiment record. Fields: name, hypothesis, cost_usd,
 * revenue_usd, success (bool), notes. This is the scoreboard the whole
 * operation is judged on.
 */
function logExperiment(rec) {
  ensureDir();
  const row = {
    ts: new Date().toISOString(),
    name: rec.name || 'unnamed',
    hypothesis: rec.hypothesis || '',
    cost_usd: Number(rec.cost_usd ?? 0) || 0,
    revenue_usd: Number(rec.revenue_usd ?? 0) || 0,
    success: !!rec.success,
    metric: rec.metric || '',
    metric_value: rec.metric_value ?? null,
    notes: rec.notes || '',
  };
  fs.appendFileSync(EXP_PATH, JSON.stringify(row) + '\n');
  return row;
}

function listExperiments(limit = 100) {
  ensureDir();
  if (!fs.existsSync(EXP_PATH)) return [];
  const lines = fs.readFileSync(EXP_PATH, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { out.push(JSON.parse(lines[i])); } catch { /* skip malformed line */ }
  }
  return out;
}

function revenueSummary() {
  const rows = listExperiments(1000);
  const revenue = rows.reduce((s, r) => s + (r.revenue_usd || 0), 0);
  const cost = rows.reduce((s, r) => s + (r.cost_usd || 0), 0);
  return {
    experiments: rows.length,
    successful: rows.filter((r) => r.success).length,
    success_rate: rows.length ? +(rows.filter((r) => r.success).length / rows.length).toFixed(3) : 0,
    revenue_usd: +revenue.toFixed(2),
    cost_usd: +cost.toFixed(2),
    net_usd: +(revenue - cost).toFixed(2),
  };
}

module.exports = {
  createApiKey, lookupApiKey, consume, addCredits, getKey, setPlan, listKeys,
  createOrder, getOrder, settleOrder, listOrders,
  logExperiment, listExperiments, revenueSummary,
  DATA_DIR,
};