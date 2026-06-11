# Sponsorship tiers (storage-as-thank-you)

> SUPERSEDED (2026-06-10). Current model is SOLIDARITY pricing: individuals and labs pay
> cost recovery, departments and institutions pay a modest sustaining rate above cost
> through automated self-serve plan builders, and that surplus keeps ResearchOS free for
> individual researchers. Storage plans live on Stripe (a Free/Plus/Pro plan picker, 5 GB
> free), and GitHub Sponsors is the individuals give-extra path (recognition-only, it
> cannot invoice a university). So the storage-as-reward ladder below is replaced by the
> plan picker plus the dept/institution builders, and only the Sponsors-donation framing
> survives. Canonical customer copy: docs/branding/BILLING_FACTS.md (mirror
> docs/reference/billing-copy-facts.md). Keep this doc for the donation-framing reasoning only.

Status: DRAFT v2, re-based on the billing manager's review (2026-06-09). Author: branding agent.
Related: METERED_STORAGE_PRICING.md, LAB_SHARED_BILLING_POOL.md, plans.ts, capacity-shared.ts,
project_stripe_setup. House style: no em-dashes, no emojis, no mid-sentence colons.

## The idea (Grant, 2026-06-09)

Instead of asking labs to donate out of pure altruism, give a proportional, tangible
reward: pay at a tier and your lab's shared cloud pool (plus its activity allowance) grows.
A real benefit converts recurring support far better than a tip jar, and the surplus over
our cost subsidizes free solo users and sustains the project after the fellowship ends.

Guardrail Grant set: revenue from a tier should be at least 2-3x the cost of what that tier
gives. v1 of this doc claimed 17-33x because it used the wrong cost basis; corrected below.

## Two lanes, kept visibly separate (the honesty model, unchanged)

Our locked posture is "metered storage = cost recovery, not a profit center." A 2-3x margin
is margin, so we must not blur the two or it reads as a hidden markup. Keep them distinct:

- **Metered storage.** Strict cost-recovery, pass-through, for a lab that just needs more
  space and does not want a "support plan."
- **Support tiers.** "Support open-source science software; as a thank-you your lab gets a
  bigger shared pool and activity allowance." The surplus funds the free solo tier and
  sustainability. We are not selling storage at a markup; we are thanking supporters with it.

Both run on **Stripe** (see channel note). The "support open-source" framing lives on a
Stripe-powered page; it does not require GitHub Sponsors.

## The real cost basis (the v1 error, corrected)

The metered pool is `collab_doc_sizes`, the Loro snapshot byteLength stored in the Cloudflare
Durable Object. Our own model (`capacity-shared.ts`) prices DO storage at **$0.20/GB-month**.
The $0.015 R2 rate used in v1 covers only the disaster-recovery backup and relay file bundles,
not the canonical store the tiers grow. So the planning basis is **$0.20/GB-month**, and
Stripe fees (~2.9% + $0.30 per charge) come off the top.

Open question that could lower the basis: whether large image/file attachments live as DO
snapshot bytes ($0.20) or are split to R2 ($0.015) and metered separately. If attachments are
R2-stored, a blended rate is defensible and the GB per tier could rise. If they are embedded
in the Loro doc (DO), it is the full $0.20. **Confirm the attachment architecture before
locking GB.** Numbers below assume the conservative all-DO $0.20 basis.

## Resized tier ladder

Free baseline unchanged: every lab and solo user gets 1 GB shared + 1M writes/month. Tiers
ADD to the lab's pool and activity allowance. GB are set BELOW the storage-only 3x cap on
purpose, to absorb the separate activity-compute cost (DO write ops are a second cost axis,
not in the storage figure).

| Tier            | USD / month | Lab shared pool | Writes / month | Other perks                         |
|-----------------|-------------|-----------------|----------------|-------------------------------------|
| Free            | $0          | 1 GB            | 1M             | The default for every lab and solo. |
| Supporter       | $5          | 5 GB            | 1M             | Name on the open-source credits wall |
| Lab             | $10         | 12 GB           | 3M             | + credits wall                       |
| Research group  | $25         | 30 GB           | 10M            | + a say in the feature roadmap       |
| Department      | $50         | 60 GB           | 15M            | + roadmap + early access             |
| Heavy / custom  | metered     | pay-as-you-go   | metered        | Beyond 60 GB, switch to metered cost-recovery |

Activity allowances reuse the existing `plans.ts` tiers (free 1M, Plus 3M, Pro 10M, Lab 15M).
The non-storage perks (credits wall, roadmap vote, early access) cost us nothing and deepen
the lock-in.

## Margin math, re-based on $0.20/GB-month + Stripe fees

| Tier         | Pool GB | Storage cost @ $0.20 | Net revenue (after Stripe) | Storage margin |
|--------------|---------|----------------------|----------------------------|----------------|
| Supporter $5 | 5 GB    | $1.00 | $4.56  | 4.6x |
| Lab $10      | 12 GB   | $2.40 | $9.41  | 3.9x |
| Research $25 | 30 GB   | $6.00 | $23.98 | 4.0x |
| Department $50 | 60 GB | $12.00| $48.25 | 4.0x |

Every tier clears ~4x on storage alone. That ~4x (versus the 3x target) is the deliberate
cushion for the activity-compute cost the storage figure excludes, so the NET margin across
storage + writes lands near the 3x guardrail. The billing manager should confirm the
per-write `estimatedOpsCostCents` against these allowances does not eat past the cushion,
and nudge GB down if it does (especially Department, the thinnest after compute).

Launch-scale honesty: providers include 5 GB DO + 10 GB R2 free account-wide, so at a handful
of sponsors marginal cost is roughly $0 and any ladder profits. These numbers are sized for
AT-SCALE post-fellowship sustainability, where the $0.20 marginal cost governs, not the
free-tier honeymoon.

## Channel: Stripe, not GitHub Sponsors

Reversing v1. Selling a tangible, metered benefit (storage) is a poor fit for GitHub
Sponsors, whose terms are for supporting work, not selling a service with goods expected in
return, and it does not handle the sales-tax obligation on a benefit sale (below). Stripe is
one pipeline, one tax flow, and it is already built. Reserve GitHub Sponsors, if at all, for
recognition-only donations (a badge, no storage).

## Fulfillment: model each tier as a plan (reuse plans.ts)

Each support tier is a flat **plan** in `plans.ts` with `storageBytes` = the tier's pool and
the matching write allowance. `plans.ts` already does Stripe checkout + the webhook +
setting the pool allowance. The Stripe subscription webhook manages the grant lifecycle
(active -> grant on the PI's key, canceled -> revoke), and a grant on the PI's key lifts the
whole lab pool via `billing_grants` + `resolveBillingOwner`, which is exactly right. Keep the
manual `GiftPoolsPanel` for operator one-offs (beta testers), not for self-serve recurring.

## Sales tax (the real launch gate)

It is a sale (tangible benefit for payment, for-profit LLC), so it is taxable, and the
"support open-source, thank-you storage" wording does NOT make it a tax-exempt donation. The
live-charge gate (the `sk_live_` check in `/api/billing/plan`) already blocks live charges
until the WI DOR sales-tax determination lands. Taxability follows the customer's state via
economic nexus, so it is multi-state: lean on **Stripe Tax**. Cannot launch with live charges
until the determination lands and tax handling is wired.

## Marketing copy (draft, updated GB)

- **Supporter, $5/mo.** "Back free, open science software and keep a photo-light lab synced.
  Your lab's shared pool grows to 5 GB, and your name joins the open-source credits wall."
- **Lab, $10/mo.** "For a small, active lab. A 12 GB shared pool with a higher activity
  allowance, and you help keep ResearchOS free for labs that cannot pay."
- **Research group, $25/mo.** "A busy, image-heavy lab with room to spare. A 30 GB shared
  pool and a say in what we build next."
- **Department, $50/mo.** "A big shared workspace and early access. At this tier you are
  substantially funding the free tier for solo researchers."

No "free forever," no "we will never charge." Storage is framed as a thank-you for supporting
the project, never as buying space at a markup.

## Open items for the billing manager to lock

1. Confirm the attachment-storage architecture (DO $0.20 vs R2 $0.015 blended). This is the
   one thing that could justify more GB per tier.
2. Confirm the per-write compute cost against the activity allowances so the ~4x storage
   cushion genuinely covers it; nudge Department GB down if not.
3. Confirm the plans.ts tier shapes (storageBytes + write allowance) for the four tiers.
4. Stripe Tax wiring + the WI DOR gate stays the hard launch blocker.

## Strategic sizing questions (Grant, 2026-06-09, pending billing manager)

These two reshape the ladder and depend on answers above:

- **Is the pool even enough for a normal 6-8 person lab?** This is entirely gated by item 1.
  If images count against the DO pool ($0.20), text is trivial but photos dominate, and an
  active lab generates roughly 2-4 GB/year, so free 1 GB is only ~3-6 months and the Lab
  tier likely needs to grow from 12 GB to ~20-25 GB for multi-year comfort. If attachments
  split to R2, the pool is text-only and 1 GB is plenty for any normal lab indefinitely (and
  the storage tiers lose most of their pull). We cannot size honestly until item 1 is answered.

- **A $100 top tier?** Two distinct things hide in "covers 5+ labs":
  - A bigger SINGLE lab/group (15-20 people): just extend the ladder. $100/mo nets ~$96.80,
    so ~100-120 GB holds the ~4x margin, and the surplus subsidizes roughly 75+ free labs
    (not 5). Clean to add.
  - A true INSTITUTIONAL tier where one payment covers 5+ SEPARATE lab pools (multiple PIs):
    the as-built model is per-lab (one PI = one pool), so this needs a new department /
    institution aggregation concept. That is a model design question, not a price point.
