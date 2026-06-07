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
- Measure (DECIDED): average GB-month over the billing period, sampled daily.
  Fairest, and the same basis Cloudflare bills us on, so what we charge tracks
  what we pay. A user who spikes then deletes pays little.

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
"add storage". The cap control (DECIDED) is a GB picker (e.g. 5 / 25 / 100 GB)
with the maximum monthly cost shown beside each option, so the dollar exposure is
always visible while the user thinks in concrete space.

## Lab-level (consolidated) billing

A lab head (PI) can pay for their whole lab in one invoice rather than each member
billing individually. This is the normal research case, the PI holds the grant and
the budget; members should not each need a card.

- Two modes coexist. INDIVIDUAL (default): a user pays for their own usage above
  their 1 GB free. LAB-SPONSORED: the PI turns on lab billing and one consolidated
  metered invoice covers every member's usage. Members in a sponsored lab never see
  a bill.
- Pooled free tier. Each member keeps their own 1 GB free, so a sponsored lab's
  free pool is 1 GB times the member count. The PI's invoice meters only aggregate
  usage above that pool, so a small or light lab still pays $0.
- One lab cap. The PI sets a single GB cap for the lab (with the max monthly cost
  shown), which is the lab-wide enforcement wall and the PI's spend ceiling.
- Payer resolution. For any shared doc, the bill goes to the doc owner's lab if
  that lab sponsors billing, otherwise to the owner individually. This extends the
  cancellation doc's "owner pays" rule with "...unless their lab sponsors them".
- Membership follows the existing identity model (`isLabHead` plus the lab head's
  shared-folder membership). A member who leaves reverts to individual billing for
  docs they own; nothing is deleted, the same freeze rules apply.
- When a PI turns on lab billing, any individual subscription a member already had
  ends and the lab takes over their usage, so no one is double-billed.

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

## Operations: tracked + fair-use, not metered to the bill (Grant 2026-06-07)

Requests, compute duration, and row writes are real costs and storage-only
metering misses the worst case, a user who keeps active docs small but edits
constantly. Such a user stores almost nothing (compaction folds old update rows
into the snapshot, so storage stays flat) yet generates most of the cost through
rows written, Durable Object active duration, and requests. At scale, many such
users would cost far more than their storage bill recovers.

The chosen model (Grant 2026-06-07, supersedes the earlier "operations stay off
the bill, just watched" note):

- Storage stays the ONLY thing with a dollar meter. It is predictable, it is what
  a PI can budget, and it keeps the promise that collaboration itself is free. We
  do not put a fluctuating compute charge on a researcher's invoice.
- Operations are TRACKED per owner. We did not measure this before, only bytes.
  We now count, per owner, the write operations and bytes written through the one
  collab growth point (appendUpdate), which keeps accruing even when net storage
  does not. `/admin` turns these into a true estimated cost-per-owner using the
  published Cloudflare rates, so an expensive owner is visible instead of hidden
  behind a near-zero storage bill.
- A generous monthly activity allowance bounds the exposure. Past it we THROTTLE
  (rate-limit writes, drop real-time sync to periodic) rather than bill. A normal
  heavy lab barely notices; an automated or runaway client hits a wall. WebSocket
  Hibernation already makes idle connections near-free, so only genuine heavy
  editing is ever throttled.
- Escalation held in reserve, data-driven. If tracking later shows many LEGIT
  labs hitting the allowance, we convert it into a paid-plan activity gate (a plan
  requirement above the free allowance), not per-unit compute billing.

Build order. Tracking + the `/admin` cost-per-owner view first (no user-facing
change, commits us to nothing, gives the data). The fair-use allowance + throttle
is a separate, user-visible step gated on what the tracking shows.

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

## Decided (all mechanics locked 2026-06-07)

- Rate: $0.30/GB-month above the free tier (cost $0.20 + $0.10 margin).
- Free tier: 1 GB per user.
- Billable measure: average GB-month, sampled daily.
- Minimum charge: ~$2/month; sub-minimum overage is waived, not accrued.
- Cap control: a GB picker showing the max monthly cost.
- Lab-level billing: a PI can sponsor the whole lab on one invoice.
- Lab free tier: per-member pooled (1 GB x member count).
- Lab visibility: lab aggregate by default, per-member usage opt-in.

Design is fully signed off. Build behind `BILLING_ENABLED`, gated on the WI DOR
sales-tax determination before any live charge.

## Out of scope

- Metering operations (requests/compute) to users, watched, not billed, for now.
- Refunds/proration (Stripe handles billing).
- Full account deletion (separate flow).
