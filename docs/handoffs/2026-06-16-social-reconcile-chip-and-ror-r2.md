# Handoff — social-layer reconcile + dept-chip polish + ROR registry (R2) (2026-06-16)

Session: handoff-recovery taking over the interrupted INJEST (social layer) lane.
Three things shipped to prod; one (ROR registry) is built + verified but BLOCKED on
an R2 upload. Read this top to bottom before touching the social lane.

## 1. Security-pass reconcile — DONE, LIVE (origin/main `04c7bc43a`)
The prior INJEST agent had shipped a security pass (commit `034dd139f`) that Grant
then REVERSED via Popup Unifier's relay, right before the session was interrupted.
Reconciled with a clean `git revert 034dd139f`:
- F1 WITHDRAWN: do NOT gate the fp-send surface (lookup-by-fingerprint + relay/send
  fp branch) on `isSocialLayerEnabled()`. The social flags are intentionally ON;
  `isSharingEnabled()`-only is the intended design.
- F2 REVERSED: `getBindingByFingerprint` requiring `unlisted = false` IS correct
  (fp-send is a discovery path; a private user is reachable only by exact email).
3 files byte-identical to their pre-`034dd139f` state. tsc 0, 229 relay+directory
tests green. Pushed + prod-verified (/network + directory endpoints 200).

## 2. Dept-chip shadow polish — DONE, LIVE (origin/main `2c9562d37`)
`/institution/[slug]` department chips were transparent outline pills washing out on
the vivid hero. Now solid white pills (`bg-surface-raised`) with Popup's canonical
`.ros-popup-card-shadow` (Grant picked "Take 1"). Browser-verified light (white pill
+ soft drop) AND dark (`#1c2638` + bluish-white lit-edge ring). Also in the same area
earlier (`55ee058b6`): `humanizeInstitutionSlug` lowercases minor words
("University of Wisconsin Madison") + "Back to the researcher network" links added to
the `/u/[handle]` not-found and `/institution/[slug]` states. All live.

## 3. ROR institution registry — DONE, LIVE + PROD-VERIFIED (origin/main `fc7b7a645`)
Merged to main + deployed. `https://research-os.app/institution/mit.edu` renders
`<title>Massachusetts Institute of Technology</title>` (prod function fetched the
gzipped registry from R2, gunzipped, resolved the canonical name). The branch was
one clean commit; the 28 MB asset is NOT in git history.

What it does: `/institution/[slug]` shows the real canonical name (e.g. "University
of Wisconsin-Madison") instead of the humanized domain, and exposes
`clusterDomainsFor()` so the directory can fold an org's verified subdomains into one
page. Full ROR v2.8 dump (CC0) normalized to ~116k domain keys.

Hosting (IMPORTANT, do not regress): the ~28 MB asset is R2-hosted, NOT committed and
NOT served from public/ (a built-by-an-agent first cut did `fs.readFileSync(public/)`
which silently fails on Vercel — public/ is not in the function filesystem). Resolver
(`frontend/src/lib/social/institution-registry.ts`) builds its OWN S3 client from the
shared `R2_*` env (does NOT import Popup's `lib/sharing/**`), fetches
`institution-registry/current.json.gz` from R2, gunzips + caches in module scope,
degrades to humanized-slug if R2 is unreachable. `resolveInstitution` +
`clusterDomainsFor` are ASYNC now.

Gates: tsc 0; 13 resolver tests green. Composed cleanly with the chip-shadow polish.

### How the R2 upload was done (the blocker, resolved)
- `vercel env pull` returned all four `R2_*` EMPTY — confirmed: they are "Sensitive"
  vars and `vercel env pull` does not export sensitive values. So the SDK/`R2_*`
  path cannot authenticate locally.
- FIX: `wrangler` is authed to the Cloudflare account (`gnick317@gmail.com`, OAuth),
  so uploaded directly without access keys:
  `wrangler r2 object put researchos-relay/institution-registry/current.json.gz --file <gz> --content-type application/gzip --remote`
  (NOTE the `--remote` flag — without it wrangler writes to a LOCAL simulation, not
  real R2). Gzipped 27 MB -> 5.8 MB. Bucket = `researchos-relay` (the private bucket
  prod's `R2_*` creds already use; the resolver reads `R2_BUCKET`, which prod = that
  bucket, so NO code change). Confirmed prod `R2_BUCKET = researchos-relay` via the
  live mit.edu render.
- REFRESH the data later (new ROR release): rebuild the JSON, then re-upload to the
  SAME key (`wrangler r2 object put researchos-relay/institution-registry/current.json.gz --remote`).
  Live swap, no redeploy (the resolver does not cache a stale empty result).

### Open follow-ups (not blockers)
1. RELAY TO POPUP UNIFIER (his tree): the `clusterDomainsFor` contract so
   `getInstitutionByDomain(domain)` folds an org's verified subdomains into one page
   -> `lower(affiliation_domain) = ANY(${await clusterDomainsFor(domain)})`. Full
   sketch in `docs/handoffs/2026-06-16-ror-institution-registry.md` (on the merged
   branch). Send via the CDD message tool, To/From signed.
2. CLEANUP: delete `.env.r2` (empty-secret file) in the worktree frontend dir; remove
   the worktree `agent-a68bd987724cc29f6` + delete branch `social/ror-registry-r2`
   (merged). Harmless to leave, tidy to remove.
3. This handoff + the AGENTS.md edit (the "large static assets -> R2" convention) are
   uncommitted on the local (dirty) main checkout -- land them on origin when convenient.

### Popup Unifier contract (relay AFTER ROR merges — his tree, do not edit it)
In `getInstitutionByDomain(domain)` (db.ts), change the filter from
`lower(affiliation_domain) = lower($domain)` to
`lower(affiliation_domain) = ANY(${await clusterDomainsFor(domain)})`, importing
`clusterDomainsFor` (async, `Promise<string[]>`) from `@/lib/social/institution-registry`.
Full sketch in `docs/handoffs/2026-06-16-ror-institution-registry.md` (on the branch).

## Other notes
- 2 PRE-EXISTING failing `note-dependencies` tests on clean origin/main (unrelated to
  any of this; that file untouched here). Worth a separate look.
- The shared LOCAL `main` checkout is still drifted from origin (all work shipped via
  side-worktrees). origin/main is the source of truth; do not build in the dirty local
  checkout.
- Verified-good live: security reconcile, chip polish, slug humanize, back-links. The
  populated search->profile->institution->send-resolution path was end-to-end verified
  locally via a throwaway PGlite seed (discarded); the send's final R2 byte-upload leg
  is covered by the 229 relay/directory tests, not run live.
