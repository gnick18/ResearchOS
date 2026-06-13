# Pricing cost model (numbers behind the plans)

> **LIVE COST MODEL, but read the canon first.** Current model is SOLIDARITY pricing:
> individuals and labs pay cost recovery, departments and institutions pay a modest
> sustaining rate ABOVE bare cost, and that surplus keeps ResearchOS free for
> individual researchers and funds the open-source development. Canonical customer copy:
> `docs/branding/BILLING_FACTS.md`. The cost-recovery formula below is the floor that
> the individual/lab tiers sit at; the dept/institution builders add a sustaining
> contribution on top (see DEPARTMENT_TIER.md). The Free tier is 5 GB, not 1 GB.

Status: working model, numbers PROVISIONAL pending tracking data (2026-06-07)
Decision philosophy (Grant, UPDATED 2026-06-10): individuals and labs pay cost
recovery, charge as close as possible to only the fees that get passed to us (infra
+ Stripe + tax) but never so low that a paying user costs us more than they pay.
Departments and institutions pay a modest sustaining rate above bare cost, and that
surplus keeps ResearchOS free for individual researchers and funds the open-source
development. This is solidarity pricing, not a flat "cost recovery, never profit"
model. The free, local-first core stays free; only optional cloud storage + activity
is priced.
Related: METERED_STORAGE_PRICING.md, infra-tiers.ts, lib/billing/config.ts,
DEPARTMENT_TIER.md, docs/branding/BILLING_FACTS.md

## The fees that actually get passed to us

Per paying account per month, our real costs are:

1. Marginal STORAGE. Cloudflare Durable Objects SQLite is $0.20/GB-month (collab
   doc bytes, tiny). Files go to R2 at $0.015/GB-month with free egress (the bulk
   of stored bytes for a user with attachments). So storage cost is a BLEND that
   leans cheap, somewhere between $0.015 (file-heavy) and $0.20 (doc-heavy) per
   GB-month. We do not know the real mix yet.
2. Marginal ACTIVITY. Each collab write is one row written (~$1.00/M rows) plus
   about one request (~$0.15/M), so ~$1.15 per million writes, measured. Durable
   Object active duration ($12.50/M GB-s) is real but not yet attributed per
   owner, so pad activity to ~$1.50/M writes until we measure it.
3. STRIPE. 2.9% + $0.30 per invoice on a US card, plus ~1.5% for an international
   card and ~1% for currency conversion, plus ~0.5% if Stripe Tax is on. A bank
   debit (ACH, SEPA) is far cheaper at ~0.8% (ACH capped at $5). That spread is
   why billing offers DUAL PRICING: the card is the list price and a bank-transfer
   payer gets a discount reflecting the lower fee (a discount for a cheaper method,
   not a card surcharge, see BILLING_FACTS.md and lib/billing/processing-fee.ts).
   The flat $0.30 dominates small invoices, which is why tiny amounts are not worth
   billing (the existing ~$2 minimum).
4. TAX. WI sales tax (if the DOR rules it taxable) is ADDED to the customer at
   checkout, not absorbed by us. Income tax is on profit; at cost recovery profit
   is ~0, so the income-tax reserve is near zero.
5. FIXED BASE. Workers Paid $5 + Vercel ~$20 + misc, about $25-30/month flat,
   independent of user count. Funded by the RISE fellowship + donations (the
   local-first core), NOT loaded onto per-user price. Marginal costs 1-3 are what
   the plans recover.

## The cost-recovery formula

For a plan whose worst case is `S` GB stored and `A` million writes:

    marginal_cost = S * storage_rate + A * activity_rate
    price = (marginal_cost / (1 - 0.029)) + 0.30   // gross up for Stripe
            then + a small safety buffer (~15%) for utilization variance

storage_rate = $0.05/GB-mo (conservative blend, mostly R2 with DO headroom)
activity_rate = $1.50/M writes (measured $1.15 + DO-duration pad)

The buffer exists so that normal variance (a plan used a bit above its modeled
worst case) does not put us underwater. It is the opposite of a profit margin, it
is the "never get fucked" guard Grant asked for.

## The key insight: ACTIVITY, not storage, is the cost driver

Storage is cheap (files are $0.015/GB-mo). A million writes costs more than a
gigabyte stored. So the lever that protects us is the activity ALLOWANCE per plan
(the throttle ceiling), not the storage cap. Sizing the free activity allowance
too high is the main way we lose money, because every free user could cost up to
allowance * $1.50/M.

Realistic write volumes (to be confirmed by tracking):
- Light note-taker: 1k-20k writes/month
- Active daily user: 50k-200k
- Heavy real-time collaborator: 200k-1M
- Very heavy, multi-doc all day: 1M-3M
- Automated / runaway: 10M+

So a free activity allowance around 1M writes/month covers essentially all normal
and most heavy HUMAN use, costing us at most ~$1.50/free user (most cost pennies),
while the throttle stops the automated 10M+ case cold.

## Provisional tiers (validate the numbers with tracking before launch)

Storage in a bundle plan is a flat included allowance up to the cap (standard SaaS
shape), not metered on actual use; the metered per-GB number survives only as the
a-la-carte comparison anchor.

The Free tier is **5 GB** (Grant locked this 2026-06-09 after a price analysis,
`FREE_ALLOWANCE_BYTES` in `lib/billing/config.ts`). The Plus and Pro worked figures
below are an internal cost-recovery WORKSHEET, not publishable sticker prices. The
FINAL Plus and Pro sticker prices stay unpublished until real usage sets them; do
not print them in any customer-facing surface.

| Plan | Storage | Activity / mo | Worst-case cost | Price (cost-recovery worksheet) |
|------|---------|---------------|-----------------|------------------------|
| Free | 5 GB    | 1M writes     | ~$1.75          | $0 (base/donations)    |
| Plus | 50 GB   | 3M writes     | 50*$0.05 + 3*$1.50 = $7.00 | ~$8/mo (provisional)      |
| Pro  | 250 GB  | 10M writes    | 250*$0.05 + 10*$1.50 = $27.50 | ~$32/mo (provisional)  |

Lab plans pool the same costs across members on one invoice (per-member free
pool + shared paid headroom), priced the same way on the lab aggregate.

These prices assume the $0.05/GB blended storage and $1.50/M activity rates above.
If tracking shows storage is almost all R2 (file) bytes, the storage component
roughly halves and Plus/Pro get cheaper. If it shows DO duration adds a lot to
activity, the activity rate (and prices) rise. We set the table provisionally and
finalize from data.

## What the tracking must tell us before we lock prices

The ops-tracking already built (billing_ops_samples) plus a storage breakdown
will give us the three numbers the table is sensitive to:

1. Storage file/doc mix per owner (R2 vs DO bytes), to pin storage_rate.
2. Real write-volume distribution, to size the free allowance and plan tiers
   against actual behavior, not guesses.
3. DO active-duration per owner (needs DO-side instrumentation), to replace the
   $1.50/M activity pad with a measured rate.

Recommended: run tracking for ~2-4 weeks of real beta use, then plug the measured
rates into the formula and lock the table.

## Locked decisions (Grant 2026-06-07)

- Storage in a plan: FLAT included up to the cap (a clean Stripe subscription
  price per plan), not metered on actual use. The metered per-GB number survives
  only as the a-la-carte comparison anchor.
- Launch posture: FREE FOR EVERYONE DURING BETA. Billing stays dark
  (BILLING_ENABLED off) so we gather real usage, but the whole plan/throttle
  system is BUILT and ready to flip on at any time. Final prices + allowances are
  configurable and get filled from tracking data before the flip.

Still soft: buffer size (15% placeholder), and whether any of the fixed base is
ever amortized into plans once there are enough payers (default: no, stays on
fellowship/donations).

## What "built and ready to turn on" requires (plan-model rework)

The chunks 1-3 backend is METERED (per-GB-month). The chosen model is FLAT bundle
plans, so readiness is a rework, not a flag flip. Carries over: lab billing
structure, payer resolution, ops tracking, the popup shell, Stripe plumbing. New
work:

1. Plan catalog (config): Free/Plus/Pro + lab variants, each = {storage cap,
   monthly activity allowance, flat price, Stripe price id}. Numbers provisional.
2. Subscription becomes "which plan", not a metered item. Quota = plan storage
   cap. Activity allowance = plan write ceiling. Replace the GB-month report cron
   with a flat subscription (Stripe handles recurring billing).
3. Activity throttle in the collab write path: track monthly writes vs the plan
   allowance; past it, degrade real-time sync to periodic + rate-limit, never bill
   per-unit.
4. UI: plan picker + activity bar + the comparison anchor in BillingPopup,
   replacing the cap picker.
5. Storage file/doc split + DO-duration attribution in tracking, to finalize the
   cost rates.

All behind BILLING_ENABLED so beta stays free while the machinery is ready.
