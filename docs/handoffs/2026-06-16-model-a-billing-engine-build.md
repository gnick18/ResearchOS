# Model A billing engine build (in flight)

Status: STARTED 2026-06-16. Grant decided "build Model-A billing now" (vs ship the
old flat-plan engine or ship-flat-then-rebuild). This doc is the design + the step
sequence. Canonical pricing is `docs/branding/PRICING.md`; the pure projection
calculator is `frontend/src/lib/pricing/service-model.ts` (the ENGINE reuses its
rate primitives so billing and projections never drift).

House voice in any copy: no em-dashes, no emojis, no mid-sentence colons.

## Why this exists

The site copy now describes Model A (local-first cloud SERVICES, pay-for-what-you-use:
a base fee + metered cloud usage at a markup, storage a-la-carte near cost). The
billing ENGINE, however, is still the old flat-plan GB ladder (`plans.ts`:
free / plus $8 / pro $32 / lab_free / lab_plus $15 / lab_pro $45, fixed Stripe
subscription). Flipping `BILLING_ENABLED` today would charge prices the site no
longer shows. So we build the Model-A engine before flipping.

## The model (target)

- Solo: $3/mo base + relay usage at 5x our bare cost.
- Lab: $25/mo base PER LAB + relay usage at 7x.
- Department: $50/mo base PER LAB + relay usage at 6x (premium governance tier).
- Storage (any tier): a-la-carte at 1.15x our cost (STORAGE_MARKUP), no margin.
- Hosted companion-site assets: same 1.15x (hostedAssetMonthlyCost).
- AI: separate metered token product (already built: ai_balances / ai_ledger,
  1.4x solo+lab / 2x dept, one-time ~1.6M token sign-up gift). UNCHANGED.
- Free: the network audience. No produce features, ~$0 recurring. No base, no usage.
- Billing mechanic: SHOW a monthly price but BILL off an ACCRUED LEDGER to dodge
  Stripe's $0.30/charge. Card on file at signup (SetupIntent). Run the card when
  the accrued balance crosses ~$5, or immediately at cancellation. ~6-month cadence
  in practice. A settable monthly cap prevents bill-shock; local app never stops.

## What already exists (do not rebuild)

- Metered raw usage: `collab_owner_writes` (writes/owner/month, YYYY-MM buckets),
  `collab_doc_sizes` (bytes/owner), `lab_hosted_assets` (hosted bytes/lab), all in
  `lib/collab/server/db.ts`. Pool reads: `getLabPoolUsage` / `getLabPoolWrites`
  (PI + active members), `getLabHostedBytes`. Period helper `currentWritePeriod()`
  in `lib/billing/period.ts`.
- Cost primitive: `estimatedOpsCostCents(writes)` (config.ts) and `relayCost(writesM)`
  (service-model.ts) both convert writes -> our DO cost (rows+requests ~$1.15/M).
- Enforcement choke point: `GET /api/billing/owner-state` -> `{over, reason}`, the
  Cloudflare collab DO checks it before persisting (inert while BILLING off).
- Subscription state: `billing_subscriptions` (owner_key, stripe_*, status,
  plan_id, lab_billing, cap_bytes). `setPlan`, `getSubscription`, `upsertSubscription`.
- Stripe: checkout (`api/billing/plan`) is FLAT SUBSCRIPTION mode; webhook syncs
  subscription + records LLC revenue + receipts. NO card-on-file / SetupIntent /
  off-session charge yet (Step 4 adds it).
- AI metering is the exact pattern to mirror for the cloud ledger (idempotent
  `usd_micros` + `stripe_event_id`).
- Dev seeding: `api/dev/billing-sim` (scenario / check / reset), gated on
  BILLING_SIM_SECRET. Use it to seed a paid lab for verify.

## Build sequence (Grant's order)

1. USAGE METER -> COST (this step). Pure module `lib/billing/model-a/pricing.ts`:
   the Model-A plan shapes (base fee + usage markup per tier) + `periodCharge()`
   that turns a payer's pooled period usage (writes + storage bytes + hosted bytes
   + lab count) into a marked-up accrued charge in cents, reusing the service-model
   rate primitives. Plus `ACCRUAL_CHARGE_THRESHOLD_CENTS` ($5). Fully unit-tested.
   Additive, breaks nothing.
2. PLAN SHAPES. Migrate `plans.ts` / quota+allowance resolution to Free/Solo/Lab/
   Dept with the base-fee+markup shape. Behind a `BILLING_MODEL_A` flag so the old
   flat-plan path stays intact until cutover. Update the org dashboards + builders
   to read base+usage instead of cost-recovery math (kills the last live "Cost
   recovery + Sustaining" copy).
3. ACCRUED LEDGER. New tables `cloud_balance` (owner_key/payer, accrued_cents,
   last_charged_at, stripe_payment_method_id) + `cloud_usage_ledger` (period,
   kind base|usage|storage|hosted|charge, cents, stripe_event_id idempotent),
   mirroring ai-ledger-db.ts. A monthly accrual roll-up (cron) that reads each
   closed period's pooled usage, calls `periodCharge`, and appends to the ledger.
4. STRIPE. Checkout captures a card on file (SetupIntent, store payment_method_id).
   A charge route/cron: when accrued >= threshold (or at cancel), off-session
   PaymentIntent for the accrued amount; on success append a `charge` ledger row +
   record LLC revenue, reset balance. Webhook handles payment_intent.succeeded
   idempotently. THEN flip BILLING_ENABLED + AI_BILLING_ENABLED (retires the
   free-during-beta copy site-wide, since it is all flag-gated).

## Decisions / notes

- The "5x/7x/6x markup" applies to RELAY/COMPUTE usage only. Storage + hosted are
  the flat 1.15x near-cost rate regardless of tier.
- Base fee is PER LAB for lab/dept (multiply by lab count), once for solo, zero for free.
- Lab/dept bill the POOL (PI + active members) via the existing pool reads, keyed
  to the resolved billing owner.
- Keep AI metering entirely separate (its own ledger). The cloud ledger is new.
- Everything stays flag-gated until Step 4 cutover; the old flat-plan engine is the
  fallback and is not deleted until Model-A is verified end to end.
