# Handoff — lab-domains Phase 3a: authoring / write path (2026-06-16)

Lane: INJEST (social layer). Branch: `social/lab-site-authoring` (off origin/main).
Flag-gated behind `LAB_SITES_ENABLED` / `NEXT_PUBLIC_LAB_SITES`, default OFF +
byte-identical. Builds on Phase 1 (slug registry) + Phase 2 (lab_sites /
lab_site_pages + public rendering), both on origin/main. Consumes Billing's
`isLabPublishEntitled` (now on origin/main).

This finishes a sub-agent run that was interrupted by a rate-limit before tests /
handoff / commit; the master session verified the code, added tests, ran gates,
and committed.

## What was built (markdown authoring only; blocks are Phase 3b)

- `frontend/src/lib/social/lab-site-authoring.ts` — PURE authz + body validation:
  `authorizeWrite` (the single allow/deny decision) + `parseCreateSiteBody` /
  `parseUpsertPageBody` / `parsePublishPageBody` (typed, length-capped).
- `frontend/src/lib/social/lab-site-session.ts` — the ONE place a session becomes
  the caller's billing owner key: `resolveCallerOwnerKey()` reads the email from
  the proven Auth.js session (never the body) and hashes via `ownerKeyForEmailSafe`
  (read-only billing helper). ORCID-only / no-email sessions resolve to null.
- `frontend/src/app/api/social/lab-site/route.ts` — GET (dashboard load: caller's
  site + pages) + POST (claim slug + create site). Atomic slug claim:
  normalizeSlug -> validateSlug -> isSlugAvailable -> reserveSlug("lab") ->
  createSite; a taken slug returns 409 with `suggestSlugs` alternatives; one site
  per lab (idempotent).
- `frontend/src/app/api/social/lab-site/page/route.ts` — POST (upsert draft) + PUT
  (publish), via a shared `authorizePageWrite` gate; writes ONLY to the caller's
  own site (resolved by owner key), so cross-lab writes are structurally
  impossible. No site yet -> 409 "no site".
- `frontend/src/components/social/LabSiteDashboard.tsx` + `app/account/lab-site/
  page.tsx` — minimal flag-gated author UI: claim slug (with availability +
  suggestions), list pages, edit title + markdown, save draft, publish. Graceful
  not-signed-in / not-entitled state (no soft-lock). Page `notFound()`s when the
  flag is off.
- `frontend/src/lib/social/guard.ts` — a tiny self-contained `json()` response
  helper (so the social lane does not reach into the directory lane).

## Authz model (fail-closed, every write)

1. flag `isLabSitesEnabled()` true, else 404 (route inert when off).
2. signed in: owner key from the SESSION, never the body. None -> 401.
3. owns the lab: targetOwnerKey === callerOwnerKey. Checked BEFORE entitlement so a
   wrong-lab caller is 403 without leaking another lab's billing state.
4. entitled: `await isLabPublishEntitled(callerOwnerKey)` true, else 403.

All store errors fail closed to 503 (never a crash). GET (reading own drafts)
requires the same authz as a write.

## Gates

- `pnpm install --frozen-lockfile --prefer-offline` — OK
- `pnpm exec tsc --noEmit` — 0 errors
- `pnpm exec vitest run src/lib/social` — 96 passed (8 files): exhaustive
  `authorizeWrite` (allow + all 3 deny reasons + owner-before-entitlement no-leak),
  all 3 body parsers, and a route-gating matrix (flag-off 404 / not-signed-in 401 /
  not-entitled 403 / entitled 200 / store-error 503). No regressions.

## Boundary

Zero edits to lib/sharing/identity, lib/sharing/directory schema, lib/billing, or
lib/sharing/auth. Reads only: `isLabPublishEntitled` + `ownerKeyForEmailSafe`
(billing) and `auth` (sharing/auth). Lab referenced only by lab_owner_key.

## Deferred to later phases

- Phase 3b: the live-visualizer block system (Data Hub table / Phylo / plot / figure
  blocks) + freeze-on-publish static-fallback snapshots (replaces plain body_md
  with a block model + a rendered snapshot).
- Phase 4: hosted-data assets (R2, separate `lab_hosted_assets` metered line, lapse
  GC + archive flag).
- Phase 5: custom domains.

## Verify

Flag on locally (NEXT_PUBLIC_LAB_SITES=1 + LAB_SITES_ENABLED=true), sign in as a
lab with an active sub: /account/lab-site -> claim a slug -> add + publish a
markdown page -> view it at /<slug>/<path>. Not entitled / not signed in / flag off
all degrade cleanly (403 / 401 / 404).
