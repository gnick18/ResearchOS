# Handoff — Open scientific-asset library (NIH BioArt + federation) → icons in the Figure Composer

**Date:** 2026-06-14
**Memory:** `[[project_bioart_icon_library]]`, `[[project_figure_composer_styling]]`
**Proposal:** `docs/proposals/2026-06-14-nih-bioart-icon-library.md` (the federation design)
**Mockup:** `docs/mockups/2026-06-14-bioart-icon-library.html`

## One-paragraph state

A whole new initiative went idea → live this session: a **federation of vetted
open-licensed scientific assets** served from a Cloudflare R2 CDN, plus an in-app
**icon library inside the Figure Composer** (`/figures`). The figure-styling Phase 3
+ an autosave-race fix were also shipped + **pushed** earlier in the session. The
asset library + figure-icon UI are **merged to LOCAL main (merge `260da92c5`),
flag-gated OFF (`ASSET_LIBRARY_ENABLED`), NOT pushed, gate-green** (tsc 0, 71 figure
tests, icon-guard clean). The one remaining gate is Grant's mouse-verify of the icon
UI, then flip the flag + push.

## What shipped + pushed earlier (figure styling)
- **Phase 3** of in-app figure styling: generic `FigureSource.styleSchema()` (phylo
  Scale bar/Legend/Root edge toggles, Data Hub palette select, sequence via the
  generic path, chem none). **Grant browser-verified all 4 sources.**
- **Autosave race FIX** (`figure-page-store.ts`): the composer saved on every edit and
  `fileService.writeJson`'s `<id>.json.tmp` move collided → `NoModificationAllowedError`
  + "Caught a bug" modal. Fixed by serialize+coalesce-per-id. Verified gone.
- Both PUSHED to origin/main (push `52bb64310..44c924f74`), memory
  `[[project_figure_composer_styling]]` (now fully browser-verified).

## The asset library (NEW)

### Legal policy (LOCKED, the load-bearing constraint)
Ingest ONLY **CC0 / Public Domain / CC-BY / CC-BY-SA** (commercial + derivative OK).
EXCLUDE every **-NC** (we are a paid product) and **-ND** (we recolor = a derivative),
and proprietary (BioRender) / Flaticon / Noun-Project-free. Each asset carries its
verbatim **credit** + license; the figure **auto-generates a credits block** (CC-BY/SA
only; PD/CC0 omitted) so we are compliant by construction.

### Ingest pipeline — `frontend/scripts/asset-ingest/` (standalone Node, no app deps)
- `lib.mjs`: normalized Asset model + `classifyLicense` (the policy above) + per-source
  credit formatter + `sanitizeSvg` that PRESERVES per-fill addressability. 6 node:test units.
- `survey.mjs` + `CORPUS-REPORT.md`: corpus recon. **PhyloPic = 11,738 clean** (API +
  `filter_license_nc=false`). **BioArt = license-clean but the HARD source** (aggressive
  rate-limiting + SVG download path NOT in the page JSON, only PNG previews → needs ONE
  devtools capture of the "Download→SVG" request to unblock).
- `ingest-phylopic.mjs` + `ingest-bioicons.mjs`: real adapters. Run `node
  scripts/asset-ingest/ingest-<src>.mjs [MAX]`. Output merges into `out/bundle/`
  (`manifest.json` + `assets/<src>/*.svg`), gitignored, synced to R2.
- **Vetted federation:** PhyloPic (11.7k, API, mono/single-fill), BioIcons (2,829 SVG,
  multi-fill, manifest + license-in-path), + future-vet Servier (PNG/PPTX only — NOT
  SVG, deferred), SciDraw, Reactome/WikiPathways. ~20k+ clean total.

### R2 CDN (LIVE)
- Cloudflare acct `810d2fc803045ac0861a1ccb2d933719`, bucket **`researchos-assets`**,
  custom domain **`https://assets.research-os.com`** (zone `58689f68...`, registered
  `research-os.com` via Cloudflare Registrar $10.46/yr — also a brand .com matching
  research-os.app). CORS GET/HEAD `*`. **300 assets uploaded + verified serving.**
- Sync: `rclone sync frontend/scripts/asset-ingest/out/bundle/ r2:researchos-assets
  --transfers=16 --checkers=16` (rclone remote `r2` in `~/.config/rclone/`).
- **GOTCHA:** `rclone config create` multi-line backslash form mangles on paste (drops
  endpoint → hits s3.auto.amazonaws.com). Fix = create skeleton then `rclone config
  update r2 access_key_id=.. secret_access_key=..` as ONE short line.

### Figure-icon UI (merged, flag-gated, `frontend/src/lib/figure/`)
- `asset-library.ts`: CDN client. `ASSET_BASE_URL` (env, defaults the live domain),
  `ASSET_LIBRARY_ENABLED` gate (default OFF), `loadAssetManifest`/`fetchAssetSvg` +
  pure `searchAssets`/`listCategories`.
- `figure-page.ts`: `PlacedAsset` (real-inch box, rotation, single-tint, cached credit)
  on `FigurePage.assets[]` + helpers + `figureCredits()`. Pre-asset pages tolerated.
- `figure-compose.ts`: `tintSvg` (single-tint fill rewrite) + `placeAssetSvg` +
  `assetSvgs` in `ComposeOpts` + `assetLayerSvg`. icon-baseline figure-compose 8→9.
- `components/figure/FigureComposer.tsx`: "Add icon" → `AddIconPicker` (search +
  category + thumbnail grid) → place → drag/resize/tint/rotate → Selected-icon
  inspector → "Figure credits" block + Copy → export passes `assetSvgs`.
- Architecture: an icon is a **lightweight graphic, NOT a panel**; reuses the
  picker + annotation-drag + (eventually) styleSchema-recolor seams.

## NEXT (in priority order)
1. **Verify the icon UI** (Grant's mouse): `docs/test-prompts/2026-06-14-figure-icon-library-chrome-test.md` — set `NEXT_PUBLIC_ASSET_LIBRARY_ENABLED=1` in `frontend/.env.local`, restart, demo-mode OK. Then **flip the flag + push** (figure-styling + asset-library both unpushed on local main past 44c924f74).
2. **Scale the ingest:** bump `MAX` in the ingest scripts, re-`rclone sync` (full ~14k). PhyloPic only ~150 of 11.7k pulled so far; BioIcons 150 of 2,829.
3. **Per-fill recolor** (Grant's locked choice) — currently single-tint; the sanitizer already preserves per-fill structure. Next styling increment.
4. **BioArt SVG devtools capture** to add that source (rate-limited + PNG-preview-only page).
5. **App env on deploy:** `NEXT_PUBLIC_ASSET_BASE_URL=https://assets.research-os.com` (defaults to it in code, so optional) + flip `NEXT_PUBLIC_ASSET_LIBRARY_ENABLED` in Vercel when ready.

## Operator TODO (flagged, not done)
Fetch the Cloudflare **invoice PDF** (receipt **IN-68300948**, $10.46, research-os.com
registration) for LLC records — dashboard download hung; grab via incognito + add to
the `/admin#finances` Setup checklist (operator-gated, can't add programmatically).

## Gotchas reaffirmed
- Build in worktrees, merge when the shared tree is clean (main moved a lot this session).
- icon-guard: bump ONLY your file's entry in `icon-svg-baseline.json` (don't regen the
  whole file — it absorbs other lanes' counts). Test files build `"<"+"svg"`.
- The extension blocks reading authenticated Cloudflare BILLING responses (by design).
