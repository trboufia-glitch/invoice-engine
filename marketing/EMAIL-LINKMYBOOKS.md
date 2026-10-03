Subject: the Shopify payout reconciliation check

Hi,

You mentioned that Shopify payouts not matching Xero is the recurring problem for
your clients. That's the same arithmetic failing at a different layer: the order
lines add up, the VAT line reconciles, and the settlement still doesn't, because
the fee and discount lines were never in the export to begin with.

I built a small free checker for the layer below that. Paste an invoice CSV — or
the raw text of a PDF invoice — and it returns the rows that don't add up:

  · subtotal + tax ≠ total
  · a stated VAT rate that doesn't match the VAT amount
  · due dates before issue dates
  · impossible dates, like the 31st of February
  · 1.234,56 read as 1,234.56 (or dropped to 123456)
  · a semicolon export that lost its delimiters entirely

That last one is worth flagging specifically: if your parser hardcodes the comma
separator, every European supplier's file collapses into a single column. Nothing
errors, you just get structurally valid garbage.

It runs entirely in the visitor's browser tab. Nothing is uploaded, no signup, no
API key, and it's free with no limits:

  https://invoice-checker-ie.surge.sh

There's an API version if you'd rather wire it into a pipeline, but honestly if
you're checking files by hand, the browser version is the whole product.

The engine is deterministic — regex and arithmetic, no model — so it never invents
an invoice number and the same input always returns the same output. That matters
if it's going anywhere near a reconciliation you have to defend.

Happy to send the six specific failure modes with the arithmetic that identifies
each one, if that's more useful than the tool.

Either way, ignore this if it isn't a problem you're already paying for.

— sent from trboufia@gmail.com