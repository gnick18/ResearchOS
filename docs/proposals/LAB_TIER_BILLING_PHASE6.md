# Lab Tier Phase 6: billing, reconciled with the pivot

Status: DRAFT for sign-off (SHARING + COLLAB manager, 2026-06-08). Teed up at Grant's request. This is a RECONCILIATION doc, not a from-scratch billing design. Most of the billing machinery already exists; Phase 6 maps it onto the solo-free / lab-paid pivot, wires the new lab data plane into metering, and decides when to flip the switch.

Do NOT contradict these existing docs (this one defers to them on the cost math): `PRICING_COST_MODEL.md` (the cost-recovery formula + real infra fees), `METERED_STORAGE_PRICING.md`, `paid-storage-sustainability.md`, `COLLAB_STORAGE_D1_DO_MIGRATION.md`. Code home: `frontend/src/lib/billing/` + `docs/proposals/metered-storage-billing-wiring.md`.

## The key reframe: billing is ~80% already built

`lib/billing/` already implements, gated off in beta (`isBillingEnabled()` false until launch):
- A PLAN CATALOG (`plans.ts`): individual plans (free 1GB, plus 50GB ~$8, pro 250GB ~$32) and LAB plans POOLED across members (lab_free 1GB/member, lab_plus 100GB ~$15, lab_pro 500GB ~$45). Each plan is a FLAT price with a storage cap + a write-op allowance (a throttle ceiling, NOT a metered charge). Stripe price envs per plan, the same catalog in test and live.
- LAB SPONSORSHIP (`lab.ts`): `inviteMember` / `acceptInvite` / `removeMember` / `listLabMembers` / `getSponsoringLab`. The lab head sponsors members, so a member's quota resolves to the lab's plan and the head pays. Members never see a paywall. This is exactly the per-buyer-pays-for-seats norm.
- The COST CIRCUIT BREAKER (`breaker.ts`): a budget ceiling; over budget trips the breaker and `isCloudPaused()` pauses cloud writes while local-first keeps working. `estimateGlobalMonthlyCostCents` tracks the real spend.
- PAYER RESOLUTION (`owner.ts`): `ownerKeyForEmail` is the peppered-email billing/quota owner key.
- The COST-RECOVERY PHILOSOPHY (`PRICING_COST_MODEL.md`): charge close to the fees passed to us (infra + Stripe + tax), never profit; the free local-first core stays free, funded by the RISE fellowship + donations; only optional cloud storage + activity is priced. Prices are PROVISIONAL placeholders pending real tracking data.

So the lab-head-pays-pooled-for-the-lab model the pivot wants ALREADY EXISTS. Phase 6 is mostly reconciliation + three wiring gaps, not new billing.

## What the pivot changes

The pivot: SOLO accounts are 100% local, free, offline, no login. LAB accounts are paid, cloud-backed (the server-blind R2 data plane we built in Phase 3), OAuth-gated. This sharpens the billing boundary:

- SOLO = free, forever, no cloud, nothing to bill. A purely local solo user never touches metered infra.
- LAB = the paid product. The lab data plane (R2 lab-data store + relay DOs) is the cloud cost, and the lab plan recovers it. The lab head is the payer (already modeled via sponsorship).

This raises one genuinely open question: under a strict pivot, SOLO has no cloud, so what is the purpose of the INDIVIDUAL paid plans (plus 50GB, pro 250GB)? They priced individual cloud storage under the old model. Two coherent options (decision 1 below): keep them as opt-in cloud BACKUP for solo users who want it, or drop them so the only paid product is the lab tier.

## The three wiring gaps Phase 6 must close

1. METER THE NEW LAB-DATA R2 STORE. The Phase 3 chunk-1 store writes lab-key-encrypted blobs to R2 (bucket `researchos-lab-data`), keyed `${labId}/${owner}/${recordType}/${recordId}`. Today the metering config counts collab DO bytes + R2 file bytes; it does NOT yet count the lab-data store bytes. Phase 6 attributes lab-data R2 usage to the lab's payer so it counts against the lab plan's storage cap and the global cost estimate.
2. GATE THE LAB DATA PLANE ON A PLAN. The lab sync trigger (`runLabSyncForSession`) and the lab-data `put` should be allowed only when the lab is on an active plan and not over budget. Reuse the existing breaker/throttle: over the lab plan's allowance, sync degrades (throttle), never a surprise charge; over the global budget, `isCloudPaused()` pauses cloud writes and the lab tier falls back to read-only / local while solo users are unaffected.
3. FLIP THE SWITCH AT LAUNCH. `isBillingEnabled()` is off in beta. Phase 6 defines the go-live checklist: real Stripe lab prices set in the env (the live `STRIPE_PRICE_LAB_*`), the CPA tax-category check closed (open item from the Stripe setup), the cost tracker showing real numbers to validate the provisional prices, and a clear in-app explanation of what is paid vs free.

Everything else (catalog, sponsorship, breaker, payer, Stripe wiring, the admin business tracker) is already in place and just needs these three closures plus the decisions below.

## Where Phase 6 sits in the build order

Phase 6 is downstream of the lab tier being usable: the lab data plane (done) and the lab session (Phase 5, browser slices) must exist before a lab can be billed for using them. So Phase 6 LANDS after Phase 5, and gating (gap 2) hooks the same trigger Phase 5 mounts. The metering wiring (gap 1) can be built earlier since it only reads R2 usage. Beta stays free for everyone (`isBillingEnabled()` off) until the go-live checklist is met.

## Open decisions for Grant

1. SOLO CLOUD. Under the pivot, do individual paid plans (plus/pro) survive as opt-in cloud BACKUP for solo users (solo stays free-local by default, can pay to add cloud), OR do we drop them so the lab tier is the only paid product and solo is strictly free-local? Recommendation: KEEP them as opt-in cloud backup. It is a low-effort upsell (the machinery exists), it serves solo users who do want a cloud copy, and it does not compromise the free-local default. But it does slightly soften the clean "solo = local only" story, so it is your call.
2. PER-SEAT vs POOLED. The existing lab plans are POOLED (one flat price + a pooled allowance across members), not per-seat. The deep research showed per-seat is the SaaS norm, but pooled-flat is simpler, already built, and friendlier to a PI who does not want a per-head meter. Recommendation: KEEP pooled-flat for launch; revisit per-seat only if real labs outgrow the pools. Confirm.
3. PAYWALL MOMENT. When does a lab need a paid plan? Options: at lab creation, at the Nth member, or at a storage/activity threshold (lab_free covers small labs, upgrade on overage). Recommendation: lab_free covers a small lab, the paywall hits on crossing the free allowance (storage or activity), surfaced as a soft throttle + an upgrade prompt, never a hard cutoff that loses data. Confirm.
4. PRICES. The catalog prices are provisional placeholders. Recommendation: do NOT finalize prices until the cost tracker has real tracking data (per the cost-recovery formula in PRICING_COST_MODEL.md); launch with the provisional numbers clearly marked and adjust. Confirm we hold price finalization on data.
5. TAX. The CPA tax-category check (whether WI DOR rules the subscription taxable) is still open from the Stripe setup. Confirm this gates go-live (gap 3) and is on someone's plate.
