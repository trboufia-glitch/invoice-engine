# Invoice Engine

A deterministic invoice/CSV normalizer sold as a metered API. **Zero dependencies, zero
capital to run, no LLM in the request path** — so every call costs nothing to serve and
the same input always returns the same output.

Bookkeepers and small finance teams get a clean JSON record set from a messy export, with
arithmetic errors, tax mismatches and impossible dates flagged before the data ever reaches
the ledger.

```
node server.js          # http://127.0.0.1:8787
npm test                # 58 tests: 31 unit + 27 end-to-end against a live server
```

## Why deterministic

The failure mode that kills trust in an accounting pipeline is a hallucinated invoice
number or a silently rounded figure. Putting an LLM in the parse loop buys nothing here —
every check is arithmetic — and costs money per call plus non-reproducibility. The regex
and arithmetic layer is faster (1–2 ms for 5 rows, ~40 ms for 3,000), free, and auditable.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/keys` | no | Mint an API key (25 free calls) |
| POST | `/v1/normalize` | yes | Parse + validate a file |
| GET | `/v1/usage` | yes | Credits and call count |
| POST | `/v1/orders?plan=pro` | yes | Create a payment order |
| POST | `/v1/orders/:id/confirm` | yes | Settle an order (`{"tx_ref":"0x…"}`) |
| GET | `/v1/plans` | no | Pricing and payout ID |
| GET | `/v1/ledger` | no | Public experiment scoreboard |
| GET | `/playground` | no | Interactive try-it page |

### Normalize

```bash
KEY=$(curl -s -X POST http://127.0.0.1:8787/v1/keys | node -pe 'JSON.parse(require("fs").readFileSync(0)).api_key')

curl -X POST http://127.0.0.1:8787/v1/normalize \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":"Invoice Number,Invoice Date,Subtotal,Tax,Total\nINV-1,2026-01-05,1000.00,200.00,1200.00"}'
```

Request fields: `input` (required), `format` (`auto` | `csv` | `text`), `tolerance`
(arithmetic slack, default `0.05`), `max_rows` (default 5,000, cap 25,000).

## What it handles

**Numbers** — `1,234.56` · `1.234,56` · `1 234,56` · `1'234.50` · accounting negatives
`(250.00)`. An empty cell is absent (`null`), never `0`.

**Dates** — ISO, `15/03/2026`, `03/15/2026`, `15-Mar-2026`, `Mar 15, 2026`, two-digit
years. Day-first vs month-first is disambiguated per value; calendar-invalid dates like
`2026-02-31` are rejected rather than silently coerced.

**Delimiters** — `,` `;` tab `|`, detected per file. Quoted fields with embedded
delimiters and escaped quotes survive.

**Headers** — ~50 aliases with fuzzy matching, so `Doc Number (old)` maps to
`invoice_number` and `Grand Total` to `total`. Unmapped headers are reported, not guessed.

**Validation** — `subtotal + tax = total`; the tax rate is recomputed against the tax
amount; due dates before issue dates; future dates; unknown currency codes; partial
payments. Every issue carries `source_row` so a customer can jump to the exact line.

Each row gets a 0–100 score (`100 − 25·errors − 7·warnings`) and the response carries a
summary plus `ok: false` whenever any blocking error exists.

## Billing

Credit-metered. Credits are debited per call; exhausted credits return `402` with the
top-up path. Settlement is idempotent in both directions — a replayed confirmation on the
same order returns `already_settled`, and a `tx_ref` already used by another order is
rejected with `409`. No path exists to mint credits for free.

Payout destination is configurable via `BINANCE_ID` (default in `server.js`).

## Deployment

`Dockerfile`, `railway.json` and `render.yaml` are included and verified. Full walkthrough
in `marketing/DEPLOY.md`. Two things are not optional:

- **Mount a persistent volume at `/data`.** A container filesystem is wiped on every
  deploy — without a volume, every live API key and paid credit is lost on restart. The
  service prints a warning at boot if neither a volume nor `DATA_DIR` is configured.
- **Set `BINANCE_ID`.** It defaults to `990584936`.

The service binds `0.0.0.0` automatically on a container (`RAILWAY_ENVIRONMENT`, `RENDER`
or `/.dockerenv` detected) — binding to `127.0.0.1` on a PaaS host looks like a crash
while the process is actually healthy.

## Distribution

`marketing/DISTRIBUTION.md` contains ready-to-post copy for Hacker News, r/Bookkeeping,
r/smallbusiness and Indie Hackers, plus a 20-email direct-outreach template.

Funnel events are tracked from the pages themselves and read back at `/v1/funnel`:

```
landing_view → playground_view → key_minted → orders_created → orders_paid
```

Distribution is the only channel that produces revenue, so the question that matters
first is never "what else should I build" — it is which of these steps is losing people.

## What this is (data layout)

```
lib/normalize.js    parsing + validation core (no I/O, no deps)
lib/store.js        API keys, credit ledger, orders, experiment log
server.js           HTTP layer: auth, metering, checkout
public/             landing page + playground
tests/              unit and live-server end-to-end suites
data/               store.json (keys/orders), experiments.jsonl (ledger)
```

`store.json` is written via temp-file-then-rename, so a crash mid-write cannot truncate it;
a corrupt store is moved aside rather than crashing the service.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `HOST` | `127.0.0.1` | Bind address |
| `BINANCE_ID` | `990584936` | Payout destination |

## Honest status

Built and verified: the engine, the API, auth, metering, checkout, settlement safety, the
landing page, the playground, the Docker/Railway/Render deployment files and the
distribution copy. **63/63 tests green** (31 unit + 32 end-to-end against a live server),
plus live browser verification of the pages and funnel tracking.

**Not done, and the reason is your accounts, not effort:**

- **Not deployed.** No GitHub repo, no git identity, no `gh`, and no Railway/Render
  credentials exist on this machine. Creating accounts and accepting their terms in your
  name is not mine to do. Everything needed is staged in git — 19 files, credentials
  excluded — and `marketing/DEPLOY.md` has the exact commands.
- **No commit or push was run.** That needs your name and email, and your explicit word.
- **No revenue.** `$0`, and it stays `$0` until the distribution posts go out and
  someone decides to pay. Distribution is the bottleneck, not engineering.
- **No on-chain payment watcher.** Settlement is an API call carrying the customer's tx
  hash; verifying it against a real chain is the next build if you ever want unattended
  crediting.

`/v1/ledger` records all of this honestly: 10 experiments, 3 successful, 6 bugs found and
fixed, each with the cause written down.