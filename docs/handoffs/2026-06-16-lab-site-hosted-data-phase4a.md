# Handoff — lab-domains Phase 4a: hosted-data live viewer (2026-06-16)

Lane: INJEST (social layer). Branch: `social/lab-site-hosted-data`. Flag-gated
`LAB_SITES_ENABLED` / `NEXT_PUBLIC_LAB_SITES`, default OFF + byte-identical.
Builds on Phases 1-3b; consumes Billing's Phase 4 primitives (on origin).
(Salvaged from a rate-limited sub-agent run: code was built but uncommitted +
untested; the master verified it, added tests, ran gates, committed.)

## What it does
Upgrades a public companion-site Data Hub dataset block from a STATIC baked table
(Phase 3b) to a LIVE interactive viewer: the author's browser exports the dataset
to Parquet and uploads it to R2; the public page renders it client-side via
DuckDB-WASM with no auth. Live is an UPGRADE over the baked snapshot, never a
replacement, so the fallback chain (live -> baked -> unavailable) stays intact.

## Files
- `lib/social/lab-site-hosted.ts` — PURE core: stable `hostedAssetId(lab,path,href)`
  (deterministic, folds owner key, FNV-1a), `hostedAssetKey`, `isValidAssetId`
  (regex guard so a caller can't probe arbitrary R2 keys), manifest
  parse/serialize/build (defensive, capped), and `resolveDatasetEmbed`
  (live>baked>unavailable cascade — the one render decision).
- `lib/social/lab-site-asset-store.ts` — the social lane's OWN R2 S3 client (same
  pattern as institution-registry.ts; does NOT import sharing/relay/storage.ts):
  `presignAssetPut` (5-min TTL, content-type pinned), `readAssetBytes` (server
  streams), `deleteAsset`. Degrades to null when R2 env absent.
- `app/api/social/lab-site/asset/presign/route.ts` — mints a gated presigned PUT.
- `app/api/social/lab-site/asset/register/route.ts` — registers bytes via
  `setHostedAssetBytes` (Billing) after upload.
- `app/api/social/lab-site/asset/read/route.ts` — PUBLIC (no auth) flag-gated
  same-origin read that streams the Parquet from R2 (404 -> baked fallback).
- `components/social/PublicDatasetEmbed.tsx` — the public DuckDB-WASM viewer.
- Modified: `RenderedMarkdown.tsx` (renders PublicDatasetEmbed for a hosted
  dataset embed), `app/[labSlug]/[[...path]]/page.tsx` + `LabSitePageView.tsx`
  (parse the hosted manifest, pass it down), `lab-site-db.ts` (store the manifest
  with the published page), `lab-site-authoring.ts`, the page publish route.
- Tests: `lab-site-hosted.test.ts` (pure logic incl assetId determinism, the
  isValidAssetId probe guard, manifest validation, resolution cascade) +
  `lab-site-asset-presign.test.ts` (gating matrix).

## Authz (every write, fail-closed; identical to Phase 3a)
presign + register: flag 404 -> session owner key never from body 401 -> owns-lab
(assetId folds in the owner key, so target === caller) 403 -> isLabPublishEntitled
403 -> no-site 409 -> R2-unconfigured 503. read is PUBLIC (public readers need it)
but flag-gated + only streams a valid assetId; published datasets are public by
design.

## Why no CSP change was needed
The public reader fetches the Parquet from a SAME-ORIGIN endpoint
(`/api/social/lab-site/asset/read`) that streams from R2 server-side — the browser
never hits the R2 origin directly, so connect-src needs no R2 entry. DuckDB-WASM is
already configured for the existing Data Hub lane.

## Gates
- pnpm install OK; tsc 0; vitest src/lib/social 142 passed (12 files), incl the new
  hosted + presign tests. No regressions.

## Boundary
Own R2 client (social lane). READ-ONLY use of `setHostedAssetBytes` +
`isLabPublishEntitled`. No edits to lib/sharing/identity, lib/sharing/directory
schema, lib/billing, or sharing/relay/storage.ts. Lab = lab_owner_key.

## Deferred to Phase 4b (NOT built)
- GC / reclaim lifecycle: `getLabLapse` -> 30-day -> `removeHostedAsset` + R2
  delete, SKIP if `isHostedAssetArchived`. (A scheduled job / cron.)
- The actual Stripe one-time CHARGE for the prepaid permanent-archive SKU (wires to
  `setHostedAssetArchived` at billing-live).
- Phase 5: custom domains.

## Live verification (needs real R2 + a browser — like the ROR registry)
R2/DuckDB can't be exercised without creds + browser, so this lands built +
unit-tested + flag-off. To verify live: set the flag + R2_* in a deploy, publish a
page with a Data Hub dataset block as an entitled lab, then load `/<slug>/<path>`
and confirm the dataset renders as a live interactive table (and that deleting the
R2 object falls back to the baked snapshot).
