# Metered storage pricing (hybrid)

Status: design, supersedes the flat-block model (2026-06-07)
Author: HR (orchestrator)
Decision: Grant picked "hybrid metered storage" over flat blocks, full metering,
and document-only.
Related: `metered-storage-billing-wiring.md` (the flat-block wiring this changes),
`SUBSCRIPTION_CANCELLATION.md`, `lib/billing/*`, `lib/collab/server/limits.ts`

## The model in one paragraph

Every user gets the free tier (1 GB of server storage). Above that, they pay for
the storage they ACTUALLY use, billed by the gigabyte-month, aggregated into one
Stripe invoice per month. There are no blocks to buy. Instead a user raises their
own storage cap when they need more room; they are billed only for real usage up
to that cap, and the cap is also the wall that bounds both their bill and our
Cloudflare cost. Operations (requests, compute, row writes) are NOT metered to
users; they stay covered by the fixed base and watched on `/admin`.

## What is billable

- Free tier: 1 GB, never billed. Most users live here and pay nothing.
- Rate: $0.30 per GB-month of usage above the free tier. Cost-plus, our Durable
  Objects cost is $0.20/GB-month, plus a $0.10 margin. The Stripe per-invoice fee
  ($0.30 + 2.9%) is absorbed by the monthly aggregation and the minimum below.
- Minimum billable: we do not raise an invoice under ~$2 in a month. Below that,
  Stripe's flat fee eats most of the charge, so tiny overages are simply not
  billed (carried as goodwill, not accrued). A user pays $0 until their real
  monthly usage above 1 GB is worth at least ~$2 (about 6-7 GB stored).
- Measure: average GB-month over the billing period (sampled daily), the same
  basis Cloudflare bills us on, so what we charge tracks what we pay. (Open
  question 1 covers peak-vs-average.)

## The cap replaces "buying blocks"

Flat blocks asked the user to pre-decide how much to buy. Metered flips it: the
user sets a storage CAP (in GB, or equivalently a max monthly dollar exposure),
and we bill actual usage up to it. The cap does three jobs at once:

1. It is the enforcement wall. `getOwnerQuotaBytes` returns the cap, so
   `appendUpdate` rejects writes past it exactly as it does today. Our Cloudflare
   cost can never exceed the sum of users' caps.
2. It is the user's spend ceiling. "At most $X/month" is the predictable number a
   PI can budget against, even though the actual bill floats below it.
3. It is opt-in. The default cap is the free 1 GB, so no account is ever billed
   without the user deliberately raising it.

The Settings storage panel (just rebuilt) becomes: usage bar against the cap, the
current month's running estimated charge, and a "raise limit" control instead of
"add storage".

## Stripe mechanics

- One metered Price (per GB-month) on a Stripe meter, replacing the per-block
  fixed Price. Usage is reported to the meter, Stripe invoices monthly.
- A monthly usage-report job (cron) computes each owner's average billable
  GB-month from the daily samples and reports it to Stripe, applying the free-tier
  subtraction and the minimum-charge rule before reporting.
- Idempotency and the existing webhook stay: `invoice.paid` still records the LLC
  ledger entry and the receipt, the amount is just variable now.
- Live billing stays gated on `BILLING_ENABLED` + the WI DOR sales-tax gate, same
  as today.

## Operations stay off the user bill

Requests, compute duration, and row writes are real costs (see the cost table in
chat) but sit inside Cloudflare's large free allowances at our scale, and the
fixed $5 Workers + $20 Vercel base covers the baseline. So they are not metered to
users. `/admin` already watches the operation counts; if they ever approach a paid
tier we revisit, rather than burdening every user's bill with micro-charges now.

## What changes in the existing code

The flat-block billing backend is built but never went live, so this is a
rework, not a migration of real customers:

- `lib/billing/config.ts`: replace `GB_PER_BLOCK` / `paidStorageBytes` /
  `recommendedBlockPriceCents` with a per-GB-month rate, the free tier (already
  there), the minimum-charge constant, and a cap helper.
- `lib/billing/db.ts`: subscription row becomes a metered enrollment, store the
  user's cap and the daily usage samples (or sample into a small table).
- Checkout: a metered subscription rather than a fixed-quantity one.
- New: the daily usage sampler and the monthly report-to-Stripe job.
- `getOwnerQuotaBytes`: return the user's cap instead of free + purchased blocks.
- Settings panel: "raise limit" + running charge, replacing "add storage".

This is a data-shape change (the subscription/usage tables), so it gets flagged
and built behind `BILLING_ENABLED` like the current code.

## Interaction with cancellation

`SUBSCRIPTION_CANCELLATION.md` still holds, with a cleaner trigger. There is no
subscription to delete. "Canceling" is the user lowering their cap back to the
free 1 GB (or we lower it on payment failure). Everything above the new cap
freezes to static local copies and its redundant server bytes are purged after
the grace window, governed by the same never-delete-the-only-copy rule. Because
billing is usage-based, stopping is graceful, usage simply falls back into the
free tier and the bill goes to $0.

## Open questions for Grant

1. Billable measure: average GB-month (fairest, matches our Cloudflare bill) or
   peak GB during the month (simpler, slightly favors us)? Recommend average.
2. Cap default and granularity: should the user pick the cap in GB (e.g., a 5 GB /
   25 GB / 100 GB picker) or as a dollar ceiling that we convert to GB? GB is
   more concrete; recommend a GB picker that shows the max monthly cost beside it.
3. Minimum charge: ~$2/month proposed. Confirm the number and that sub-minimum
   overage is waived (not accrued to a future month).
4. Rate: $0.30/GB-month (cost $0.20 + $0.10 margin). Confirm, or set a different
   margin.

## Out of scope

- Metering operations (requests/compute) to users, watched, not billed, for now.
- Refunds/proration (Stripe handles billing).
- Full account deletion (separate flow).
