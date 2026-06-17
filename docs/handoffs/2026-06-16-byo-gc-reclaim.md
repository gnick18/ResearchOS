# BYO static-site lapse-reclaim (Phase 4b GC follow-up)

Date: 2026-06-16
Lane: INJEST (social layer) / lab-domains
Branch: `social/byo-gc-reclaim` (off origin/main, NOT pushed)

## What this is

The lab-domains Phase 4b daily cron GC (`runHostedAssetGc`) reclaimed only NATIVE
hosted DATASET assets (the Parquet bytes referenced by a lab's page manifests) when
a lab's subscription lapsed past the 30-day grace window. The BYO slice then added
lab-uploaded static SITES (`lab_byo_sites`, metered as ONE billing asset per lab via
`byoAssetId`), but the GC did not reclaim them. This change folds BYO-site reclaim
into the SAME daily run, under the SAME lapse policy.

## The BYO reclaim path

For each lab that has a BYO site, past its 30-day post-lapse grace window:

1. Enumerate every lab with a BYO site: new `listAllByoSites()` in
   `lib/social/lab-byo-db.ts` (mirrors `listAllSiteHostedManifests()` style: one
   bounded scan of `lab_byo_sites`, metadata only, ordered by owner key).
2. `getLabLapse(labOwnerKey)` (billing, read-only). `null` -> skip (active / never
   subscribed). A billing-read throw for one lab is caught -> skip that lab this
   pass (the run continues; next run retries).
3. If `isReclaimDue(now, lapsedAt)` (the existing pure 30-day check, strictly
   greater-than the deadline):
   - `isHostedAssetArchived(byoAssetId(labOwnerKey))` (collab db, read-only) true
     -> SKIP (prepaid permanent archive), nothing deleted.
   - else `reclaimByoSite(labOwnerKey)`:
     1. `deleteByoSite(byoLabFragment(labOwnerKey))` — delete ALL R2 objects under
        the lab's `byo-sites/<fragment>/` prefix (already existed in
        `lab-site-asset-store.ts`, list+delete in pages of 1000).
     2. `removeHostedAsset(byoAssetId(labOwnerKey))` — de-register the single BYO
        billing asset (collab db, read-only use of a published primitive).
     3. `deleteByoSiteRow(labOwnerKey)` — clear the `lab_byo_sites` row so the
        serve route 404s (already existed in `lab-byo-db.ts`).

Order is bytes -> billing -> DB row. A thrown R2 delete is caught and reported
`failed`; billing + DB rows are left for the next idempotent run to retry, so we
never de-register / 404 a site whose bytes we failed to delete.

## Resilience / idempotence

- One lab's billing-read error never aborts the run (try/catch -> skip).
- `reclaimByoSite` never throws (any error -> outcome `failed`), so one bad BYO
  site never aborts the pass.
- Re-running is safe: missing R2 keys are a no-op, removing an already-removed
  billing row is a harmless no-op DELETE, clearing an absent DB row is a no-op.

## Report

`GcRunReport` gained four BYO counts (`byoScanned`, `byoReclaimed`, `byoArchived`,
`byoFailed`) alongside the existing native `assets*` counts. The cron route
(`app/api/cron/lab-site-asset-gc/route.ts`) is UNCHANGED: it still calls
`runHostedAssetGc()` and spreads `...report`, so the BYO counts flow through
automatically. `runByoAssetGc(nowMs, report)` is a sibling the runner calls; it is
exported for testability but the cron does not call it directly.

## Boundary

- READ-ONLY use of `@/lib/billing/db` (`getLabLapse`) and `@/lib/collab/server/db`
  (`isHostedAssetArchived`, `removeHostedAsset`) — published primitives only, no
  schema / business-logic changes.
- R2 via the social lane's OWN client (`lab-site-asset-store.ts`); does NOT import
  `sharing/relay/storage.ts`.
- Did NOT touch `lib/sharing/identity`, `lib/sharing/directory` schema, or
  `lib/billing`. A lab is referenced only by `lab_owner_key`.
- Flag-gated: the cron already gates on `LAB_SITES_ENABLED`; BYO reclaim runs in
  the same job, so it is dark with the flag off (default OFF).

## Files changed

- `frontend/src/lib/social/lab-byo-db.ts` — added `listAllByoSites()`.
- `frontend/src/lib/social/lab-site-asset-gc.ts` — added `reclaimByoSite()` +
  `runByoAssetGc()`, folded into `runHostedAssetGc()`; extended `GcRunReport`;
  updated module doc.
- `frontend/src/lib/social/__tests__/lab-site-asset-gc.test.ts` — BYO mocks +
  `reclaimByoSite` block + `runHostedAssetGc BYO reclaim` block.

(`deleteByoSite` in `lab-site-asset-store.ts` and `deleteByoSiteRow` in
`lab-byo-db.ts` already existed from the BYO slice; no new R2/db delete primitive
was needed.)

## Gates

- `pnpm install --frozen-lockfile --prefer-offline` — ok.
- `pnpm exec tsc --noEmit` — 0 errors.
- GC + route tests: 37 passed. Full social suite: 202 passed (16 files), no
  regressions.

New BYO coverage: active BYO kept; in-grace BYO kept; lapsed-past-grace BYO
reclaimed (deleteByoSite + removeHostedAsset called with the right id + row
cleared); archived BYO skipped; one failing BYO delete does not abort the run;
one lab's billing-read error does not abort the BYO pass; native + BYO coexist in
one run; empty BYO enumeration idempotent; `reclaimByoSite` unit tests.

## NOT done (out of scope)

- Not pushed / not merged (clean reviewable branch only).
- No browser surface (backend cron); no preview verification applicable.
