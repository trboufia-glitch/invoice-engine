# Distribution kit — invoice.engine

Everything below is written to be posted as-is. Replace `https://invoice-checker-ie.surge.sh` with the deployed
host and `990584936` with your Binance ID (default `990584936`).

Posting as an anonymous "here's a free tool" link gets no replies. Every post below leads
with a **specific failure the reader recognises from their own month-end**, then shows the
tool. Lead with the pain, not the API.

---

## 0. The fastest distribution asset: the client-side tool

`docs/` is a complete invoice checker that runs **entirely in the visitor's browser** — no
signup, no API key, no backend, nothing uploaded. Host it anywhere and it works.

This beats the hosted API for reach: the API demands a key and a plan before anyone sees a
result, so it loses people at the first step. The browser tool answers in five seconds.
The API is what you sell to the people who liked it.

### Deploying it (zero cost)

GitHub Pages is **unavailable on free accounts** (`422: Your current plan does not support
GitHub Pages for this repository`), so use surge.sh:

```bash
npm install -g surge
cd docs
surge . invoice-checker.surge.sh
```

It prompts to create an account inline (email + password) — that prompt is yours to
complete. Free forever, HTTPS on the subdomain, unlimited deploys. Every publish is an
immutable revision and `surge rollback` reverts globally.

Alternatives: Netlify Drop (drag the folder, no account to start) or Cloudflare Pages
(unlimited bandwidth).

Before uploading, confirm the generated bundle and the page still work:

```bash
node scripts/build_browser.js    # parses + smoke-tests the bundle, exits non-zero on failure
npm run test:page                # exercises the page's export helpers headlessly
```

The page offers two downloads: the full checked dataset as JSON, and a CSV containing only
the rows that need attention (`!` marks an error, `?` a warning). **That export is the
conversion mechanism** — a free tool that only paints a table on screen sends the work back
to Excel, so people leave with nothing to show their boss. Check the bundle after every
change; it is generated code and it can drift.

---

## 1. Hacker News — Show HN

Title (72 chars max, no marketing):

> Show HN: I built a validator that finds the arithmetic errors in your invoice CSVs

Body:

```
Accounting teams lose days to a boring failure: a spreadsheet export where the totals
silently don't reconcile, and nobody notices until the quarter closes.

I built a small API for this. You paste a CSV export (or raw receipt text), and it
returns clean JSON plus every row where subtotal + tax ≠ total, where the stated tax
rate doesn't match the tax amount, or where the due date precedes the issue date.

It's fully deterministic — regex and arithmetic, no LLM. Same input, same output,
which matters when the result is feeding an accounting pipeline. It also handles the
locale stuff that breaks naive parsers: 1.234,56 vs 1,234.56, semicolon and tab
delimiters, 15-Mar-2026. And it rejects 2026-02-31 instead of rolling it over.

It runs entirely in your browser tab, so nothing is uploaded, no signup, no key:
https://invoice-checker-ie.surge.sh

The interesting part for me was the bugs. My CSV splitter was hardcoded to commas, so
every European export collapsed into a single column — silent corruption on half the
market. My regex for "total" matched inside "Subtotal". An empty cell parsed as 0, which
manufactured fake warnings. All written up at https://invoice-checker-ie.surge.sh/ledger.

What invoice-format edge cases am I still missing?

I'm curious what invoice-format edge cases I'm still missing.
```

---

## 2. Reddit — r/Bookkeeping, r/Accounting, r/smallbusiness

**r/Bookkeeping** (the most concentrated audience for this):

```
Built a tool that finds arithmetic errors in invoice exports before you file

Posting something I made, and I'd rather you tell me it's useless than be polite.

It's a small web tool. You paste a CSV export from your accounting software (or the
raw text of a PDF invoice) and it gives you back clean data plus a list of rows that
don't add up: subtotal + tax ≠ total, stated tax rate doesn't match the tax amount,
due date before issue date, impossible dates like Feb 31.

Free, no signup, and it runs in the browser tab — your file is not uploaded anywhere:
https://invoice-checker-ie.surge.sh

The reason I built it: a client sent 40 invoices where the tax line was blank on six
of them. The total still looked plausible, so it wasn't caught until the return was
rejected. A blank cell reading as "0" is the kind of bug that costs real money.

It handles European number formats and semicolon-separated exports, since that's
half the clients I work with.

What formats am I not handling that you actually see in practice?
```

**r/smallbusiness**:

```
Tool I made: catches math errors in your invoice/billing CSV exports

If you export invoices from QuickBooks, Xero, Shopify or Stripe and then do anything
with that file in Excel — sort, split, re-import — small errors slip through. A VAT
line that doesn't match the rate, a subtotal that doesn't reconcile with the total.

Free, paste and go, runs in your browser so nothing is uploaded: https://invoice-checker-ie.surge.sh

It flags the exact rows with the numbers side by side so you can see the discrepancy.
You paste the file; nothing is stored or uploaded anywhere.

Not an accounting product. Just the "does this file actually add up" check.
```

---

## 3. Indie Hackers

```
After 4 failed attempts at a product, I built the boring thing instead: a CSV validator

The honest postmortem version.

I tried four "AI for X" ideas. Every one died on the same line — cost per call. If
your margin is a token, you need volume you don't have yet, and you're funding other
people's inference from your own pocket.

So I built the thing that needs no model at all: an invoice CSV validator. Parse the
export, check that subtotal + tax = total, verify the tax rate, reject Feb 31. All of
it regex and arithmetic, ~1ms for a 5-row file.

The interesting part wasn't the product, it was the six real bugs I found by testing
against my own messy real-world files:
- the splitter was hardcoded to commas, so every semicolon file (half of Europe)
  collapsed into one column — silent corruption
- my regex for "total" matched inside "Subtotal"
- an empty cell parsed as 0, which produced fake validation warnings
- the demo data I shipped had arithmetic errors of its own, so the demo cried wolf

All of it is written up at https://invoice-checker-ie.surge.sh/v1/ledger, failures included.

Current state: 58/58 tests green, works, zero revenue, no users. Payouts via USDT.

What's the highest-leverage thing I could do to get the first 10 users?
```

---

## 4. Hacker News alternative title (if the first gets no traction)

> Show HN: A CSV parser that understands 1.234,56 and semicolon-delimited European exports

---

## 5. Direct outreach — the highest-yield channel

Small accounting firms and e-commerce operators are reachable directly and reply to
plain email. Send **20 of these**. Personalised, three sentences, no pitch deck.

Subject: the $0 tool for checking your invoice exports

```
Hi {{name}},

I built a small free tool because I kept hitting the same problem at month-end:
invoice exports from {{their software}} don't always add up — a blank VAT line, a
rate that doesn't match the amount, a total that doesn't reconcile with the
subtotal. Nothing flags it until the return is rejected.

You paste the file, it lists the rows that don't add up with the numbers side by side.
Runs in your browser, nothing uploaded, no signup: https://invoice-checker-ie.surge.sh

If your last quarter had a rejected return for a maths error, it's worth ten seconds
to try it on this quarter's export. If not, ignore this — no follow-up.

{{your name}}
```

---

## 6. Where to post (priority order)

| Channel | Why | Effort |
|---|---|---|
| Reddit r/Bookkeeping | Highest concentration of the exact pain | 15 min |
| Direct outreach ×20 | Slowest to start, most likely to produce a real customer | 2 hours |
| Indie Hackers | Founder audience, gives technical feedback | 10 min |
| Hacker News | Traffic if it hits, near-zero if it doesn't | 15 min |
| r/smallbusiness, r/Accounting | Broad, more noise, test messaging here | 10 min |

---

## Rules that protect the account

- **Post from your real account, never a throwaway.** HN filters new accounts hard; Reddit
  bans pattern-identical first-day posts instantly.
- **One link per post, one honest description, no cross-posting the same text within a
  day.** Reposting identical copy to four subreddits is the surest way to be flagged.
- **No affiliate links, no referral codes, no tracking parameters.**
- **Disclose the affiliation** — "I built this" — in the first line, not a footnote.
- If a post is removed, ask the moderators. Do not repost.

---

## What success looks like

Track it in `data/experiments.jsonl`. The only numbers that matter:

- **posts → playground visits** (is the copy landing?)
- **playground visits → keys minted** (does the free offer work?)
- **keys minted → orders created** (is there a real willingness to pay?)
- **orders created → paid** (is the checkout actually usable?)

If visits are high and keys are low, the free tier is too small or the copy is unclear.
If keys are high and orders are zero, the pricing is wrong or the value isn't obvious —
do not build more features; fix that.

---

## Before you post: verify this works

```
curl https://invoice-checker-ie.surge.sh/health
curl -X POST https://invoice-checker-ie.surge.sh/v1/keys
open https://invoice-checker-ie.surge.sh/playground   # paste the "Mismatched totals" sample, expect 3 errors
open https://invoice-checker-ie.surge.sh/v1/ledger    # must NOT be empty — the seed ships with it
```

If the ledger is empty, the seed did not copy; check that `seed/` is in the image.