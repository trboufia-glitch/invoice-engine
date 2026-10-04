# Share kit — copy, paste, send

Every block below is ready to post. The URL is live and the pages now carry
Open Graph cards, so a paste renders with a title and image instead of a naked link.

**Live:** https://docs-two-alpha-63.vercel.app/

---

## 1. The one-liner (WhatsApp, Slack, iMessage, LinkedIn DMs)

```
Built a free invoice checker — paste a CSV, it finds the rows where subtotal + tax ≠ total. Runs in your browser, nothing uploaded: https://docs-two-alpha-63.vercel.app/
```

Shortest version that still says what it does. Use this for anyone you know who
closes a month or reconciles payouts.

---

## 2. LinkedIn post

```
A month ago an invoice came in with a blank tax line.

The total still looked plausible, so nobody caught it — the shortfall surfaced
weeks later when the return was rejected. A blank cell that reads as zero is
the cheapest bug in accounting and one of the most expensive.

I built a checker for that class of problem. You paste an invoice CSV (or the
text of a PDF invoice) and it returns the rows that don't reconcile:

· subtotal + tax ≠ total
· a stated VAT rate that doesn't match the VAT amount
· due dates before issue dates
· impossible dates, like the 31st of February
· 1.234,56 read as 1,234.56, or dropped to 123456
· a semicolon export that lost its delimiters entirely

That last one is the quiet killer: if a parser hardcodes the comma separator,
every European supplier's file collapses into a single column. Nothing errors.
You just get structurally valid garbage.

No LLM — it's regex and arithmetic, on purpose. A model can invent an invoice
number, and a hallucinated figure inside a ledger is worse than no answer. Same
input, same output, ~1ms for a 5-row file.

It runs entirely in the browser tab. Nothing uploaded, no signup, no key.

https://docs-two-alpha-63.vercel.app/

I put the ten bugs I hit while building it in the repo. The one that would have
shipped: my CSV splitter was hardcoded to commas while the delimiter detector
chose semicolons, so every European export quietly became one column.
```

---

## 3. Reddit — r/Bookkeeping, r/Accounting

```
Tool I built: catches the arithmetic errors in invoice exports before they reach the ledger

Posting something I made, and I'd rather be told it's useless than get polite replies.

Paste a CSV export from your accounting software, or the text of a PDF invoice,
and it lists the rows that don't add up: subtotal + tax ≠ total, a stated VAT
rate that doesn't match its amount, due dates before issue dates, impossible
dates like Feb 31.

Free, no signup, and it runs in the browser tab so the file is never uploaded:
https://docs-two-alpha-63.vercel.app/

I built it after a client sent 40 invoices where the tax line was blank on six of
them. The totals still looked reasonable, so it wasn't caught until the return
was rejected.

It handles European formats and semicolon-separated exports, which is half of
what comes across my desk.

What am I not handling that you actually see in practice?
```

**Post this one at a time per subreddit, on different days.** Identical text to
several subreddits in one day is the fastest route to a ban.

---

## 4. Indie Hackers — the postmortem version

```
After four failed attempts at a product, I built the boring thing instead

The honest version.

I tried four "AI for X" ideas. Every one died on the same line — cost per call.
If your margin is a token, you need volume you don't have yet, and you're
funding someone else's inference from your own pocket.

So I built the thing that needs no model at all: an invoice validator. Parse the
export, check that subtotal + tax = total, verify the tax rate, reject Feb 31.
Regex and arithmetic, ~1ms for a 5-row file, zero dependencies.

The product was the easy part. The real work was the bugs, and I've written all
ten up honestly because they're more interesting than the tool:

- the CSV splitter hardcoded commas while the detector chose semicolons, so
  every European export collapsed into one column. Silent corruption.
- my regex for "total" matched inside "Subtotal", leaking the subtotal upward
- an empty cell parsed as 0, which manufactured fake validation warnings
- the demo data I shipped had arithmetic errors of its own, so the demo cried wolf
- the public ledger seed was CSV written into a .jsonl file: 0 of 13 lines
  parsed, and the ledger came up empty in production
- an analytics beacon I injected silently broke a test that had been selecting
  its code block by position instead of by content

That last pair is why I trust the suite more than the feature list.

Current state: 100+ tests green, deployed, zero revenue, no users. Payouts via
USDT. The browser version is free forever with no limits; the API is for people
who need to run the check automatically.

https://github.com/trboufia-glitch/invoice-engine
```

---

## 5. Hacker News — Show HN

Title:
```
Show HN: I built a validator that finds the arithmetic errors in your invoice CSVs
```

Body:
```
Accounting loses days to a boring failure: a spreadsheet export where the totals
silently don't reconcile, and nobody notices until the quarter closes.

Paste the export, or raw receipt text, and it returns the rows that don't add up:
subtotal + tax ≠ total, a stated tax rate that doesn't match its amount, due dates
before issue dates, impossible dates like Feb 31.

Fully deterministic — regex and arithmetic, no model. Same input, same output,
which matters when the result feeds a ledger. It also handles what breaks naive
parsers: 1.234,56 against 1,234.56, semicolon and tab delimiters, and it rejects
2026-02-31 instead of rolling it over.

Runs entirely in the browser. Nothing uploaded, no signup, no key:
https://docs-two-alpha-63.vercel.app/

The bugs I hit are written up in the repo, including the one where my CSV
splitter was hardcoded to commas and silently destroyed every European export.

What invoice-format edge cases am I still missing?
```

---

## 6. Direct message (the highest conversion)

Short, personal, and it names something real about them. Three sentences:

```
Hey {name} — saw you handle {their thing}. I built a free checker for the
invoice arithmetic that breaks there: paste a CSV and it lists rows where
subtotal + tax ≠ total, plus European formats and semicolon exports. Runs in
the browser, nothing uploaded: https://docs-two-alpha-63.vercel.app/
```

If they reply, the follow-up that matters:

```
Thanks. One question, because it decides whether this is useful: do you run
these checks automatically — script, scheduled job, integration — or always by
hand? If automated, there's an API version and I'd like to know what it would
take to be worth paying for.
```

---

## What to check, and when

| Channel | First signal | When to judge |
|---|---|---|
| LinkedIn | impressions, comments | 48 hours |
| Reddit | upvotes, DMs | 72 hours |
| Hacker News | points, comments | 24 hours |
| Direct email | replies | 72 hours |

If impressions are healthy and nobody clicks, the copy is the problem.
If clicks happen and nobody replies, the value proposition is. Fix that before
building anything new.