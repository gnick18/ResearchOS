# Handoff: social layer Phase A (researcher network) + smart-search verify

Date: 2026-06-15. Lane: INJEST (open-asset-library / public-surfaces).
Plan: `docs/proposals/2026-06-15-social-layer-build-plan.md`. Locked spec:
`docs/proposals/2026-06-14-researcher-profiles-and-social-layer.md`.
Memory: `[[project_researcher_social_layer]]`.

## TL;DR

Researcher-network **Phase A is BUILT + MERGED + PUSHED to origin/main**, all
behind `NEXT_PUBLIC_SOCIAL_LAYER` (default off = byte-identical). Smart-search R2
hosting fully verified (FC owns the one remaining client bug). Phase A live
search (A2) is the only open dependency, on Popup Unifier's directory endpoint.

## Grant's 4 decisions (LOCKED 2026-06-15)

1. Hub route = **/network**
2. Public search = **login-free**, listed-only (names/affiliation/ORCID, never email)
3. Institution pages = **auto-provision from verified-domain clusters** (Phase B)
4. v1 scope = **ship Phase A first**

## What shipped (origin/main, flag-dark)

- **A1 `/u/[handle]` parity** — renders bio + typed ORCID/ResearchGate/website
  links (already returned by `/api/account/public`, no backend change) in
  MarketingNav + MarketingFooter chrome. Flag-off = original thin card.
- **A2 public `/network` hub** — `app/network/page.tsx` (404s when flag off) +
  `components/social/NetworkLanding.tsx` on the /library chrome +
  `components/social/PublicResearcherSearch.tsx`. Search client
  `lib/social/public-search.ts` consumes Popup's not-yet-built
  `GET /api/directory/public-search`; a 404 shows a calm "coming online" note so
  the hub is publishable now and lights up when the endpoint lands. 5 unit tests.
- **A2 polish** — shareable `/researchers/[fingerprint]` profile
  (`components/researchers/ResearcherProfile.tsx`) now uses the same marketing
  chrome when the flag is on (the hub's result cards link there). Flag-off
  unchanged.
- **A3 discoverability sweep** mirroring /library — flag-gated entries in
  MarketingNav + MarketingFooter + `lib/nav.ts` NAV_ITEMS (CONDITIONAL inclusion,
  since /network 404s when off, unlike always-public /library) + a `users` glyph
  for the auto BeakerSearch "Go to" row; `lib/providers.tsx` public bypass for
  `/network` and the shareable `/researchers/<fp>` profile (matched as
  `/researchers/` WITH a trailing slash so the in-app `/researchers` SEARCH stays
  folder-gated; this also fixed a latent bug where the shareable profile was never
  actually in any bypass despite its own "shareable" comment); `/network` added to
  `scripts/check-wiki-coverage.mjs` EXCLUDED_PREFIXES (the prod-build gate).
- **Flag** — `lib/social/config.ts` `SOCIAL_LAYER_ENABLED` (mirrors the
  asset-library flag pattern).

Gates: whole-repo tsc 0 (the lone `@xenova/transformers` error in a fresh
worktree is an install artifact from the figure lane's dep, present in the
lockfile + already built on Vercel); wiki-coverage 0 gaps; icon-guard 0 (no
inline svg, used `<Icon>` throughout); nav-icons + wiki-nav + account-profile
suites green BOTH flag states; new public-search test (5).

## OPEN — needed from Popup Unifier (session local_6d3e01a6)

Requested 2026-06-15. `/api/directory/*` + `lib/sharing|account/*` are Popup's
tree; INJEST consumes, never authors.

1. **A2 hard dep**: a public, harvest-safe, listed-only researcher SEARCH endpoint.
   Proposed `GET /api/directory/public-search?q=<min 2-3>` ->
   `{ results: [{ fingerprint, displayName, affiliation, verifiedDomain, orcid }] }`
   (never email; IP rate-limited; min-query-length + capped page size; gated on
   isSharingEnabled). The client already handles whatever shape ships; only the
   404->live transition is needed.
2. **A1 nice-to-have**: verified-domain badge on `/u/[handle]` needs a clean
   handle->fingerprint link, or a `verified` flag in the public payload. Shipped
   A1 without it; additive when available.

## NEXT (this lane)

- Wire A2 live search the moment Popup confirms the endpoint shape; re-gate.
- Grant's visual pass on /network + /u + the shareable profile (human-only:
  `NEXT_PUBLIC_SOCIAL_LAYER=1` in `frontend/.env.local`, restart dev). NOT
  browser-verified yet (Turbopack single-dev-server lock blocked a synthetic
  render; render-gated at the code level against the locked spec instead).
- Phase B (public institution pages + member directory) is gated on Popup's
  member-list read endpoint + the institution-tier flag; v1 = Phase A only.
- Optional: a dedicated `/network` wiki page (currently EXCLUDED, same as
  /library + /researchers).

## Smart-search (Figure Composer lane, INJEST hosts) — my side CLOSED

All R2 sidecars on assets.research-os.com return 200 + CORS `*` (embeddings-v1.bin
= 14559x384x2 f16 exactly, .meta.json, MiniLM model + tokenizer, ort wasm). The
**keyword (C) layer is LIVE on prod.** The **semantic (A) layer is broken on prod**
but NOT my R2/CSP — FC traced it to `@xenova/transformers` throwing at
module-eval under the Turbopack prod bundle (zero CDN requests fire). Fix is in
FC's lane (transpilePackages, same class as their Ketcher fix). I'm on standby to
re-run the client-side fetch verify when FC has a build.

## Git / coordination notes

- Phase A landed via a clean side-worktree merge (main checkout was dirty with
  other lanes' uncommitted work + actively advancing). Pattern that worked:
  detached worktree at the local-main HEAD -> `git merge origin/main` (conflict-free,
  disjoint files) -> tsc -> `git push origin HEAD:main`. Do NOT merge/pull in the
  shared dirty main checkout.
- The shared main checkout's local `main` ref may sit BEHIND origin/main after a
  side-worktree push; that is expected, the work is safe on origin. Reconcile on a
  clean pull.
- Always `node scripts/check-wiki-coverage.mjs --ci` before merging any NAV_ITEMS
  change (tsc does not catch it; it bricked a prod build on 2026-06-15).
