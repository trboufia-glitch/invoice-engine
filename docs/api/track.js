'use strict';
/**
 * Traffic collector — a Vercel serverless function.
 *
 * The site is static, so nothing counts visitors: there is no long-lived server
 * and no log to read. This is the missing measurement, and without it we were
 * reasoning about distribution from a single stale number.
 *
 * Privacy is a design constraint, not an afterthought. It stores page path,
 * referrer hostname and day. No IP, no user agent, no cookie, no fingerprint,
 * no cross-site identifier. There is nothing here to identify a person with,
 * which is also why the browser tool can claim "nothing is uploaded" and mean it.
 *
 * IP and user-agent fields are present in the request and are deliberately
 * ignored rather than truncated-and-stored.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/tmp';
const FILE = path.join(DATA_DIR, 'visits.jsonl');

// A hostile or broken client should not be able to grow the file without bound.
const MAX_BYTES = 512 * 1024;
const MAX_RECORDS = 50000;

function readAll() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8').trim();
    if (!raw) return [];
    // Each line is JSON. Returning the raw strings made summarise() read
    // r.page off a string, which is undefined — so every key collapsed to
    // "undefined" while the row count still grew correctly.
    const rows = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try { rows.push(JSON.parse(line)); } catch { /* skip a partial line */ }
    }
    return rows.slice(-MAX_RECORDS);
  } catch {
    return [];
  }
}

function summarise(rows) {
  const pages = {};
  const sources = {};
  const days = {};
  for (const r of rows) {
    pages[r.page] = (pages[r.page] || 0) + 1;
    sources[r.host] = (sources[r.host] || 0) + 1;
    days[r.day] = (days[r.day] || 0) + 1;
  }
  return {
    total: rows.length,
    pages,
    sources,
    days,
    // Crude but honest: a referrer host means the visit arrived from a link,
    // a search engine or a chat app. "direct" means the URL was typed.
    from_links: rows.filter((r) => r.host && r.host !== 'direct').length,
  };
}

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { req.destroy(); return resolve(null); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

module.exports = async function handler(req, res) {
  // Same-origin only. A beacon that can be fired from anywhere is a beacon
  // anyone can inflate.
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(docs-two-alpha-63|localhost)/.test(origin)) {
    res.status(403).json({ error: 'origin_not_allowed' });
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json(summarise(readAll()));
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  // Vercel only pre-parses JSON when Content-Type is application/json and the
  // body is a string. navigator.sendBeacon sends a Blob, so req.body arrives
  // empty and every field silently fell back to its default. Read the raw
  // stream ourselves whenever nothing usable was parsed.
  let body = req.body;
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    const raw = await readRaw(req);
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = {}; }
    } else {
      body = {};
    }
  }

  // Clamp every field. Never trust the shape that arrives.
  const page = String(body.page || '/').slice(0, 120);
  const host = String(body.host || 'direct').slice(0, 120);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day))
    ? String(body.day)
    : new Date().toISOString().slice(0, 10);

  const rows = readAll();
  rows.push({ ts: Date.now(), page, host, day });

  try {
    const payload = rows.map((r) => JSON.stringify(r)).join('\n');
    if (payload.length < MAX_BYTES) {
      fs.writeFileSync(FILE, payload);
    } else {
      // Drop the oldest half rather than refusing the write entirely.
      fs.writeFileSync(FILE, rows.slice(-Math.floor(MAX_RECORDS / 2)).join('\n'));
    }
  } catch (e) {
    // A failed write must never break the page.
    res.status(202).json({ ok: true });
    return;
  }

  res.status(201).json({ ok: true });
};