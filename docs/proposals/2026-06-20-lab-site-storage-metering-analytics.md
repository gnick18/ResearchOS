# Lab-site storage metering + PI storage UI + page analytics, build plan

Status: Grant-directed (relayed via the testing hub 2026-06-20), pre-flag for the
two data-shape changes before the write paths ship. Owner lane: BeakerAI
(lab-site builder + network). House voice: no em-dashes, no emojis, no
mid-sentence colons.

## Why

Labs can host a native builder site + companion data sites + an uploaded BYO
site. Today storage is metered coarsely and natively-built pages are not metered
at all, and a PI cannot see what their hosting costs or which site drives it.
Grant wants per-site storage metered at the canonical near-cost rate, a PI-facing
storage view (network total + per-site, in dollars), and public page-view
analytics per site.

Pricing is already canonical, NOT re-litigated here:
- Storage (any plan) a-la-carte at 1.15x our cost (docs/branding/PRICING.md:67).
- R2 cost 0.015/GB-month -> hosted bills ~0.017/GB-month
  (`hostedAssetMonthlyCost(bytes)` + `STORAGE_MARKUP = 1.15`,
  src/lib/pricing/service-model.ts:263,274). This helper is the single source,
  every dollar figure flows through it. No new rate is introduced.

## Current model (verified)

- `lab_hosted_assets(asset_id PK, lab_owner_key, bytes, archived, updated_at)`,
  `collab/server/db.ts:225`. One row per asset. `getLabHostedBytes(ownerKey)` =
  SUM(bytes) per owner, the billed total.
- BYO site = ONE asset per lab (`byoAssetId`, `__byo_site__` sentinel,
  lab-byo.ts:61).
- Native pages (`lab_site_pages.blocks_json`/`body_md`) are NOT metered at all
  (lab-site-db.ts deliberately does not write the billing table).
- No `site` dimension exists, so a per-website breakdown is impossible today.

## Data-shape changes (PRE-FLAG, both additive + idempotent)

1. `lab_hosted_assets` gains a nullable `site_key TEXT` column (idempotent
   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Existing rows stay NULL and
   continue to bill at the lab total exactly as today (no migration, no behavior
   change until writers set it). A NULL site_key reads as the catch-all
   "Other / legacy" line in the UI.
2. New `lab_site_views` counter table (idempotent `CREATE TABLE IF NOT EXISTS`):
   `(lab_owner_key TEXT, site_key TEXT, day DATE, views BIGINT, PRIMARY KEY
   (lab_owner_key, site_key, day))`. Counts only, no PII, no IP, no UA. Increment
   is an idempotent UPSERT `+1`. Cookie-isolation safe (it stores nothing about
   the visitor).

Both follow the same additive pattern `blocks_json` already used, so the schema
is byte-compatible with current reads and the feature is inert until its writers
run behind the existing LAB_SITES flag.

## site_key definition (settable assumption)

A lab has one native site with many pages plus an optional BYO site. The billable
"site" unit is:
- `home` for the home page (path "").
- the page path for each companion page (each companion page bills as its own
  line; the UI may roll up by top-level segment later).
- `byo` for the uploaded BYO site (it is already one lump).

This is the finest-granularity choice that trivially rolls up to the lab total
and to any future grouping. If Grant wants companion "sites" grouped by a path
prefix instead of per-page, that is a UI rollup change only, the stored key stays
the page path.

## Parts + phasing (each behind the existing LAB_SITES flags)

### Part 1, per-site storage metering (data layer) [Bot 1]
- Add `site_key` column + thread an optional `siteKey` through
  `setHostedAssetBytes(assetId, labOwnerKey, bytes, siteKey?)` (ON CONFLICT keeps
  it updatable). Default behavior unchanged when omitted.
- Set `siteKey` from the existing callers: the asset register/presign routes
  (`app/api/social/lab-site/asset/*`) pass the page path the embed lives on; the
  BYO route passes `byo`.
- METER NATIVE PAGES, the real gap. On publish (where the social lane already
  bakes embeds) register the page itself as a hosted asset keyed by its page
  asset id with `bytes` = byte length of the stored page representation
  (`blocks_json` or `body_md` + `snapshots_json`) and `site_key` = the page's
  site_key. This folds native-page + baked-data-block bytes into the metered
  total, which then rides the existing `getLabHostedBytes` -> a-la-carte calc
  with zero billing-formula change.
- Add `getLabHostedBytesBySite(labOwnerKey): Array<{ siteKey, bytes }>`
  (GROUP BY site_key) next to `getLabHostedBytes`.
- Unit tests, the metering math + the per-site grouping + the NULL-legacy
  fallback. Branch only, report back (backend waits for hub verify before live).

### Part 2, PI storage UI [Bot 3, after Bot 1 + Bot 2 land]
- A "Storage and hosting" panel in the PI's lab-site dashboard, network total +
  per-site rows, each with bytes AND the dollar cost via
  `hostedAssetMonthlyCost(bytes)` (the per-site cost is that helper applied to the
  site row, the total is the helper applied to the sum, identical to billing).
- Reads `getLabHostedBytes` (total) + `getLabHostedBytesBySite` (rows) through a
  thin authed read route (owner-or-site-editor gated, same authz as the builder).
- House style, dollars shown with the real reason ("hosting passed through at
  near our cost"), per `[[feedback_copy_state_the_why]]`.

### Part 3, page-view analytics [Bot 2, parallel to Bot 1]
- `lab_site_views` table + `bumpLabSiteView(labOwnerKey, siteKey)` idempotent
  UPSERT, called server-side on each PUBLIC page render (native public lab page +
  companion page render, and the BYO serve route). No visitor data stored.
- `getLabSiteViews(labOwnerKey, sinceDays?)` -> per-site totals + a small daily
  series for a sparkline.
- A "Views" section in the same PI dashboard panel (Bot 3 wires the display).
- Increment must never block or error the public render (fire-and-forget, swallow
  failures, the public page is the priority).

## Out of scope / deferred

- Real-time analytics, unique visitors, geo, referrers (counts only for v1).
- Per-page rollup-by-prefix UI grouping (stored key supports it, UI can add it).
- Large-site streaming ingestion is the testing hub's lane
  (docs/proposals/2026-06-20-large-lab-site-ingestion.md), this plan meters
  whatever bytes are hosted regardless of how they were ingested.

Related: `[[project_lab_domains_companion_sites]]`,
`[[project_dept_institution_tier]]`, `[[feedback_keep_billing_facts_current]]`,
`[[feedback_pricing_decisions_locked]]`, `[[feedback_copy_state_the_why]]`.
