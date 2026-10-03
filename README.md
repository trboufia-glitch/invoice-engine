# invoice-engine

**Your invoice CSV is lying to your accountant.** This finds out which row.

Paste a CSV export (or raw receipt text) and get back clean JSON plus every row that
fails to reconcile — `subtotal + tax ≠ total`, a tax rate that doesn't match its amount,
due dates before issue dates, impossible dates like `2026-02-31`.

It runs **entirely in the browser tab**. Nothing is uploaded, no signup, no API key,
free with no limits.

**[Try it →](https://invoice-checker-ie.surge.sh/)** · [Why totals don't add up](https://invoice-checker-ie.surge.sh/why-totals-dont-add-up.html) · [API](https://invoice-checker-ie.surge.sh/api.html)

---

## Why not just use an LLM for this

Because an LLM can invent an invoice number, and a hallucinated figure inside an
accounting pipeline is worse than no answer. Every check here is arithmetic:

```
subtotal 1,000.00 + VAT 200.00 = 1,200.00   but total says 9,999.00
→ ARITHMETIC_MISMATCH at row 2, off by 8,799
```

Deterministic means: no token bill, ~1 ms for a 5-row file, and byte-identical output for
identical input. It is safe inside a month-end close.

## What it actually handles

The unglamorous cases that break naive parsers:

| Case | Handled |
|---|---|
| `1,234.56` · `1.234,56` · `1 234,56` · `1'234.50` | ✅ last separator is the decimal point |
| `(250.00)` accounting negative | ✅ |
| Delimiters `,` `;` tab `\|` | ✅ detected per file |
| `15/03/2026` · `03/15/2026` · `15-Mar-2026` | ✅ disambiguated per value |
| `2026-02-31` | ✅ rejected, not silently rolled over |
| `Doc Number (old)` → `invoice_number` | ✅ ~50 header aliases, fuzzy matched |
| Empty cell | ✅ `null` — **never** `0` |

## Use it as a library

The engine is pure: no filesystem, no network, no dependencies.

```js
const { normalize } = require('./lib/normalize');

const r = normalize(csvText, { format: 'csv' });

if (r.summary.errors > 0) {
  for (const issue of r.issues) {
    console.error(`row ${issue.source_row}: ${issue.code} — ${issue.message}`);
  }
  process.exit(1);   // fail loudly instead of filing bad numbers
}
```

## Run the API

```bash
node server.js                     # http://127.0.0.1:8787
npm test                           # 100+ tests
node scripts/build_browser.js      # regenerate the browser bundle
node scripts/verify_live.js        # verify the deployed site end to end
```

Zero runtime dependencies. Docker, Railway and Render configs included.

## Honest status

Works, tested, and deployed — **zero revenue and no users yet.** The
[experiment ledger](https://invoice-checker-ie.surge.sh/ledger) is public and records
everything, including the ten bugs found while building it:

- the CSV splitter was hardcoded to `,` while the detector chose `;`, so **every European
  export collapsed into one column** — silent corruption
- `/total/i` matched inside "Sub**total**", leaking the subtotal into the total
- `toNumber("")` returned `0`, so every missing column looked like a real zero and
  manufactured warnings
- the HTML was served as `text/plain`, so browsers showed raw source
- the rate limiter keyed on IP, throttling paying customers
- the demo data shipped with its own arithmetic errors, so the demo cried wolf
- the ledger seed was CSV inside a `.jsonl` file: 0 of 13 lines parsed, and the public
  ledger came up empty in production

The last one is why this README is public: the failures are the most useful part.

## Deploying it yourself

`Dockerfile`, `railway.json` and `render.yaml` are included. If you deploy on a PaaS
container, **mount a persistent volume at `/data`** — otherwise API keys and credits are
lost on every deploy. The service binds `0.0.0.0` automatically when it detects a
container.

## License

MIT.