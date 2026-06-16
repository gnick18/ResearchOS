# Handoff — lab-domains Phase 1, unified slug registry (2026-06-16)

Lane: INJEST (social layer). This is PHASE 1 ONLY of the lab-domains /
companion-sites feature: the unified slug-registry FOUNDATION. No lab_sites,
pages, rendering, or R2 here (later phases). Branch is reviewable, NOT pushed,
NOT merged.

Branch: `social/lab-slug-registry` (off `origin/main`, in an isolated worktree).

## What the feature is
Every paying lab gets `researchos.app/<labslug>`. Slugs are unique and
first-come-first-serve across ONE global namespace shared with @handles and
institution slugs, so a lab can never claim a value that already routes somewhere
or that a person/institution already uses. On collision the picker shows
institution-aware suggestions.

## What was built (Phase 1)

### Files added
- `frontend/src/lib/social/slug-registry.ts` — PURE, DB-free, browser-safe core:
  - `normalizeSlug(input)` — lowercase, trim, strip leading `@`, map any
    non-`[a-z0-9]` run to a single dash, collapse repeated dashes, strip
    leading/trailing dashes, truncate to `SLUG_MAX_LENGTH` (30), re-strip a
    trailing dash the cut may expose. Idempotent. `SLUG_MIN_LENGTH=3`.
  - `validateSlug` / `validateReserve` / `validateRelease` — structural + kind +
    reserved-word rules (pure, run before any DB write).
  - `RESERVED_SLUGS` (ReadonlySet) — derivation below.
  - `isSlugAvailable(slug, { reserved, taken })` — pure decision; caller supplies
    the `taken` set from the DB.
  - `suggestSlugs(desired, { institutionShortName, institutionDomain, reserved,
    taken, limit })` — deterministic, institution-aware. Order: inst-short-suffix,
    inst-domain-label-suffix, `<base>2`, `<base>-lab`, `lab-<base>`, then numeric
    bumps 3..9. Filters out any suggestion that is itself reserved/taken so the
    list is always claimable. Default limit 6.
  - `SlugKind = "lab" | "handle" | "institution" | "reserved"`.
- `frontend/src/lib/social/slug-registry-db.ts` — thin Neon persistence,
  conventions mirrored from `lib/sharing/directory/db.ts` (lazy `getSql()` from
  `DATABASE_URL`, idempotent `ensureSlugRegistrySchema()`, tagged-template
  queries). The `slug` PRIMARY KEY is what enforces global uniqueness.
  - `slug_registry(slug text PK, kind text, owner_key text null, ref text null,
    created_at timestamptz default now())` + indexes on `owner_key` and `kind`.
  - `reserveSlug(slug, kind, ownerKey?, ref?)` — validate then INSERT ... ON
    CONFLICT (slug) DO NOTHING; reports `{ok:true,row}` / `{ok:false,reason:
    "taken"}` / `{ok:false,reason:"invalid",error}`. Atomic per slug.
  - `releaseSlug(slug, ownerKey)` — owner-scoped DELETE (a `reserved` row with
    NULL owner cannot be released this way).
  - `getSlug`, `isSlugTaken`, `loadTakenSlugsWithPrefix(base)` (escaped LIKE,
    feeds the pure suggester an accurate `taken` set without per-candidate
    round-trips).
  - Seeders (idempotent, READ-ONLY against source tables):
    `seedReservedSlugs(slugs)`, `seedExistingHandles()` (reads
    `account_profiles.handle` + `owner_key` directly; missing table -> 0),
    `seedInstitutionSlugs(domains)`, and `readInstitutionDomains()` (reads
    distinct `directory_profiles.affiliation_domain`; missing table -> 0).
- `frontend/src/app/api/social/lab-slug/route.ts` — flag-gated availability stub
  (the ONLY user-facing surface in Phase 1). `GET /api/social/lab-slug?slug=...
  [&inst=...][&domain=...]`. 404 unless `LAB_SITES_ENABLED === "true"`. Own path
  under `/api/social`, NOT under `/api/directory`. Read-only (no claim write).
- `frontend/src/lib/social/__tests__/slug-registry.test.ts` — 33 unit tests.

### Files modified
- `frontend/src/lib/social/config.ts` — added the LAB_SITES flags, mirroring the
  directory split (`guard.isSocialLayerEnabled` server / `NEXT_PUBLIC_SOCIAL_LAYER`
  client):
  - `isLabSitesEnabled()` — SERVER gate, read lazily at request time.
  - `LAB_SITES_ENABLED` — CLIENT gate, `NEXT_PUBLIC_LAB_SITES` inlined at build.
  Both default OFF; app is byte-identical when off.

## RESERVED_SLUGS derivation
Derived 2026-06-16 by listing every top-level directory under
`frontend/src/app` (each is a Next.js App-Router route segment, so
`researchos.app/<segment>` already resolves and must not be claimable):

    ls -1 frontend/src/app   # directories only, minus __tests__

That set is frozen in `APP_ROUTE_SEGMENTS` (62 segments incl. `methods`,
`lab*`, `dept`, `department`, `institution`, `u`, the misspelled-but-real
`buisness`, `chemistry-embed-check`, etc.). Plus `SYSTEM_RESERVED_WORDS` (auth /
ops / docs / vanity: `admin dev login signin signup logout account help docs
support status root system app www mail static assets public billing checkout
pay auth oauth callback 404 500 favicon robots sitemap`). `RESERVED_SLUGS` =
both lists, normalized through `normalizeSlug` and de-duped. Non-route files
(`error.tsx`, `layout.tsx`, `page.tsx`, `globals.css`, images,
`page-landing-redirect.ts`) are excluded.

DRIFT GUARD: a test (`RESERVED_SLUGS does not drift from the app route
directories`) reads the live `src/app` directory listing and asserts it equals
`APP_ROUTE_SEGMENTS`. If a new top-level route is added without updating the
literal, the test FAILS. When that happens: add the new segment to
`APP_ROUTE_SEGMENTS` AND seed it via `seedReservedSlugs(RESERVED_SLUGS)`.

## Contract for Popup Unifier (handle creation + institution claim)
Phase 1 backfills what already exists via the seeders. Going FORWARD, the
handle-creation and institution-claim flows must register their slug at creation
time for global uniqueness. This is a documented contract only; this branch does
NOT edit the account/identity/billing trees.

At handle creation (in/adjacent to `account-profile.upsertAccountProfile`, after
the handle passes `validateHandle` + `isHandleAvailable`), call:

    import { reserveSlug } from "@/lib/social/slug-registry-db";
    const res = await reserveSlug(handle, "handle", ownerKey, handle);
    // res.ok === false && res.reason === "taken"  -> slug already in the global
    //   namespace (another lab/institution/handle). Reject the handle claim, OR
    //   reconcile (the seeder uses ON CONFLICT DO NOTHING so a benign re-run is
    //   safe; a genuine cross-kind collision should block).
    // res.reason === "invalid" -> surface res.error.

At institution claim (when a verified domain becomes an institution slug):

    const res = await reserveSlug(domain, "institution", /*ownerKey*/ null, domain);

`ownerKey` is the billing/identity owner key (`ownerKeyForEmail`, the peppered
email hash) for `handle`; `null` for `institution`/`reserved` system rows.
`ref` is free-text traceability (the original handle / domain). Lab companion
sites will call `reserveSlug(labSlug, "lab", labOwnerKey, labId)` in a later
phase; `labOwnerKey` = `lab_owner_key` from `lib/billing/owner.ts` (NO new lab
identity is minted here).

To backfill existing rows at deploy time (run once, idempotent):

    await seedReservedSlugs(RESERVED_SLUGS);     // system route segments
    await seedExistingHandles();                 // account_profiles.handle
    await seedInstitutionSlugs(await readInstitutionDomains());

## Gate results
- `pnpm install --frozen-lockfile --prefer-offline` — OK (pnpm 10.34.3).
- `pnpm exec tsc --noEmit` — EXIT 0.
- `pnpm exec vitest run src/lib/social/__tests__/slug-registry.test.ts` —
  33 passed.
- `pnpm exec vitest run src/lib/social` — 67 passed (5 files), no regressions in
  the existing social suite.

## DB testing note (no silent stubs)
Neon `DATABASE_URL` is not reachable in this worktree and PGlite
(`@electric-sql/pglite`) is NOT a project dependency. Per the task's documented
fallback, the DB module is kept THIN (validation delegated to the pure lib;
uniqueness is a single `slug` PRIMARY KEY + `ON CONFLICT DO NOTHING`) and ALL
logic is exercised through the pure-lib unit tests: normalization, reserved-word
blocking, availability/uniqueness (via the `taken` set), institution-aware
suggestions, and `validateReserve`/`validateRelease`. The SQL surface is a direct
mirror of the audited `lib/sharing/directory/db.ts` conventions. No new dev dep
was added.

## How to verify
1. `cd frontend && pnpm install --frozen-lockfile --prefer-offline`
2. `pnpm exec tsc --noEmit`  (expect 0)
3. `pnpm exec vitest run src/lib/social/__tests__/slug-registry.test.ts`
   (expect 33 passed)
4. Flag-off check: with `LAB_SITES_ENABLED` unset, `GET /api/social/lab-slug`
   returns 404 (dark by default). Set `LAB_SITES_ENABLED=true` + a reachable
   `DATABASE_URL` to exercise the live availability/suggestion path.

## Boundary / risk notes
- HARD BOUNDARY respected: no edits to `lib/sharing/identity/*`,
  `lib/sharing/directory/*` schema, or `lib/billing/*`. Account/identity/billing
  source tables are read-only references only.
- The referenced proposal `docs/proposals/2026-06-16-lab-domains-companion-sites.md`
  was NOT present in the repo at build time. Phase 1 was built faithfully to the
  task spec and the established directory/social conventions; if the proposal
  lands later, re-check the exact `suggestSlugs` example ("jsmith-lab" cannot be
  synthesized from a slug with no person name — the generic `-lab` variants stand
  in for that slot) and the table column choices.
- Seeders read `account_profiles` and `directory_profiles` directly with thin
  read-only queries (wrapped so a missing table -> 0). They do NOT import the
  directory/account schema modules, keeping the boundary clean.
