Subject: the Shopify payout reconciliation check

Hi,

The problem with Shopify payouts not matching Xero is that the order lines add up, the VAT reconciles, and the settlement still doesn't — because the fee and discount lines were never in the export to begin with.

I built a small free checker for the layer below that. Paste an invoice CSV, or the raw text of a PDF invoice, and it returns the rows that don't add up:

- subtotal + tax does not equal total
- a stated VAT rate that doesn't match the VAT amount
- due dates before issue dates
- impossible dates, like the 31st of February
- 1.234,56 read as 1,234.56, or dropped to 123456
- a semicolon export that lost its delimiters entirely

That last one is worth flagging specifically. If a parser hardcodes the comma separator, every European supplier's file collapses into a single column. Nothing errors — you just get structurally valid garbage.

It runs entirely in the browser tab. Nothing is uploaded, no signup, no API key, and it is free with no limits:

https://invoice-checker-ie.surge.sh

There is an API version if you would rather wire it into a pipeline, but if you are checking files by hand the browser version is the whole product.

The engine is deterministic — regex and arithmetic, no model — so it never invents an invoice number, and the same input always returns the same output. That matters if it is going anywhere near a reconciliation you have to defend.

Happy to send the six failure modes with the arithmetic that identifies each one, if that is more useful than the tool.

Either way, ignore this if it is not a problem you are already paying for.

Best,
Oussama