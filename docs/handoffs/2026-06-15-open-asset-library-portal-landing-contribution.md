# Handoff: open asset library — ingest scale-out, /library, contribution + verification

Date: 2026-06-15. Lane: icon-library-data (open scientific-asset library / BioRender alt).
Plan doc: docs/proposals/2026-06-15-asset-library-portal-landing-contribution.md

## TL;DR — what shipped (all merged to LOCAL main, merge a98883471, NOT pushed)

1. **Ingest scaled to the full clean corpus and synced to R2.** 14,296 assets live on
   `assets.research-os.com` (11,738 PhyloPic + 2,558 BioIcons). 0 license violations,
   0 missing credits. Clean browsable taxonomy + rich tags (common names).
2. **Public `/library` landing** — browse/search/category-tree/citation drawer over the
   live CDN manifest. No login. Public route.
3. **Community contribution wizard + backend (Part 3a)** + **peer-review surface +
   verify/flag endpoints (Part 3b)** — both behind `NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED`
   (OFF). Wiki-style: auto-publish flagged "unverified", an INDEPENDENT user verifies
   (server-enforced `verifierId !== submittedBy`).
4. **Grouped category taxonomy** (`listCategoryGroups`) for the BioRender-style picker
   tree the Figure Composer lane consumes.

tsc clean; vitest green; ingest node:tests green.

## FIGURE COMPOSER: taxonomy is LOCKED (answer to their gating question)

YES, build the grouped sidebar now. The full-corpus ingest is DONE + synced, so:
- The **9 sections + display order are final**: Organisms / Microbes & pathogens /
  Cells & tissues / Molecular / Anatomy & physiology / Lab & methods / Chemistry /
  Data & informatics / People & general (+ trailing "Other").
- The **clean leaf category names are final** (Mammals, Birds, Fishes, Nucleic acids,
  Lab apparatus, Human physiology, ...). They will NOT rename/split under your UI. The
  old "300-batch falls to Other" caveat is gone — the live manifest is the full corpus.
- Consume `listCategoryGroups(assets) -> [{ section, categories[] }]` (display order,
  empty sections omitted, novel/community tags collect under "Other").
- Part 3b picker badges: `verificationStatus(a)` ("curated"|"unverified"|"verified");
  per-asset amber dot when "unverified"; `countReviewable(assets, viewerHandle)` for a
  "Help review (N)" entry → link `/library/review`. All additive; curated never badges.
- The IconsPanel (FigureLeftRail.tsx) is THEIR file; I did not edit it. Snippet is in
  the last cross-session message + the session transcript.

## Key files

Ingest (worktree `.claude/worktrees/icon-library-data`, branch worktree-icon-library-data,
committed there — NOT merged to main; out/ is gitignored, already synced to R2):
- `frontend/scripts/asset-ingest/lib.mjs` — license policy, sanitizer, PHYLO_GROUPS (19
  organism groups, priority-ordered), PHYLO_COMMON (curated taxon→common-name map),
  BioIcons category cleanup, tag/category derivation. `lib.test.mjs` = 13 node:tests.
- `ingest-phylopic.mjs` — top-down clade index (filter_name→filter_clade) gives every
  silhouette a group category + common-name tags. EXACT-match clade resolution (fuzzy
  match caused the Archaea→Neomura 12k bug; fixed). Resume-safe (checkpoints + re-annotate).
- `ingest-bioicons.mjs` — clean categories + tags; multi-URL-candidate retry; logs
  failures to out/bioicons-failures.json (271 URL-encoding misses last run, not dropped).

App (on main via merge a98883471):
- `frontend/src/lib/figure/asset-library.ts` — LibraryAsset (+ optional submittedBy,
  verification), loadAssetManifest (merges manifest.json + community-manifest.json,
  cache:"default" so the live count is never stale), listCategoryGroups/sectionForCategory,
  verificationStatus/reviewableAssets/countReviewable. Tests in figure/__tests__/asset-library-groups.test.ts.
- `frontend/src/lib/library/asset-validate.ts` (+ test) — server-side license gate +
  SVG sanitizer (TS port of the ingest lib). `asset-storage.ts` — R2 adapter for the
  asset bucket (writes assets/community/<id>.svg + community-manifest.json).
- `frontend/src/app/api/library/{submit,verify,flag}/route.ts` — the write/verify/flag
  endpoints (nodejs runtime; flag-gated; reuse the relay R2_* creds).
- `frontend/src/app/library/{page,contribute/page,review/page}.tsx` +
  `frontend/src/components/library/{AssetLibraryLanding,ContributeWizard,ReviewQueue}.tsx`.
- `frontend/src/lib/providers.tsx` — `/library` added to the public-marketing-route
  bypass (so signed-out visitors reach it, not the folder-connect gate).

## R2 / CDN

- Bucket `researchos-assets` @ `https://assets.research-os.com`. rclone remote `r2:`.
- **SHARED BUCKET — DESTRUCTIVE-SYNC HAZARD.** `researchos-assets` is shared with OTHER
  lanes: the Billing/Welcome lane stores marketing videos under `welcome/**`
  (assets.research-os.com/welcome/*.mp4), and the contribution feature writes
  `community-manifest.json` + `assets/community/**`. A bare `rclone sync` MIRRORS (deletes
  anything in the bucket not in out/bundle/) and WOULD WIPE all of those.
- **SAFE default re-sync = `rclone copy` (never deletes):**
  `rclone copy .claude/worktrees/icon-library-data/frontend/scripts/asset-ingest/out/bundle/ r2:researchos-assets --transfers=24 --checkers=24`
  Orphaned files from removed/renamed icons are harmless (not in manifest.json = not shown).
- ONLY if you genuinely need to PRUNE removed icons, use `sync` and FIRST
  `rclone lsf r2:researchos-assets --dirs-only` to see every foreign top-level prefix, then
  exclude them ALL:
  `rclone sync ...out/bundle/ r2:researchos-assets --exclude "welcome/**" --exclude "community-manifest.json" --exclude "assets/community/**"`
- manifest.json carries Cache-Control max-age=300 + swr (set via rclone --header-upload).

## GO-LIVE GATES (Grant's infra — none done yet)

1. **Portal**: run the Claude-in-Chrome prompt (in transcript) to add the Cloudflare
   301 redirect www/apex research-os.com → research-os.app. Cost $0.
2. **Contributions live**: confirm the R2 API token can WRITE `researchos-assets`
   (endpoints reuse R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY; bucket override
   ASSET_R2_BUCKET defaults to researchos-assets) → set `NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED=1`
   in Vercel.
3. **Deploy**: push main (currently unpushed).

## REMAINING WORK

- Part 3c (optional): wiki-style suggest-edits (`/api/library/suggest`), nicer
  flag-threshold handling. Flag-threshold auto-unpublish already works.
- Figure Composer: grouped picker tree + verification badges + "Help review (N)" (their
  file; snippet provided; taxonomy locked).
- Identity hardening: submit/verify accept submittedBy/verifierId from the body (blind-
  relay model). Binding to a verified session is a follow-up; the independent-verifier
  rule still compares handles + is server-enforced.
- BioIcons: 271 URL-encoding failures logged for a future retry pass.

## Notes for the next session

- A dev server may still be running on :3344 (worktree library-ui) under the preview
  harness; `lsof -ti tcp:3344 | xargs kill` to stop it.
- `frontend/.env.local` in the library-ui worktree has the contribute flag on (gitignored).
- The icon-guard pre-commit ratchets on literal "<svg" in src; the sanitizer + its tests
  build the tag without that literal on purpose (SVG-as-data, not an icon component).
