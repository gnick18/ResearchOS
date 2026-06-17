# Handoff — lab BYO static-site hosting, Slice 1 (upload + serve) (2026-06-16)

Lane: INJEST (social layer). Branch: `social/lab-byo-upload`. Flag-gated behind
`LAB_SITES_ENABLED` AND a new `LAB_BYO_SITES` sub-flag, default OFF + byte-identical.
(Salvaged from a rate-limited sub-agent run: code built but uncommitted/untested;
master verified, added tests, fixed one tsc bug, ran gates, committed.)

## What it does
A paid lab uploads its OWN static website (a zip of raw HTML/CSS/JS, e.g. a paper's
companion site). We unzip + host the files on R2 and serve them at
`<labSlug>.research-os.com` — the assets domain (R2-backed, NO auth/cookies, a
DIFFERENT registrable domain from the app's `research-os.app`), so the untrusted lab
JS is automatically cookie-isolated from the authed app.

## Files
- `lib/social/lab-byo.ts` — PURE security/routing core: `sanitizeZipEntryPath`
  (zip-slip defense), `contentTypeForPath` (unknown -> octet-stream so nothing
  unexpected runs as HTML/JS), `resolveByoServePath` (index.html default + traversal
  reject), `labSlugFromHost` (parse `<slug>.research-os.com`, single-label, slug
  charset only), `validateByoEntries` (caps + hard-fail-whole-upload on a bad entry +
  require root index.html + skip __MACOSX/.DS_Store), manifest parse/serialize.
- `lib/social/lab-byo-db.ts` — the BYO site store (one site per lab, manifest).
- `lib/social/lab-site-asset-store.ts` (edited) — BYO multi-file R2 put/read.
- `app/api/social/lab-site/byo/route.ts` — gated upload (zip -> validate -> R2 ->
  manifest -> setHostedAssetBytes). Authz IDENTICAL to Phase 3a (flag 404 / signed-in
  401 / owns-lab+entitled 403 / no-site 409 / R2 503).
- `app/api/social/lab-site/byo/serve/route.ts` — PUBLIC serve. Lab from Host
  subdomain (prod) or `?slug=` (test). Double guard: resolved path is zip-slip
  sanitized AND must be in the lab's manifest. Headers: nosniff, X-Frame-Options
  DENY, NO Set-Cookie, no app shell. 404 on any miss.
- `lib/social/config.ts` (edited) — `isLabByoSitesEnabled()` / `LAB_BYO_SITES_ENABLED`.
- `components/social/LabSiteDashboard.tsx` (edited) — minimal "upload a site (zip)" control.
- Tests: `lab-byo.test.ts` (security core) + `lab-byo-serve-route.test.ts` (serve
  gating + manifest probe-guard + host parsing).
- `docs/proposals/2026-06-16-lab-byo-sites-and-custom-domains.md` (edited) — corrected
  the sandbox-origin section to the LOCKED research-os.com decision (was the stale
  "buy research-os.site").

## Security measures
- Zip-slip: every entry + every serve request path goes through
  `sanitizeZipEntryPath` (rejects `..`, leading `/`, backslash variants, drive
  letters, NUL); a bad entry hard-fails the WHOLE upload (never partial store).
- Isolation: served only from research-os.com (separate registrable domain) — never
  research-os.app; the serve response sets NO app cookies + nosniff + DENY framing.
- Probe guard: a served file must be present in the lab's stored manifest, so a
  crafted `?path=` can't read arbitrary R2 objects.
- Caps: 50 MB total, 2000 files, path length; octet-stream default content-type.

## Gates
- pnpm install OK; tsc 0 (fixed one bug: `total += entry.bytes` -> `.byteLength`);
  vitest src/lib/social 190 passed (16 files), incl the new BYO tests. No regressions.

## Boundary
Own social-lane R2 client (extended lab-site-asset-store). READ-ONLY use of
`isLabPublishEntitled` + `setHostedAssetBytes`. No edits to lib/sharing/identity,
lib/sharing/directory schema, lib/billing, or sharing/relay/storage.ts. Lab =
lab_owner_key.

## GO-LIVE infra (Grant) — required for live serving
1. A wildcard `*.research-os.com` (or per-lab) DNS + Vercel domain config pointing
   the BYO subdomains at this Vercel project, so `<slug>.research-os.com` reaches the
   serve route. (Until then, the `?slug=` fallback serves for testing.)
2. R2_* creds in the deploy (same as Phase 4a).
3. Confirm no wildcard `*.research-os.com -> research-os.app` redirect catches the
   lab subdomains (apex/www redirect is fine; assets.research-os.com already serves).
4. Keep the INVARIANT: never serve the authed app / set app cookies on research-os.com.

## Deferred (later slices)
- GitHub-connect (repo + webhook auto-sync); custom domains (Phase 5: CNAME +
  verify + TLS + 301); the reclaim of BYO bytes on lapse rides the Phase 4b GC
  (BYO bytes are registered on the same metered line) but verify the GC enumerates
  BYO assets too (currently manifest-driven over lab_site_pages; BYO uses lab_byo_sites
  — a follow-up to include BYO in the GC sweep).
