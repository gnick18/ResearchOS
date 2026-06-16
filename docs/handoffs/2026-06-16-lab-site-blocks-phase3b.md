# Lab companion-site BLOCKS, Phase 3b (social lane)

Date: 2026-06-16
Branch: `social/lab-site-blocks` (off origin/main, NOT pushed)
Flag: `LAB_SITES_ENABLED` (server) / `NEXT_PUBLIC_LAB_SITES` (client), default OFF.

## What this phase adds

Companion-site pages can now carry figure + static-table BLOCKS, baked to frozen
snapshots on publish and rendered to a no-account public reader.

The locked architecture: a PUBLIC companion-site reader has no account and no
local workspace, so a LIVE block embed (which reads the author's local data) can
never render for them. Publishing therefore BAKES each embed into a frozen
snapshot, and the public page renders the baked snapshots, NOT live embeds.
Baking is the citation-safety mechanism. Scope is figures + static tables (every
kind `bakeAllEmbeds` handles). Live-data viewers / R2 hosting / `PublicDatasetEmbed`
are Phase 4 and are NOT built here.

## The four moving parts

1. AUTHOR EDITOR (`LabSiteDashboard.tsx`): the existing "/" `ReferencePicker` is
   wired into the page-body editor via an "Insert figure or table" button. A
   picked reference is inserted at the textarea cursor; a block embed is padded
   with blank lines so it lands as its own paragraph (the lone-paragraph rule the
   renderer needs). The picker is REUSED read-only, no changes to it.

2. BAKE-ON-PUBLISH (client-side): on "Save and publish", `bakeAllEmbeds([body])`
   runs IN THE BROWSER (the author's local data + a real canvas), producing a
   `BakedEmbed` per embed. `svgToPngDataUrl` needs a browser canvas, so this can
   NEVER run in an API route. The frozen bundle is sent with the publish PUT.
   Baking is best-effort: a bake failure still publishes the text, and unbaked
   embeds show the calm unavailable card.

3. STORE: the publish API validates + stores the bundle with the page version.

4. PUBLIC RENDER: the public route parses the stored bundle and renders each
   embed to its frozen `BakedEmbedView`, never a live `ObjectEmbed`. A no-account
   reader sees the figures/tables. An embed with no snapshot renders a calm
   "content unavailable" card (no crash, no soft-lock).

## Snapshot persistence choice

Chosen: a new nullable `snapshots_json text` COLUMN on the existing
`lab_site_pages` table (added idempotently via `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` inside `ensureLabSiteSchema`), holding a JSON-serialized
`SnapshotBundle` (`{ version: 1, snapshots: Record<href, BakedEmbed> }`).

Why a column on the page row (not a separate snapshots table or a server-side pin
sidecar):
- The snapshots are 1:1 with a published page version and are read on the SAME
  read as the page body, so a column means the public render needs no extra
  query or join (it already fetches the page row).
- Publish is a single atomic `UPDATE` that flips status, bumps version, AND writes
  the column, so a re-publish can never leave a stale bundle behind a newer body.
- A `lab_site_pages` PK is `(lab_owner_key, path)`, so the bundle is naturally
  keyed to the page already; a side table would duplicate that key for no benefit
  at this scale (a handful of pages per lab).
- The on-the-wire shape mirrors the pin sidecar (`EmbedPinsFile`) deliberately,
  same `BakedEmbed` values, so there is one frozen-embed format across PDF export,
  pins, and lab sites.

Lifecycle / staleness safety:
- A DRAFT edit (`upsertPage`) now sets `snapshots_json = NULL`. The body may have
  changed, so the previous bake is stale; the next publish re-bakes. Until then
  any block on the (re-published-without-rebake, impossible by construction) page
  would show the unavailable card rather than a wrong frozen figure.
- The byte cap (`MAX_SNAPSHOT_BUNDLE_BYTES`, ~8 MB) and entry cap
  (`MAX_SNAPSHOTS_PER_PAGE`, 200) bound the stored blob; over-cap stores NULL and
  the public page shows the unavailable card, never a crash.

## Files

New:
- `frontend/src/lib/social/lab-site-snapshots.ts` — pure shape + defensive
  validation (`parseSnapshotBundle`, `isBakedEmbed`), `serializeSnapshotBundle`,
  `bundleFromBakedMap`, `resolveSnapshot`. The ONE place the untrusted
  `BakedEmbed` shape is sanitized (request body AND DB column go through it).
- `frontend/src/lib/social/__tests__/lab-site-snapshots.test.ts` — pure tests.
- `frontend/src/lib/social/__tests__/lab-site-page-route.test.ts` — PUT publish
  route: stores the validated/serialized bundle, drops malformed entries, NULL on
  empty/absent, flag-off inert, authz matrix, 404 on missing draft.
- `frontend/src/components/RenderedMarkdown.baked-embeds.test.tsx` — public baked
  render: image frozen as `<img>`, table as `<table>`, missing-snapshot fallback,
  plain prose no-crash.

Changed:
- `frontend/src/lib/social/lab-site-db.ts` — `snapshots_json` column (idempotent
  add), `LabSitePageRow.snapshotsJson`, `RawPageRow` type, `getPage` selects it,
  `upsertPage` nulls it on draft edit, `publishPage(owner, path, snapshotsJson?)`
  stores it. `listPages` intentionally omits the column (dashboard does not need
  the bodies; `snapshotsJson` is null on listed rows).
- `frontend/src/lib/social/lab-site-authoring.ts` — `PublishPageBody.snapshots?:
  unknown` passthrough; `parsePublishPageBody` carries it (validated downstream).
- `frontend/src/app/api/social/lab-site/page/route.ts` — PUT validates snapshots
  via `parseSnapshotBundle`, serializes, stores; same fail-closed authz.
- `frontend/src/app/[labSlug]/[[...path]]/page.tsx` — parses `page.snapshotsJson`
  and passes `snapshots` to `LabSitePageView`.
- `frontend/src/components/social/LabSitePageView.tsx` — accepts `snapshots`
  record, rebuilds the `Map`, passes `bakedEmbeds` to `RenderedMarkdown`.
- `frontend/src/components/social/LabSiteDashboard.tsx` — `ReferencePicker` wiring
  + insert-at-cursor + client-side bake-on-publish.

## Shared-component extension (strictly additive, non-breaking)

`frontend/src/components/RenderedMarkdown.tsx` gained ONE optional prop,
`bakedEmbeds?: Map<string, BakedEmbed>`. When present, a lone object-embed
paragraph renders its frozen `BakedEmbedView` (by exact link href) instead of the
live `ObjectEmbed`; a missing href renders the `BakedEmbedView` "missing" card.
When ABSENT (every other caller), the live `ObjectEmbed` / pin path is byte-for-
byte unchanged. `loneEmbedFromParagraph` now also returns the raw `href` (needed
as the map key); the external-embed branch is untouched. All 36 existing
`RenderedMarkdown` tests still pass.

## Gate results

- `pnpm install --frozen-lockfile --prefer-offline` — clean.
- `pnpm exec tsc --noEmit` — 0 errors.
- `pnpm exec vitest run src/lib/social` — 10 files, 119 tests, all pass (incl. 23
  new across snapshots + page-route).
- `pnpm exec vitest run src/components/RenderedMarkdown.baked-embeds.test.tsx` — 4
  pass.
- `pnpm exec vitest run src/components/RenderedMarkdown` — 7 files, 36 pass (no
  regression on the shared component).

## Flag-off inertness

`NEXT_PUBLIC_LAB_SITES` off => the dashboard surface is dark (route-gated by Phase
1/3a). `LAB_SITES_ENABLED` off => the public route 404s BEFORE any snapshot
parsing (decision unchanged) and the page API 404s before any store touch (PUT
test asserts `publishPage` is not called when the flag is off). No behavior
change to any non-lab-site caller; the new `RenderedMarkdown` prop defaults to
the existing live path.

## Boundary notes

Did NOT touch `lib/sharing/identity`, `lib/sharing/directory` schema, or
`lib/billing`. Reused `bake-embeds.ts`, `embed-pins.ts` shape, `BakedEmbedView`,
`ReferencePicker`, `references.ts` read-only. Only shared extension is the
additive `RenderedMarkdown` prop above.

## Deferred to Phase 4 (NOT built)

Live-interactive data viewers (R2-hosted), `PublicDatasetEmbed`, big-table
`dataset` embeds (these bake to `missing` today, by design). Custom domains are
Phase 5. A per-embed "frozen on <publish date>" badge on the public page was not
added (the snapshots carry no pin-style badge here); can be layered later from
the page `updatedAt`/`version` if desired.
