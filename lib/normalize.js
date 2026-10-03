'use strict';
/**
 * Invoice / statement normalizer.
 * Deterministic. No network, no LLM. Pure parsing + validation.
 * Goal: turn messy human billing text or loose CSV into one canonical JSON shape.
 */

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const CURRENCY_SYMBOLS = {
  $: { code: 'USD', symbol: '$' },
  '€': { code: 'EUR', symbol: '€' },
  '£': { code: 'GBP', symbol: '£' },
  '¥': { code: 'JPY', symbol: '¥' },
  '₹': { code: 'INR', symbol: '₹' },
  '₺': { code: 'TRY', symbol: '₺' },
  '₽': { code: 'RUB', symbol: '₽' },
  '₪': { code: 'ILS', symbol: '₪' },
  'ر.س': { code: 'SAR', symbol: 'SAR' },
  'د.إ': { code: 'AED', symbol: 'AED' },
};

const CURRENCY_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'INR', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK',
  'PLN', 'CZK', 'RUB', 'UAH', 'TRY', 'AED', 'SAR', 'QAR', 'EGP', 'ZAR', 'NGN',
  'KES', 'MAD', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'IDR', 'MYR', 'SGD', 'HKD',
  'KRW', 'TWD', 'THB', 'PHP', 'VND', 'ISK', 'RON', 'BGN', 'HRK', 'INR',
]);

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

function stripThousands(s) {
  // 1,234.56  /  1.234,56  /  1 234,56  /  1'234.56  -> plain number string
  let t = s.replace(/[\s'’\u00a0]/g, '');
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56
    } else {
      t = t.replace(/,/g, ''); // 1,234.56
    }
  } else if (lastComma > -1) {
    const after = t.length - lastComma - 1;
    if (after === 3 && /^\d{1,3},\d{3}$/.test(t)) t = t.replace(',', ''); // 1,234
    else t = t.replace(',', '.'); // 1234,56
  }
  return t.replace(/[^0-9.\-]/g, '');
}

function toNumber(s) {
  if (s === null || s === undefined) return null;
  let raw = String(s).trim();
  // An empty cell is an ABSENT value, not zero. Returning 0 here made every
  // missing column look like a legitimate 0 and produced false warnings
  // ("0% of 1000 = 0 but tax is 200").
  if (!raw) return null;
  // accounting negatives: (250.00) => -250.00
  let neg = false;
  const paren = raw.match(/^\((.*)\)$/);
  if (paren) { neg = true; raw = paren[1]; }
  if (raw.startsWith('-')) { neg = true; raw = raw.slice(1); }
  if (raw.startsWith('+')) raw = raw.slice(1);
  const n = Number(stripThousands(raw));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * Parse a date from many human formats into ISO YYYY-MM-DD.
 * Tolerates a leading label ("Due Date: ", "Date of issue ") because the free-text
 * extractor hands us a window of text rather than a bare token.
 */
function parseDate(input) {
  if (!input) return null;
  // The free-text extractor hands us a window like "Date: 2026-02-10\nDue Date: ...".
  // Find where the actual date begins: the first digit, or a month name if the
  // date is written month-first ("Mar 15, 2026"). A bare word such as "Date" is
  // a label, not a date, so word matches alone are ignored.
  const text = String(input);
  const MONTH_ALT = Object.keys(MONTHS).join('|');
  const digitAt = text.search(/\d/);
  const monthRe = new RegExp(`\\b(?:${MONTH_ALT})\\b`, 'i');
  const mm = text.match(monthRe);
  const monthAt = mm ? mm.index : -1;
  let start;
  if (digitAt === -1) start = monthAt;
  else if (monthAt === -1) start = digitAt;
  else start = Math.min(digitAt, monthAt);
  if (start === -1) return null;

  const raw = text.slice(start).trim();
  if (!raw) return null;

  // ISO already
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  // DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY (ambiguous -> disambiguate below)
  m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    // a day can never be > 31; if a>12 it must be day-first.
    let day, mon;
    if (a > 12 && b <= 12) { day = a; mon = b; }
    else if (b > 12 && a <= 12) { day = b; mon = a; }   // US MM/DD
    else { day = a; mon = b; }                            // assume day-first (ISO-adjacent world)
    return iso(y, mon, day);
  }

  // "12 Jan 2026", "Jan 12, 2026", "12 January 2026"
  m = raw.match(/^(\d{1,2})[ \-]([A-Za-z]{3,9})\.?[ \-](\d{2,4})/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) { let y = +m[3]; if (y < 100) y += 2000; return iso(y, mon, +m[1]); }
  }
  m = raw.match(/^([A-Za-z]{3,9})\.?[ \-](\d{1,2}),?[ \-](\d{2,4})/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) { let y = +m[3]; if (y < 100) y += 2000; return iso(y, mon, +m[2]); }
  }

  // "2026/01/12"
  m = raw.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  return null;
}

function iso(y, m, d) {
  if (!(y >= 1900 && y <= 2200)) return null;
  if (!(m >= 1 && m <= 12)) return null;
  if (!(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // rejects 31 Feb
  return dt.toISOString().slice(0, 10);
}

function detectCurrency(text) {
  const t = String(text);
  for (const sym of Object.keys(CURRENCY_SYMBOLS)) {
    if (t.includes(sym)) return CURRENCY_SYMBOLS[sym].code;
  }
  const up = t.toUpperCase();
  for (const code of CURRENCY_CODES) {
    if (new RegExp(`(^|[^A-Z])${code}([^A-Z]|$)`).test(up)) return code;
  }
  return null;
}

// ---------------------------------------------------------------------------
// field extraction
// ---------------------------------------------------------------------------

const INVOICE_NO = [
  /(?:invoice|inv|bill|receipt|facture|factura|rechnung|receipt)\s*(?:no|nr|num|number|#|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-\/_.]{2,24})/i,
  /\bno\s*[:#-]\s*([A-Z0-9][A-Z0-9\-\/_.]{2,24})/i,
];
const DUE_HINTS = /(due\s*(?:date|on|by)?|payment\s*due|due\s*by|payable\s*by|vencimiento|ف\s*历史文化|截止)/i;
const DATE_HINTS = /(issue\s*date|invoice\s*date|date\s*of\s*issue|issued|dated|date\b|التاريخ)/i;
// "Total" must start a token of its own — a bare /total/ also matches inside
  // "Subtotal", which made the subtotal leak into the total field. The negative
  // lookbehind rejects any letter immediately before the label.
  const TOTAL_HINTS = /(?<![A-Za-z])(?:grand\s*total|amount\s*due|total\s*due|balance\s*due|total|montant|gesamtbetrag)\b/i;
const SUBTOTAL_HINTS = /(sub\s*total|subtotal|net\s*amount|net\s*total|before\s*tax)/i;
const TAX_HINTS = /(tax|vat|gst|mwst|iva|impuesto|tva)/i;

function matchFirst(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

const VAT_RATES = [
  { re: /\b(\d{1,2}(?:\.\d{1,2})?)\s*%/g, label: 'rate_pct' },
];

function extractTaxRate(text) {
  const m = text.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:vat|tax|gst|iva|tva|mwst)\b/i)
    || text.match(/\b(?:vat|tax|gst|iva|tva|mwst)\s*[:@]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 0 && n <= 40) return n;
  }
  return null;
}

/**
 * Pull the first monetary value that follows a label ("Total Due: $1,080.00").
 * Takes the FIRST number, not the largest: a label like "Subtotal: $900.00" is
 * commonly followed by the tax and total lines, and taking the maximum would
 * silently report the grand total as the subtotal.
 */
/**
 * Pull the first monetary value that follows a label ("Total Due: $1,080.00").
 * Takes the FIRST number, not the largest: a label like "Subtotal: $900.00" is
 * commonly followed by the tax and total lines, and taking the maximum would
 * silently report the grand total as the subtotal.
 */
function extractMoneyAfter(text, hintRe, window = 60) {
  const m = text.match(hintRe);
  if (!m) return null;
  const tail = text.slice(m.index + m[0].length, m.index + window);
  const nums = tail.match(/-?\d[\d.,\s'’]*\d|-?\d/g);
  if (!nums || !nums.length) return null;
  for (const t of nums) {
    const v = toNumber(t);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Extract a tax AMOUNT. Tries the "rate first, amount after" shape
 * ("VAT 20%: $180.00") before falling back to a bare tax label, so the
 * percentage is never mistaken for the amount.
 */
function extractTaxAmount(text) {
  // Shape 1: "VAT 20%: $180.00" / "Tax (20%) 180.00" — amount follows the rate
  const withRate = text.match(/(?:tax|vat|gst|iva|tva|mwst)\b[^0-9\n]{0,12}(\d{1,2}(?:\.\d{1,2})?)\s*%?\s*[:\)\-]?\s*([$€£¥₹₺₽\s]*(-?\d[\d.,'’\s]*\d))/i);
  if (withRate && withRate[3] && toNumber(withRate[3]) !== null) {
    return toNumber(withRate[3]);
  }
  // Shape 2: "VAT: $180.00" — plain label followed by a value
  const plain = extractMoneyAfter(text, TAX_HINTS, 30);
  return plain;
}

/** Parse line items from a simple text receipt ("2x Widget 12.50"). */
function extractLineItems(text) {
  const items = [];
  const lineRe = /^\s*(?:(\d{1,4})\s*[x×]\s*)?(.+?)\s{2,}(\(?-?\d[\d.,'’\s]*\)?)\s*(?:([A-Z]{3}|[$€£¥₹₺₽]))?\s*$/gm;
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    const qty = m[1] ? Number(m[1]) : 1;
    const desc = m[2].trim();
    const amt = toNumber(m[3]);
    if (desc.length < 2 || amt === null) continue;
    if (!/[A-Za-z؀-ۿ]/.test(desc)) continue;
    items.push({ qty, description: desc.slice(0, 120), amount: amt, currency: m[4] || null });
    if (items.length >= 200) break;
  }
  return items;
}

// ---------------------------------------------------------------------------
// CSV path
// ---------------------------------------------------------------------------

function splitCsvLine(line, delim = ',') {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(sample) {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  if (!lines.length) return ',';
  const counts = [',', ';', '\t', '|'].map((d) => ({
    d,
    n: lines.reduce((acc, l) => acc + l.split(d).length - 1, 0),
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

const HEADER_ALIASES = {
  invoice_number: ['invoice', 'invoicenumber', 'invno', 'invnumber', 'number', 'no', 'docno', 'documentnumber', 'facturanumero'],
  issued_date: ['issuedate', 'invoicedate', 'date', 'dateissued', 'issue date', 'documentdate'],
  due_date: ['duedate', 'paymentdue', 'duedate', 'maturitydate', 'validdue'],
  vendor: ['vendor', 'supplier', 'seller', 'merchant', 'payee', 'company', 'from', 'name'],
  customer: ['customer', 'client', 'buyer', 'billto', 'to', 'clientname'],
  currency: ['currency', 'ccy', 'curr', 'currencycode'],
  subtotal: ['subtotal', 'netamount', 'nettotal', 'net', 'amountnet'],
  tax: ['tax', 'taxamount', 'vat', 'vatamount', 'gst', 'taxamounttotal'],
  tax_rate: ['taxrate', 'vatrate', 'gstrate', 'rate'],
  total: ['total', 'totalamount', 'grandtotal', 'amountdue', 'gross', 'grossamount', 'balance', 'totaldue'],
  due_amount: ['amountdue', 'due', 'outstanding', 'openamount', 'amountoutstanding'],
  reference: ['reference', 'ref', 'ponumber', 'paymentreference', 'externalid'],
  po_number: ['ponumber', 'po', 'purchaseorder'],
  notes: ['notes', 'note', 'memo', 'comment', 'remarks'],
  line_description: ['description', 'item', 'product', 'service', 'narrative', 'details'],
  line_qty: ['qty', 'quantity', 'units'],
  line_unit_price: ['unitprice', 'price', 'rate', 'unitcost'],
  line_total: ['linetotal', 'amount', 'total', 'lineamount', 'extendedamount'],
};

function normKey(k) {
  return String(k).toLowerCase().replace(/[\s_\-./\\]+/g, '');
}

function buildHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const nk = normKey(h);
    if (!nk) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] !== undefined) continue;
      if (aliases.some((a) => normKey(a) === nk)) { map[field] = idx; return; }
    }
    // fuzzy contains, e.g. "Invoice Number (old)"
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] !== undefined) continue;
      if (aliases.some((a) => nk.includes(normKey(a)) && normKey(a).length >= 3)) { map[field] = idx; return; }
    }
  });
  return map;
}

function parseCsv(text) {
  const delim = detectDelimiter(text);
  const lines = text.split(/\r?\n/);
  let headerIdx = lines.findIndex((l) => l.trim().length > 0);
  if (headerIdx === -1) return { rows: [], mapping: {}, delimiter: delim, errors: ['empty input'] };

  const headerRow = splitCsvLine(lines[headerIdx], delim).map((h) => h.replace(/^["']|["']$/g, '').trim());
  const map = buildHeaderMap(headerRow);
  const rows = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = splitCsvLine(line, delim);
    const get = (field) => (map[field] === undefined ? '' : (cells[map[field]] ?? ''));

    // Long/short format detection: blank invoice_number + present description => line item row
    const isLineItemRow = !get('invoice_number') && !!get('line_description');

    const rec = {
      invoice_number: get('invoice_number') || null,
      issued_date: parseDate(get('issued_date')),
      due_date: parseDate(get('due_date')),
      vendor: get('vendor') || null,
      customer: get('customer') || null,
      currency: (get('currency') || '').toUpperCase() || null,
      subtotal: toNumber(get('subtotal')),
      tax: toNumber(get('tax')),
      tax_rate: toNumber(get('tax_rate')),
      total: toNumber(get('total')),
      due_amount: toNumber(get('due_amount')),
      reference: get('reference') || null,
      po_number: get('po_number') || null,
      notes: get('notes') || null,
      line: isLineItemRow ? {
        description: get('line_description') || null,
        qty: toNumber(get('line_qty')) ?? 1,
        unit_price: toNumber(get('line_unit_price')),
        total: toNumber(get('line_total')),
      } : null,
      source_row: i + 1,
    };
    rows.push(rec);
    if (rows.length >= 10000) break;
  }
  return { rows, mapping: map, delimiter: delim, errors: [] };
}

// ---------------------------------------------------------------------------
// free-text path
// ---------------------------------------------------------------------------

function parseText(text) {
  const flat = text.replace(/\r/g, '');
  const blob = flat.replace(/\n{3,}/g, '\n\n');

  const invoice_number = matchFirst(blob, INVOICE_NO);
  const currency = detectCurrency(blob);

  let issued_date = null;
  const dm = blob.match(DATE_HINTS);
  if (dm) issued_date = parseDate(blob.slice(dm.index, dm.index + 50));

  let due_date = null;
  const um = blob.match(DUE_HINTS);
  if (um) due_date = parseDate(blob.slice(um.index, um.index + 60));

  const total = extractMoneyAfter(blob, TOTAL_HINTS);
  const subtotal = extractMoneyAfter(blob, SUBTOTAL_HINTS);
  const tax = extractTaxAmount(blob);
  const tax_rate = extractTaxRate(blob);
  const line_items = extractLineItems(blob);

  const vendorLine = blob.split(/\n/).map((l) => l.trim()).filter(Boolean)[0] || null;

  return {
    rows: [{
      invoice_number: invoice_number || null,
      issued_date,
      due_date,
      vendor: vendorLine && vendorLine.length < 90 ? vendorLine : null,
      customer: null,
      currency,
      subtotal,
      tax,
      tax_rate,
      total: total !== null ? total : (line_items.length
        ? round2(line_items.reduce((s, it) => s + it.amount, 0))
        : null),
      due_amount: total,
      reference: null,
      po_number: null,
      notes: null,
      line: null,
      source_row: 1,
    }],
    line_items,
    mapping: {},
    delimiter: null,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// validation + arithmetic checks
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function validateRecord(r, opts = {}) {
  const tolerance = Math.max(0.01, opts.tolerance ?? 0.05);
  const issues = [];

  const push = (field, code, severity, message) =>
    issues.push({ field, code, severity, message, source_row: r.source_row ?? null });

  for (const f of ['invoice_number', 'total', 'currency']) {
    if (r[f] === null || r[f] === undefined || r[f] === '') push(f, 'MISSING', 'error', `${f} is required`);
  }
  // Absent optional fields are not defects — warning on them made clean files score
  // below 100 and made the score meaningless. Only fields with a real expected role
  // (identifiers, money, dates, counterparty) are flagged when missing.
  for (const f of ['issued_date', 'due_date', 'vendor', 'subtotal', 'tax']) {
    if (r[f] === null || r[f] === undefined || r[f] === '') push(f, 'MISSING', 'warning', `${f} not found`);
  }

  if (r.issued_date && /^\d{4}/.test(r.issued_date) && +r.issued_date.slice(0, 4) > new Date().getUTCFullYear() + 1) {
    push('issued_date', 'FUTURE_DATE', 'error', 'issue date is in the future');
  }
  if (r.issued_date && r.due_date && r.due_date < r.issued_date) {
    push('due_date', 'BEFORE_ISSUE', 'error', 'due date precedes issue date');
  }

  // subtotal + tax == total
  if (r.subtotal !== null && r.tax !== null && r.total !== null) {
    const diff = Math.abs(round2(r.subtotal + r.tax) - r.total);
    if (diff > tolerance) {
      push('total', 'ARITHMETIC_MISMATCH', 'error',
        `subtotal ${r.subtotal} + tax ${r.tax} = ${round2(r.subtotal + r.tax)} but total is ${r.total} (off by ${round2(diff)})`);
    }
  } else if (r.subtotal !== null && r.total !== null && r.tax === null) {
    const implied = round2(r.total - r.subtotal);
    if (Math.abs(implied) > tolerance) {
      push('tax', 'TAX_NOT_REPORTED', 'warning',
        `total minus subtotal implies tax of ${implied} but no tax field was found`);
    }
  }

  // tax_rate cross-check
  if (r.subtotal && r.tax !== null && r.tax_rate !== null) {
    const expected = round2(r.subtotal * (r.tax_rate / 100));
    if (Math.abs(expected - r.tax) > Math.max(tolerance, r.subtotal * 0.005)) {
      push('tax', 'TAX_RATE_MISMATCH', 'warning',
        `${r.tax_rate}% of ${r.subtotal} = ${expected} but tax is ${r.tax}`);
    }
  }

  if (r.due_amount !== null && r.total !== null && Math.abs(r.due_amount - r.total) > tolerance) {
    push('due_amount', 'PARTIAL_PAYMENT', 'info',
      `amount due ${r.due_amount} differs from total ${r.total}`);
  }

  if (r.currency && !CURRENCY_CODES.has(r.currency)) {
    push('currency', 'UNKNOWN_CURRENCY', 'warning', `"${r.currency}" is not a recognised ISO-4217 code`);
  }

  return issues;
}

function scoreOf(issues) {
  const err = issues.filter((i) => i.severity === 'error').length;
  const warn = issues.filter((i) => i.severity === 'warning').length;
  return Math.max(0, Math.round(100 - err * 25 - warn * 7));
}

/**
 * Main entry.
 * @param {string} input   raw CSV/TSV or free text
 * @param {object} options { tolerance, maxRows, format: 'auto'|'csv'|'text' }
 */
function normalize(input, options = {}) {
  const t0 = process.hrtime.bigint();
  const errors = [];
  if (typeof input !== 'string' || !input.trim()) {
    return {
      ok: false, format: 'unknown', delimiter: null, row_count: 0,
      mapping: {}, records: [], issues: [{ field: null, code: 'EMPTY_INPUT', severity: 'error', message: 'input is empty' }],
      summary: { errors: 1, warnings: 0, infos: 0, avg_score: 0 },
      elapsed_ms: 0,
    };
  }

  const maxRows = options.maxRows ?? 5000;
  let format = options.format;
  if (format === 'auto' || !format) {
    const firstLines = input.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
    const commaish = firstLines.some((l) => (l.match(/,/g) || []).length >= 1)
      && firstLines.some((l) => (l.split(',').length - 1) >= firstLines.length - 1);
    format = commaish ? 'csv' : 'text';
  }

  let parsed;
  try {
    parsed = format === 'csv' ? parseCsv(input) : parseText(input);
  } catch (e) {
    errors.push({ field: null, code: 'PARSE_FAILED', severity: 'error', message: e.message });
    parsed = { rows: [], mapping: {}, delimiter: null, errors: [] };
  }

  if (!parsed.rows.length) {
    format = format === 'csv' ? 'text' : format; // CSV header with no rows -> retry as text
    if (format === 'text') parsed = parseText(input);
  }

  const records = parsed.rows.slice(0, maxRows).map((r) => {
    const issues = validateRecord(r, options);
    return { ...r, issues, score: scoreOf(issues) };
  });

  const all = records.flatMap((r) => r.issues).concat(errors);
  const tally = (sev) => all.filter((i) => i.severity === sev).length;

  return {
    ok: tally('error') === 0 && records.length > 0,
    format,
    delimiter: parsed.delimiter,
    row_count: records.length,
    truncated: parsed.rows.length > maxRows,
    mapping: parsed.mapping,
    line_items: parsed.line_items || undefined,
    records,
    issues: all,
    summary: {
      errors: tally('error'),
      warnings: tally('warning'),
      infos: tally('info'),
      avg_score: records.length ? Math.round(records.reduce((s, r) => s + r.score, 0) / records.length) : 0,
      clean_rows: records.filter((r) => r.score === 100).length,
    },
    elapsed_ms: Number(process.hrtime.bigint() - t0) / 1e6,
  };
}

module.exports = { normalize, parseCsv, parseText, validateRecord, parseDate, toNumber, detectCurrency, round2, CURRENCY_CODES };