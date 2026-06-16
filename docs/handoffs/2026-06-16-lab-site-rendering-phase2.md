# Handoff — lab-domains Phase 2: static lab-site + page rendering (2026-06-16)

Lane: INJEST (social layer). Branch: `social/lab-site-rendering` (off origin/main).
Flag-gated behind `LAB_SITES_ENABLED` / `NEXT_PUBLIC_LAB_SITES` (Phase 1 config),
default OFF + byte-identical (route notFound()s when off). Builds on Phase 1's
slug registry (on origin/main).

## What was built

- `frontend/src/lib/social/lab-site.ts` — pure, DB-free logic: `normalizePagePath`
  (lowercase/dash grammar, traversal-safe — dot segments drop out, depth + segment
  caps) and `resolvePublicPage` (the single source-of-truth visibility decision:
  flag on + slug is kind=lab + site exists + page published => render, else a typed
  not-found reason).
- `frontend/src/lib/social/lab-site-db.ts` — thin Neon layer (mirrors directory/db
  conventions, lazy singleton, idempotent schema): tables `lab_sites`
  (lab_owner_key PK, lab_slug unique) and `lab_site_pages` ((lab_owner_key, path)
  PK, title, body_md, status draft|published, version). Lookups + upsertPage
  (edits reset to draft so they aren't silently public) + publishPage (flips
  published, bumps version). Lab referenced ONLY by lab_owner_key string.
- `frontend/src/app/[labSlug]/[[...path]]/page.tsx` — the public route. Top-level
  optional catch-all. Resolves slug via Phase 1 registry (`getSlug`), site, page,
  feeds `resolvePublicPage`; renders the page or notFound(). Fail-closed on any DB
  error (404, never a crash). generateMetadata for the title.
- `frontend/src/app/[labSlug]/[[...path]]/not-found.tsx` — calm public 404 on
  marketing chrome with "Go home" + "Researcher network" escapes (no soft-lock)
  and a citation-permanence note.
- `frontend/src/components/social/LabSitePageView.tsx` — presenter: marketing
  chrome + the existing `RenderedMarkdown` + a back-to-lab-home link.
- `frontend/src/lib/social/__tests__/lab-site.test.ts` — unit tests for
  normalizePagePath (incl traversal/depth/segment caps) + resolvePublicPage (all 7
  branches).
- `frontend/src/lib/social/__tests__/slug-registry.test.ts` — Phase 1 drift-guard
  UPDATED to ignore dynamic segments (`[slug]`) + route groups (`(group)`), since
  the new `[labSlug]` dir is not a reservable static word. One-line filter; the
  guard still catches new STATIC top-level routes.

## Routing safety

Next.js App Router prefers static segments over dynamic, so every existing
top-level route still wins; `[labSlug]` only fires for a first segment matching no
static dir. Phase 1 RESERVED_SLUGS additionally makes those static names
unclaimable as lab slugs. With the flag OFF the route notFound()s immediately, so
it is byte-identical to a missing route. Verified: only one top-level dynamic
segment exists, so no Next dynamic-segment conflict.

## Entitlement gate (decision)

Phase 2 has NO write/authoring path (public VIEW needs no gate), so it consumes no
entitlement gate. The interrupted first build left a temporary social-lane seam
(`lab-publish-gate.ts`); it was REMOVED because Billing's canonical
`isLabPublishEntitled(labOwnerKey): Promise<boolean>` is now on origin/main
(`@/lib/billing/db`, active + lab tier, server-only, fail-closed). PHASE 3's
authoring/write API imports it DIRECTLY from `@/lib/billing/db` — no social-lane
seam needed.

## Gates

- `pnpm install --frozen-lockfile --prefer-offline` — OK
- `pnpm exec tsc --noEmit` — 0 errors
- `pnpm exec vitest run src/lib/social` — 81 passed (6 files), no regressions

## Deferred to later phases (intentionally NOT in Phase 2)

- Phase 3: authoring/write API (create/edit/publish pages, gated by Billing's
  `isLabPublishEntitled`) + the live-visualizer block system + freeze-on-publish
  static-fallback snapshots.
- Phase 4: hosted-data assets (R2, separate `lab_hosted_assets` metered line,
  lapse GC + archive flag).
- Phase 5: custom domains.

## Verify

Flag on locally (NEXT_PUBLIC_LAB_SITES=1 + LAB_SITES_ENABLED=true + a seeded
lab_sites row + a published page), hit `/<labslug>` and `/<labslug>/<path>`; an
unknown slug / draft page / flag-off all 404 to the escape page.
