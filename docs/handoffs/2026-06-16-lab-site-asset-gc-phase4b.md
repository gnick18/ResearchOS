# Lab-site hosted-asset GC / reclaim lifecycle (lab-domains Phase 4b)

Date: 2026-06-16
Lane: INJEST (social layer)
Branch: `social/lab-site-asset-gc` (off origin/main, NOT pushed)

## What this is

Phase 4a hosts a lab's companion-site datasets on Cloudflare R2 (billed via
Billing's metered hosted-asset line). Phase 4b is the reclaim lifecycle for those
hosted bytes when a lab's subscription lapses.

## Reclaim policy (the rule)

When a lab's subscription LAPSES:

- Its published PAGES stay live read-only FOREVER. We never take a site down; the
  public reader keeps seeing the baked Phase 3b snapshots. Phase 4b touches NONE
  of the page/site rows.
- Its hosted DATA ASSETS on R2 are RECLAIMED 30 days after the lapse
  (`GRACE_DAYS = 30`).
- UNLESS the lab pre-paid to permanently ARCHIVE that specific dataset. The
  prepaid purchase flags the Billing row archived; the GC checks
  `isHostedAssetArchived(assetId)` and SKIPS those assets.

Lapse signal comes from Billing's `getLabLapse(labOwnerKey)`:

- `null` => active or never subscribed => DO NOT GC (clock not running).
- `{ lapsedAt }` => lapsed; `lapsedAt` only moves forward, and re-subscribing
  returns `null` again (clock resets). Reclaim is due strictly when
  `now > lapsedAt + 30 days` (greater-than, never early).

## Files

Pure + runner (new): `frontend/src/lib/social/lab-site-asset-gc.ts`
- `GRACE_DAYS = 30`
- `isReclaimDue(nowMs, lapsedAt, graceDays=30)` — PURE, IO-free, unit-tested
  (null keep / <30d keep / ==30d boundary keep / >30d reclaim / garbage keep /
  custom window).
- `liveAssetIdsFromManifests(hostedJsonByPath)` — PURE; parses each page's
  hosted_json via `parseHostedManifest` and returns the distinct asset ids.
- `reclaimAsset(assetId)` — archived => skip; else `deleteAsset` (R2) then
  `removeHostedAsset` (Billing); never throws (returns "reclaimed"|"archived"|
  "failed").
- `runHostedAssetGc(nowMs=Date.now())` — enumerates sites, per-lab lapse lookup,
  per-asset reclaim. Returns a deterministic `GcRunReport`. Resilient + idempotent.

Enumeration query (added): `frontend/src/lib/social/lab-site-db.ts`
- `listAllSiteHostedManifests(): LabSiteHostedManifests[]` — one row per lab site,
  carrying each page's raw `hosted_json`. Single `lab_sites LEFT JOIN
  lab_site_pages` scan, grouped by owner. Reads ONLY the social lane's own tables.

Cron route (new): `frontend/src/app/api/cron/lab-site-asset-gc/route.ts`
- `GET`, `runtime = "nodejs"`. Auth then flag then run.

Schedule registration: `frontend/vercel.json`
- Added `{ "path": "/api/cron/lab-site-asset-gc", "schedule": "0 4 * * *" }`
  (daily at 04:00 UTC, offset off the hourly cost-breaker and the 13:00
  business-reminders so the three crons do not pile up).

Tests (new):
- `frontend/src/lib/social/__tests__/lab-site-asset-gc.test.ts` (19 tests):
  grace-period check, pure enumeration, `reclaimAsset`, and the runner (active
  skipped / in-grace kept / past-grace reclaimed / archived skipped / one failing
  asset does not abort / one lab's billing-read error does not abort / empty).
- `frontend/src/lib/social/__tests__/lab-site-asset-gc-route.test.ts` (6 tests):
  404 no header / 404 wrong secret / 404 unset secret (fails closed) / flag-off
  inert no-op / authed+flag-on runs + returns report / 500 on GC throw.

## Enumeration + orphan note (KNOWN FOLLOW-UP)

The GC enumerates live assets from the social lane's OWN page manifests
(`lab_site_pages.hosted_json` parsed via `parseHostedManifest`). It deliberately
does NOT query Billing's `lab_hosted_assets` table (lane boundary).

Consequence: an asset that was REGISTERED in Billing but is no longer referenced
by any current page manifest (e.g. an author dropped the embed, or
`upsertPage`/re-publish cleared `hosted_json`) is ORPHANED. The page-driven GC
will not see it, so it is neither reclaimed nor billed-down by this job. Phase 4a
already replaces an asset in place on re-publish (same stable assetId / same R2
key), so the common re-publish case is covered, but a genuinely dropped embed can
strand a Billing row + R2 object. Reconciling those orphans (a Billing-side sweep,
which would cross the lane boundary) is a follow-up, out of scope for 4b.

## Cron auth used

Mirrors the existing `cost-breaker` and `business-reminders` crons exactly:
Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. The route requires that
secret and FAILS CLOSED with a 404 when `CRON_SECRET` is unset or mismatched, so
the endpoint is never an open trigger and its existence is not advertised.

## Flag gating

`LAB_SITES_ENABLED` (SERVER flag via `isLabSitesEnabled()`, read lazily), default
OFF. With the flag off the cron, after passing auth, returns a benign
`{ ok: true, skipped: "lab sites disabled" }` no-op and does NOT run the GC. The
rest of the app is byte-identical (no new user-facing surface; this is a backend
scheduled job only).

## Boundary notes (HARD boundary honored)

- READ-ONLY use of `@/lib/billing/db` (`getLabLapse`) and `@/lib/collab/server/db`
  (`isHostedAssetArchived`, `removeHostedAsset`) — only the published primitives
  are called; no schema or business-logic change.
- R2 deletes go through the social lane's OWN asset store
  (`lab-site-asset-store.deleteAsset`), not the sharing lane's R2 client.
- NOT touched: `lib/sharing/identity`, `lib/sharing/directory` schema,
  `lib/billing` internals, Billing's `lab_hosted_assets` table (read via the
  primitive only, never queried directly).
- Lab is referenced ONLY by `lab_owner_key`.

## Out of scope (NOT this phase)

- The Stripe permanent-archive CHARGE (billing-live).
- Custom domains (Phase 5).
- Billing-side orphan reconciliation (the follow-up above).

## Gates

- `pnpm install --frozen-lockfile --prefer-offline` — clean.
- `pnpm exec tsc --noEmit` — 0 errors.
- New tests: 25 passed (19 GC + 6 route).
- Full social suite: 167 passed (14 files), no regressions.

## Status

Committed on `social/lab-site-asset-gc`. NOT pushed, NOT merged. Reviewable.
