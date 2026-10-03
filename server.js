'use strict';
/**
 * DARKMIND Invoice Engine — zero-dependency HTTP API.
 *
 * Zero capital to run: node stdlib only, no cloud bill, no LLM in the hot path.
 * Money arrives as crypto to a fixed Binance ID; credits are settled by an
 * idempotent /v1/orders/:id/confirm endpoint so a replayed confirmation can
 * never double-credit an account.
 */
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const { normalize } = require('./lib/normalize');
const store = require('./lib/store');

const PORT = Number(process.env.PORT || 8787);
const START = Date.now();

// Bind address. Containers and PaaS must listen on 0.0.0.0 — binding to
// 127.0.0.1 on a host like Railway or Render makes the service unreachable and
// the deploy look like a crash while the process is in fact healthy.
const isContainer = fs.existsSync('/.dockerenv') || !!process.env.RAILWAY_ENVIRONMENT
  || !!process.env.RENDER;
const HOST = process.env.HOST || (isContainer ? '0.0.0.0' : '127.0.0.1');

// Where customer payments land. Override with BINANCE_ID at launch.
const PAYOUT_ID = process.env.BINANCE_ID || '990584936';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function send(res, code, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const payload = isBuffer ? body : (typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...headers,
  });
  res.end(payload);
}

/** Send a static file with the right MIME type so browsers actually render it. */
function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function readBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('payload too large'), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/**
 * In-memory token bucket, keyed by API key when present and by IP otherwise.
 * Keying by IP alone throttled legitimate batch users and made a paid customer
 * indistinguishable from a scraper, so paid callers are exempt and only
 * unauthenticated/trial traffic is rationed.
 */
const buckets = new Map();
function rateLimit(req, { keyId = null, capacity = 30, refillPerSec = 2 } = {}) {
  if (keyId) return true; // authenticated + credited: the meter already governs spend
  const ip = clientIp(req);
  const now = Date.now() / 1000;
  let b = buckets.get(ip);
  if (!b) { b = { tokens: capacity, ts: now }; buckets.set(ip, b); }
  b.tokens = Math.min(capacity, b.tokens + (now - b.ts) * refillPerSec);
  b.ts = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  if (buckets.size > 20000) {
    for (const [k, v] of buckets) if (now - v.ts > 300) buckets.delete(k);
  }
  return true;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// plans
// ---------------------------------------------------------------------------

const PLANS = {
  starter: { units: 100, usd: 5, label: 'Starter — 100 calls' },
  pro: { units: 2000, usd: 39, label: 'Pro — 2,000 calls' },
  scale: { units: 15000, usd: 199, label: 'Scale — 15,000 calls' },
};

const FREE_TRIAL = 25;

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ---- public pages ----
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    const file = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(file)) return send(res, 404, { error: 'landing page not installed' });
    return sendFile(res, file);
  }
  if (req.method === 'GET' && (p === '/app.html' || p === '/playground')) {
    const file = path.join(PUBLIC_DIR, 'app.html');
    if (!fs.existsSync(file)) return send(res, 404, { error: 'playground not installed' });
    return sendFile(res, file);
  }

  // ---- health & marketing ----
  if (req.method === 'GET' && p === '/health') {
    return send(res, 200, {
      ok: true,
      uptime_s: Math.round((Date.now() - START) / 1000),
      version: '1.0.0',
      ledger: store.revenueSummary(),
    });
  }

  if (req.method === 'GET' && p === '/v1/plans') {
    return send(res, 200, { plans: PLANS, free_trial_calls: FREE_TRIAL, payout_id: PAYOUT_ID });
  }

  if (req.method === 'GET' && p === '/v1/ledger') {
    // Public scoreboard: every experiment, its cost and its revenue. Exposing the
    // real numbers (including the failures) is what makes the log trustworthy.
    return send(res, 200, {
      summary: store.revenueSummary(),
      experiments: store.listExperiments(25),
    });
  }

  // ---- funnel metrics ----
  // Distribution is the only channel that produces revenue, so impressions,
  // playground visits and key mints are counted as first-class events. Without
  // them there is no way to tell a bad product from bad distribution.
  if (req.method === 'POST' && p === '/v1/metric') {
    const body = await safeJson(req);
    if (!body || typeof body.event !== 'string') {
      return send(res, 400, { error: 'missing_event', expected_events: ['landing_view', 'playground_view', 'checkout_started'] });
    }
    const row = store.logExperiment({
      name: 'funnel:' + body.event,
      hypothesis: `funnel event ${body.event}`,
      success: true,
      notes: body.ref ? String(body.ref).slice(0, 120) : '',
    });
    return send(res, 201, { logged: row.name });
  }

  if (req.method === 'GET' && p === '/v1/funnel') {
    const counts = {};
    for (const e of store.listExperiments(5000)) {
      if (!e.name.startsWith('funnel:')) continue;
      const k = e.name.slice(7);
      counts[k] = (counts[k] || 0) + 1;
    }
    const summary = store.revenueSummary();
    return send(res, 200, {
      events: counts,
      orders_created: store.listOrders().length,
      orders_paid: store.listOrders().filter((o) => o.status === 'paid').length,
      revenue_usd: summary.revenue_usd,
    });
  }

  // ---- onboarding: mint a trial key ----
  if (req.method === 'POST' && p === '/v1/keys') {
    if (!rateLimit(req, { capacity: 5, refillPerSec: 0.05 })) return send(res, 429, { error: 'rate_limited' });
    const k = store.createApiKey({ label: 'trial', plan: 'free', credits: FREE_TRIAL });
    // The plaintext key is returned exactly once; only its hash is stored.
    return send(res, 201, { ...k, note: 'Store this key now — it cannot be recovered.' });
  }

  if (req.method === 'GET' && p === '/v1/usage') {
    const k = store.lookupApiKey(bearer(req));
    if (!k) return send(res, 401, { error: 'invalid_api_key' });
    return send(res, 200, {
      key_id: k.id, plan: k.plan, credits: k.credits,
      lifetime_calls: k.lifetime_calls, created: k.created,
    });
  }

  // ---- the product ----
  if (req.method === 'POST' && p === '/v1/normalize') {
    const key = store.lookupApiKey(bearer(req));
    // Authenticate first: an unknown key is a hard 401, not something to spend
    // a rate-limit token on. Only valid-but-unmetered callers hit the limiter.
    if (!key) return send(res, 401, { error: 'invalid_api_key' });
    if (key.plan === 'free' && !rateLimit(req, { keyId: key.id, capacity: 30, refillPerSec: 2 })) {
      return send(res, 429, { error: 'rate_limited', retry_after_s: 3 });
    }

    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch (e) {
      if (e.code === 413) return send(res, 413, { error: 'payload_too_large', max_bytes: 5 * 1024 * 1024 });
      return send(res, 400, { error: 'invalid_json', detail: e.message });
    }

    const input = typeof body.input === 'string' ? body.input
      : typeof body.csv === 'string' ? body.csv
      : typeof body.text === 'string' ? body.text : null;
    if (input === null) return send(res, 400, { error: 'missing_field', field: 'input', hint: 'send {"input": "<csv or text>"}' });

    const maxRows = Math.min(Number(body.max_rows) || 5000, 25000);
    const spend = store.consume(key.id, 1);
    if (!spend.ok) {
      const code = spend.reason === 'insufficient_credits' ? 402 : 401;
      return send(res, code, {
        error: spend.reason,
        credits: spend.remaining,
        top_up: '/v1/orders',
        plans: PLANS,
      });
    }

    const t0 = Date.now();
    const result = normalize(input, {
      tolerance: Number(body.tolerance) || 0.05,
      maxRows,
      format: body.format === 'csv' || body.format === 'text' ? body.format : 'auto',
    });
    return send(res, 200, {
      ...result,
      credits_remaining: spend.remaining,
      billed_ms: Date.now() - t0,
      request_ms: Date.now() - started,
    });
  }

  // ---- checkout ----
  if (req.method === 'POST' && p === '/v1/orders') {
    const planId = url.searchParams.get('plan') || (await safeJson(req))?.plan;
    const plan = PLANS[planId];
    if (!plan) return send(res, 400, { error: 'unknown_plan', plans: PLANS });

    const key = store.lookupApiKey(bearer(req));
    if (!key) return send(res, 401, { error: 'invalid_api_key' });

    const order = store.createOrder({
      key_id: key.id, plan: planId, units: plan.units,
      amount_usd: plan.usd, destination: PAYOUT_ID, note: url.searchParams.get('note') || '',
    });
    return send(res, 201, {
      order,
      instructions: {
        send: `${plan.usd} USD of USDT (or ${plan.usd} USD via Binance Pay)`,
        to_binance_id: PAYOUT_ID,
        then: `POST /v1/orders/${order.id}/confirm with {"tx_ref":"<your-tx-hash>"}`,
      },
    });
  }

  if (req.method === 'POST' && /^\/v1\/orders\/[^/]+\/confirm$/.test(p)) {
    const orderId = p.split('/')[3];
    const body = await safeJson(req);
    if (!body) return send(res, 400, { error: 'invalid_json' });
    const result = store.settleOrder(orderId, body.tx_ref || null);
    if (!result.ok) return send(res, 409, { error: result.reason });
    return send(res, 200, {
      settled: true,
      already_settled: !!result.already,
      order: result.order,
      credits: result.credits,
    });
  }

  if (req.method === 'GET' && p === '/v1/orders') {
    const key = store.lookupApiKey(bearer(req));
    if (!key) return send(res, 401, { error: 'invalid_api_key' });
    return send(res, 200, { orders: store.listOrders().filter((o) => o.key_id === key.id) });
  }

  return send(res, 404, { error: 'not_found', path: p });

  async function safeJson(r) {
    try { return JSON.parse(await readBody(r)); } catch { return null; }
  }
});

server.listen(PORT, HOST, () => {
  const s = store.revenueSummary();
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║  DARKMIND Invoice Engine — listening                ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log(`  local     http://${HOST}:${PORT}`);
  console.log(`  normalize POST http://${HOST}:${PORT}/v1/normalize`);
  console.log(`  trial key POST http://${HOST}:${PORT}/v1/keys`);
  console.log(`  payout    Binance ID ${PAYOUT_ID}`);
  console.log(`  ledger    ${s.experiments} experiments, net $${s.net_usd}, success ${(s.success_rate * 100).toFixed(0)}%`);
  console.log('');
});

module.exports = { server, PLANS, PAYOUT_ID };