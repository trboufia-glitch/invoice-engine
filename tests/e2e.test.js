'use strict';
/**
 * End-to-end test: boots the real server on an ephemeral port and drives the
 * real HTTP surface. This is the check that matters — unit tests can pass while
 * the auth, metering or checkout wiring is broken.
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8791 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const log = [];
function check(name, cond, detail) {
  if (cond) { pass++; log.push(['PASS', name]); }
  else { fail++; log.push(['FAIL', name + (detail ? ' :: ' + JSON.stringify(detail).slice(0, 300) : '')]); }
}

async function req(method, p, { body, key, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (key) h.Authorization = `Bearer ${key}`;
  const r = await fetch(BASE + p, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json response */ }
  return { status: r.status, json, text };
}

const CSV_OK = `Invoice Number,Invoice Date,Due Date,Vendor,Currency,Subtotal,Tax,Total
INV-1,2026-01-05,2026-02-04,Acme,USD,1000.00,200.00,1200.00`;
const CSV_BAD = `Invoice Number,Invoice Date,Vendor,Currency,Subtotal,Tax,Total
INV-2,2026-01-05,Acme,USD,1000.00,200.00,9999.00`;

(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), BINANCE_ID: '990584936' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bootErr = '';
  child.stderr.on('data', (d) => { bootErr += d.toString(); });

  // wait for readiness
  let up = false;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) { up = true; break; } } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  check('server boots and /health responds', up, bootErr.slice(0, 400));
  if (!up) { report(); child.kill(); process.exit(1); }

  // --- plans -------------------------------------------------------------
  const plans = await req('GET', '/v1/plans');
  check('GET /v1/plans lists plans + payout id',
    plans.status === 200 && !!plans.json.plans.starter && plans.json.payout_id === '990584936',
    plans.json);

  // --- auth --------------------------------------------------------------
  const noAuth = await req('POST', '/v1/normalize', { body: { input: CSV_OK } });
  check('normalize without key -> 401', noAuth.status === 401, noAuth.json);

  const badAuth = await req('POST', '/v1/normalize', { body: { input: CSV_OK }, key: 'dm_totally_wrong' });
  check('normalize with wrong key -> 401', badAuth.status === 401, badAuth.json);

  // --- trial key ---------------------------------------------------------
  const created = await req('POST', '/v1/keys');
  const key = created.json && created.json.api_key;
  check('POST /v1/keys mints a trial key', created.status === 201 && !!key, created.json);
  check('trial key starts with 25 credits', created.json.credits === 25, created.json);

  // --- the product -------------------------------------------------------
  const okRes = await req('POST', '/v1/normalize', { body: { input: CSV_OK }, key });
  check('normalize clean csv -> 200 ok=true', okRes.status === 200 && okRes.json.ok === true, okRes.json);
  check('clean csv scores 100', okRes.json.summary.avg_score === 100, okRes.json.summary);
  check('record parsed correctly',
    okRes.json.records[0].invoice_number === 'INV-1' && okRes.json.records[0].total === 1200,
    okRes.json.records && okRes.json.records[0]);
  check('credits debited to 24', okRes.json.credits_remaining === 24, okRes.json.credits_remaining);

  const badRes = await req('POST', '/v1/normalize', { body: { input: CSV_BAD }, key });
  check('normalize bad csv -> 200 ok=false with error', badRes.status === 200 && badRes.json.ok === false, badRes.json);
  check('arithmetic mismatch is reported',
    (badRes.json.issues || []).some((i) => i.code === 'ARITHMETIC_MISMATCH'), badRes.json.issues);

  // --- usage -------------------------------------------------------------
  const usage = await req('GET', '/v1/usage', { key });
  check('GET /v1/usage reflects calls + credits',
    usage.status === 200 && usage.json.lifetime_calls === 2 && usage.json.credits === 23, usage.json);

  // --- malformed input ---------------------------------------------------
  const noJson = await req('POST', '/v1/normalize', { headers: { 'Content-Type': 'application/json' }, key });
  check('empty body -> 400 invalid_json', noJson.status === 400 && noJson.json.error === 'invalid_json', noJson.json);

  const noField = await req('POST', '/v1/normalize', { body: { nope: 1 }, key });
  check('missing input -> 400 missing_field', noField.status === 400 && noField.json.error === 'missing_field', noField.json);

  // --- checkout ----------------------------------------------------------
  // The store is persistent, so a fixed tx_ref would collide with a previous run's
  // order (the duplicate-tx guard is global by design). Use a per-run tx.
  const TX = '0x' + Math.random().toString(16).slice(2).padEnd(12, '0');
  const order = await req('POST', '/v1/orders?plan=pro', { key });
  check('POST /v1/orders creates order', order.status === 201 && !!order.json.order.id, order.json);
  check('order carries units + usd + destination',
    order.json.order.units === 2000 && order.json.order.amount_usd === 39 && order.json.order.destination === '990584936',
    order.json.order);
  const orderId = order.json.order.id;

  const badPlan = await req('POST', '/v1/orders?plan=nonsense', { key });
  check('unknown plan -> 400', badPlan.status === 400, badPlan.json);

  // confirm with tx
  const c1 = await req('POST', `/v1/orders/${orderId}/confirm`, { key, body: { tx_ref: TX } });
  check('confirm settles the order', c1.status === 200 && c1.json.settled === true, c1.json);
  check('credits granted = 2000 on top of 23', c1.json.credits && c1.json.credits.credits === 2023, c1.json.credits);

  // replay the SAME tx -> must not double-credit
  const c2 = await req('POST', `/v1/orders/${orderId}/confirm`, { key, body: { tx_ref: TX } });
  check('replayed confirm is idempotent', c2.status === 200 && c2.json.already_settled === true, c2.json);

  const usage2 = await req('GET', '/v1/usage', { key });
  check('replay did NOT double-credit (still 2023)', usage2.json.credits === 2023, usage2.json);

  // same tx_ref on a DIFFERENT order -> must be rejected
  const order2 = await req('POST', '/v1/orders?plan=starter', { key });
  const c3 = await req('POST', `/v1/orders/${order2.json.order.id}/confirm`, { key, body: { tx_ref: TX } });
  check('tx reuse on a new order -> 409', c3.status === 409 && c3.json.error === 'tx_already_used', c3.json);

  // --- credit exhaustion -------------------------------------------------
  const poor = await req('POST', '/v1/keys');
  const poorKey = poor.json.api_key;
  // drain 25 credits
  for (let i = 0; i < 25; i++) await req('POST', '/v1/normalize', { body: { input: CSV_OK }, key: poorKey });
  const drained = await req('POST', '/v1/normalize', { body: { input: CSV_OK }, key: poorKey });
  check('exhausted credits -> 402 Payment Required', drained.status === 402 && drained.json.error === 'insufficient_credits', drained.json);
  check('402 response advertises top-up path', !!(drained.json.top_up && drained.json.plans), drained.json);

  // --- ledger ------------------------------------------------------------
  const ledger = await req('GET', '/v1/ledger');
  check('GET /v1/ledger returns a summary', ledger.status === 200 && typeof ledger.json.summary.success_rate === 'number', ledger.json);
  check('deployed ledger is seeded (not empty on a fresh deploy)',
    ledger.json.experiments && ledger.json.experiments.length > 0, (ledger.json.experiments || []).length);

  // --- funnel metrics ----------------------------------------------------
  const badMetric = await req('POST', '/v1/metric', { body: { nope: 1 } });
  check('POST /v1/metric without event -> 400', badMetric.status === 400 && badMetric.json.error === 'missing_event', badMetric.json);

  const ev = await req('POST', '/v1/metric', { body: { event: 'landing_view', ref: 'e2e-test' } });
  check('POST /v1/metric logs an event', ev.status === 201 && ev.json.logged === 'funnel:landing_view', ev.json);

  const funnel = await req('GET', '/v1/funnel');
  check('GET /v1/funnel counts the event', funnel.status === 200 && funnel.json.events.landing_view >= 1, funnel.json);
  check('funnel reports order counts', typeof funnel.json.orders_created === 'number' && typeof funnel.json.orders_paid === 'number', funnel.json);

  // --- 404 ---------------------------------------------------------------
  const missing = await req('GET', '/v1/does-not-exist');
  check('unknown route -> 404', missing.status === 404, missing.json);

  report();
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('harness crashed:', e);
  process.exit(1);
});

function report() {
  console.log('\n  DARKMIND // end-to-end suite (live server)\n');
  for (const [s, n] of log) {
    console.log(`  ${s === 'PASS' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`);
  }
  console.log(`\n  ${pass} passed, ${fail} failed, ${log.length} total\n`);
}