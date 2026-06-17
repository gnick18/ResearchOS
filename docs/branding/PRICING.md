# ResearchOS pricing (canonical)

Status: WORKING LOCK (2026-06-16) to build the pages against. Grant + Emile firm
this up at their sign-off meeting, so treat the numbers as settled-enough-to-build,
not immutable. This doc is the single source of truth for pricing facts and copy.
It SUPERSEDES `docs/branding/BILLING_FACTS.md` and `docs/reference/billing-copy-facts.md`
(both the GB-ladder era). Companions: the review deck
`docs/proposals/2026-06-16-pricing-modes.html`, the model write-up
`docs/proposals/2026-06-16-service-tier-structure.md`, the live model
`frontend/src/lib/pricing/service-model.ts`, and memory
`[[project-pricing-finalize-2026-06]]`.

House voice in all customer copy: no em-dashes, no emojis, no mid-sentence colons.
Never call the free shared-folder capability "collab" (that word is reserved for
the paid live relay feature).

## The model (Model A, locked)

ResearchOS is a local-first cloud-SERVICES company, NOT a storage-by-GB vendor.
The app is free and unlimited on your own machine. We charge for the cloud
SERVICES the relay enables, on a pay-for-what-you-use basis:

- A small base fee per plan, plus your actual cloud USAGE billed at a markup.
- AI is a separate metered token product (its own packs), never the main margin.
- Storage is a-la-carte at roughly cost (no markup beyond fee recovery). We do
  not profit from holding your data; that is the trust play, and it backs the
  department pitch (keep your data on your own institution cloud).
- Free users cost us almost nothing: a one-time ~$0.25 AI sign-up grant and no
  cloud usage that scales. So we measure the business by PAID customers.

## What each plan is, and the prices (working lock)

The segmentation: solo researchers often pay out of pocket, so keep them cheap
(the "medium" level). Labs and departments run on grant and institutional
budgets, so they sit at the "premium" level for the enterprise value they get.
Lab and dept carry the revenue; cheap solo barely dents the total.

- **Free** (the network audience): unlimited local notebook, shared-folder
  workspaces (sync through your own cloud), directory presence, RECEIVE shared
  work (the sender pays the relay), accept invites, all public surfaces. No cloud
  produce features.
- **Solo** (medium): **$3/mo base + cloud usage at 5x cost.** Unlocks the
  produce side: send, live co-edit, phone capture, push. About **$4.50/mo**
  all-in at typical use.
- **Lab** (premium): **$25/mo flat per lab + usage at 7x cost**, billed per
  active seat's activity. About **$38/mo** for a 6-seat lab (~$6.30/seat). Adds
  the lab dashboard, shared library, pooled budgets.
- **Department** (premium, enterprise): **$50/mo per lab + usage at 6x cost.**
  About **$304/mo** for a 5-lab, 30-seat department (~$10.10/seat). This is the
  governance tier: the Department Commons, compliance and data-continuity, admin
  and per-lab budgets, one consolidated invoice. A dept lab is still cheaper than
  a standalone lab because dept usage is marked up less (6x vs 7x).
- **Storage** (any plan): a-la-carte at ~1.15x our cost (fee recovery, no
  margin), only for objects you choose to push to cloud. Per-object opt-in is
  sacred; nothing is ever force-pushed.
- **AI** (any plan): prepaid token packs, metered at **1.4x** (solo and lab) /
  **2x** (dept) over our ~$0.153/M measured cost. Roughly a few percent of
  revenue, deliberately not the money-maker.

Every unit is a fraction of what it replaces: LabArchives alone is ~$27.50 per
user per month. Here a solo seat is ~$4.50, a lab seat ~$6.30, a dept seat ~$10.

## Billing mechanics

- We SHOW a monthly price but BILL off an accrued ledger to dodge Stripe's $0.30
  per-charge fee. Card on file at signup (so it stays collectible).
- We only run the card once the owed balance crosses ~$5, or immediately at
  cancellation (final invoice for accrued usage). Practical cadence is 6 months.
- No bill-shock: AI is prepaid packs, storage is prepaid blocks, and the ledger
  has a settable monthly cap. A running-low balance is a prompt to top up, never
  a hard lockout (the local app and data keep working).

## Economics at the working config

- Blended net ~**$5.87 per paying customer**. Break-even ~**40 paying customers**
  (~1,000 signups at a 5% paid rate).
- Net ~**$14.3k/mo (~$172k/yr) at 2,500 paying** (~50k signups), ~$29k/mo at
  5,000 paying.
- Fixed cost ~**$262/mo** (Claude Max $200 that co-runs ops, infra ~$37,
  software + tax software + LLC phone ~$25), growing only slightly with scale.
- Owner taxes (single-member LLC pass-through) modeled at ~32% on profit only;
  they do not move break-even, only take-home.

## Open and pending

- FINAL lock after the Grant + Emile meeting. This is the working version.
- The public `/pricing` page and its components are still built for the dead
  GB-ladder model and need a full rebuild to Model A. The page is currently in a
  Beaker maintenance state on prod, so there is no rush. Same for `/about`
  (solo-founder story, hidden until remade with Emile as co-founder).
- `frontend/src/lib/pricing/assumptions.ts` and `frontend/src/lib/billing/plans.ts`
  (the source-of-truth code) still encode the GB ladder and get reshaped to
  Model A as part of that page rebuild. Until then, `service-model.ts` is the
  accurate model.
- Exact per-user cloud usage (relay writes) is the #1 beta unknown; the dials
  here are honest estimates, grounded later from `collab_owner_writes`.
