# Business ledger ingest (the automation seam)

`POST /api/business/ingest` is how receipts get onto the books without anyone
re-typing them in the admin UI. It is the foundation for the daily
business-inbox routine described at the bottom.

This file is open source. No secrets, EINs, or bank details live here. The
ingest token lives only in Vercel env, and the ledger itself lives only in the
private Neon database.

## Auth

Bearer token, separate from the cron token on purpose.

```
Authorization: Bearer ${BUSINESS_INGEST_SECRET}
```

Set `BUSINESS_INGEST_SECRET` in Vercel (a long random string). If it is unset or
the header does not match, the route returns 404, so it is never an open write.
The ledger is also dark unless `SHARING_ENABLED` is on (returns 503).

## Request

```jsonc
{
  "entries": [
    {
      "date": "2026-06-05",        // YYYY-MM-DD, required
      "direction": "out",          // "in" or "out", required
      "amountCents": 9900,         // positive integer cents, required
      "category": "Apple Developer Program",
      "note": "Annual membership renewal",
      "taxCategory": "software",   // a TAX_CATEGORIES id (see tax-categories.ts)
      "source": "gmail:18f2a9c..." // required, stable id, see idempotency
    }
  ]
}
```

A single bare entry object (no `entries` wrapper) is also accepted. Max 100
entries per request. The batch is all-or-nothing: one invalid row rejects the
whole request with `entry N: <reason>` so nothing half-applies.

`taxCategory` must be one of the ids in
[`tax-categories.ts`](../../frontend/src/lib/business/tax-categories.ts)
(`software`, `hosting`, `fees_licenses`, `professional`, `advertising`,
`payment_fees`, `equipment`, `office`, `other`) or omitted. Those map to the
Schedule C lines the year-end CSV groups by.

## Idempotency

`source` is required and must not be the reserved value `manual`. A row whose
exact `source` already exists is returned untouched and counted under `skipped`,
not inserted again. Give each receipt a stable id (the Gmail message id is
ideal) so a daily re-scan of the same inbox never double-logs an expense.

## Response

```jsonc
{ "ok": true, "inserted": 2, "skipped": 1, "entries": [ /* rows, each with inserted:bool */ ] }
```

## The daily inbox routine this unlocks (vision, not yet built)

A scheduled Claude Code run that:

1. Reads the ResearchOS LLC business inbox.
2. Pulls receipts and invoices, extracts date, amount, vendor, and a best-guess
   tax category.
3. POSTs them here with `source` set to the message id (idempotent re-runs).
4. Drafts a reply asking for a PDF when a charge has no attached receipt.
5. Leaves the operator a short digest of what it booked and what it is waiting on.

Everything it touches lands on `/admin/business`, already tax-categorized, so the
year-end CSV is ready to hand to self-file tax software.
