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

The segmentation: solo researchers often pay out of pocket, so keep them cheap.
The LAB is the core paid unit, priced to reflect the bundle it now carries (the
companion app, lab companion sites, real-time collab, the dashboard). The
DEPARTMENT is the institutional VOLUME tier, priced BELOW a standalone lab per
lab, on purpose: landing a department brings many labs at once, so we reward that
distribution win instead of taxing it. Lab volume + dept breadth carry the
revenue; cheap solo barely dents the total.

- **Free** (the network audience): unlimited local notebook, shared-folder
  workspaces (sync through your own cloud), directory presence, RECEIVE shared
  work (the sender pays the relay), accept invites, all public surfaces. No cloud
  produce features.
- **Solo**: **$3/mo base + cloud usage at 5x cost.** Unlocks the produce side:
  send, live co-edit, the paired companion app, push.
- **Lab**: **$25/mo per lab FOUNDING lock-in rate + usage at 7x cost** (Grant
  2026-06-19), billed per active seat's activity. Founding labs (those who sign up
  in the founding window) keep $25/mo per lab FOR LIFE as long as they never lapse
  a payment or cancel; the price rises for labs that join later. The public price
  is the $25 founding rate with NO $40 anchor. The engine steady-state base in
  `MODEL_A_PLANS.lab` stays $40 (operator modeling only, never shown publicly), and
  the founding rate (`FOUNDING_LAB_BASE_CENTS`) sits below it. The core paid unit,
  priced for the bundle it carries (companion app pairing, the lab's web home +
  paper companion pages, real-time co-edit, the lab dashboard, shared library,
  pooled budgets). FLAG: the lifetime lock-in needs a per-lab founding-cohort
  record so the engine charges $25 for grandfathered labs at billing go-live;
  billing is OFF in beta so nothing to enforce yet.
- **Department** (institutional tier): **pricing TBD / contact-led** (Grant
  2026-06-19). A department brings many labs at once and the governance needs vary,
  so the price is scoped with the customer via the `/departments/contact` reach-out
  form, not shown as a list price. The governance layer (Department Commons,
  compliance and data-continuity, multi-lab admin, one consolidated procurement
  invoice) is INCLUDED value. The old "$35/lab, 6x, cheaper than a standalone lab"
  framing is RETIRED from public copy; `MODEL_A_PLANS.dept` keeps $35 / 6x as the
  operator steady-state estimate for the `/admin` modeling tool only.
- **Storage** (any plan): a-la-carte at ~1.15x our cost (fee recovery, no
  margin), only for objects you choose to push to cloud. Per-object opt-in is
  sacred; nothing is ever force-pushed.
- **AI** (any plan): prepaid token packs, metered at **1.4x** (solo and lab) /
  **2x** (dept) over our ~$0.153/M measured cost. Roughly a few percent of
  revenue, deliberately not the money-maker.

Every unit is still a fraction of what it replaces: LabArchives alone is ~$27.50
per user per month. A 6-seat lab here is ~$40 base plus usage (well under
$165/mo for the same seats on LabArchives), and a department pays even less per
lab.

## Billing mechanics

- We SHOW a monthly price but BILL off an accrued ledger to dodge Stripe's $0.30
  per-charge fee.
- A new lab starts with a 90-day free trial and NO card or payment info at signup
  (Grant 2026-06-19). We collect no card upfront because a lab adopts over a
  semester, not a weekend, so a PI can bring the whole team on and feel the value
  before any money is involved. The lab is not charged for the trial regardless
  of usage. Before day 90 we prompt for a payment method (the settings billing
  panel plus an in-app countdown). At day 90 a lab with a card on file resumes
  normal charging; a lab with no card PAUSES (cloud accrual and sending stop, the
  local app and data keep working) until a card is added, so we never silently
  run up an uncharged bill and there is always an escape. Solo keeps the
  save-a-card-at-signup flow; only the lab tier gets the no-card trial.
- We only run the card once the owed balance crosses ~$5, or immediately at
  cancellation (final invoice for accrued usage). Practical cadence is 6 months.
- No bill-shock: AI is prepaid packs, storage is prepaid blocks, and the ledger
  has a settable monthly cap. A running-low balance is a prompt to top up, never
  a hard lockout (the local app and data keep working).

## Economics at the working config

- TO RE-DERIVE in `service-model.ts` from the 2026-06-16 reprice (Lab $25 -> $40,
  Dept $50 -> $35 per lab). Direction is clearly positive: the Lab raise lifts
  per-lab revenue and lowers break-even; Dept priced down trades per-lab margin
  for volume (each dept brings many labs). The pre-reprice baseline was blended
  net ~$5.87/paid, break-even ~40 paying (~1,000 signups at 5% paid), ~$172k/yr
  at 2,500 paying; the new numbers move up on Lab and lean on dept breadth.
- Fixed cost ~**$262/mo** (Claude Max $200 that co-runs ops, infra ~$37,
  software + tax software + LLC phone ~$25), growing only slightly with scale.
- Owner taxes (single-member LLC pass-through) modeled at ~32% on profit only;
  they do not move break-even, only take-home.

## Open and pending

- FINAL lock after the Grant + Emile meeting. This is the working version.
- The public `/pricing` page is ALREADY rebuilt to Model A (scorecard tiers,
  catalog-driven prices via `PlanPriceCallout` reading `MODEL_A_PLANS`, no GB
  ladder). Catalog base fees verified 2026-06-19: solo $3 / 5x, lab $40 / 7x,
  dept $35 / 6x (`frontend/src/lib/billing/model-a/pricing.ts`). It stays in the
  Beaker maintenance state on prod only until Grant flips `NEXT_PUBLIC_PRICING_LIVE`.
  `/about` is likewise already the two-founder story (Emile is a co-founder on the
  page) and just needs its maintenance gate flipped.
- The DEAD `frontend/src/lib/pricing/assumptions.ts` + `frontend/src/lib/billing/plans.ts`
  still encode the old GB ladder, but the public `/pricing` page does NOT use them
  (it reads the Model-A catalog). They feed the operator `/admin` modeling tool and
  are a separate cleanup. `service-model.ts` remains the accurate service model there.
- Exact per-user cloud usage (relay writes) is the #1 beta unknown; the dials
  here are honest estimates, grounded later from `collab_owner_writes`.
