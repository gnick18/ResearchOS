# Handoff — Figure Composer overhaul + icon-federation expansion (2026-06-19)

Session lane: started by taking over the icon-library lane, grew into (1) a full
Figure Composer QOL + Illustrator-style arrange-bar overhaul, (2) two live
bioicons render-bug fixes, (3) expanding the open-asset federation from 7 to ~13
sources with a re-run ingest pipeline, (4) crediting the source projects + a
special-thanks banner. No em-dashes / no mid-sentence colons in this doc.

## TL;DR status

| Work | State |
|---|---|
| Figure QOL tier-1 (copy/paste/dup, group, flip, lock/hide, numeric transform, PNG/PDF export) | MERGED local main + PUSHED earlier, browser-verified, LIVE on prod |
| Flip/rotation canvas fix (SVG-syntax-as-CSS) | MERGED + PUSHED, browser-verified |
| Devicon trademark recolor guardrail (isLogo) | MERGED + PUSHED |
| 146 DBCLS bioicons blank-render fix (Adobe empty-prefix namespaces) | LIVE on R2 (uploaded + purged) |
| Illustrator-style arrange-bar redesign (27 glyphs, 6-way distribute, distribute-spacing, align-to) | MERGED local main, browser-verified, NOT pushed |
| Special-thanks banner on /library (BeakerBot + heartbeat + 13 linked source pills) | MERGED local main, browser-verified, NOT pushed |
| Credit asset-source projects (/library labels + /thanks group + /open-source section) | MERGED local main, NOT pushed |
| +7 federation sources (adapters) | MERGED local main; **LIVE INGEST IN FLIGHT (detached)** |
| Raster-wrapper bioicons prune + vector filter | MERGED local main; runs as part of the in-flight ingest |

**Local main is 11 commits ahead of origin and NOT pushed. Pushing = the prod
deploy (origin auto-deploys to research-os.app) and is GRANT'S CALL.** Everything
merged is gate-green (225 figure/library/icons tests, tsc clean) and the two new
UI pieces were browser-verified on :3000.

> UPDATE 2026-06-19 (Icon Lib session): section 1 is DONE + LIVE. The detached
> ingest finished (`[check] MATCH true`, 20,734 -> 27,726). All 7 new SVG dirs +
> manifest + embeddings were `rclone copy`d to R2 (checksum-verified) and Grant ran
> the Cloudflare Hostname purge on `assets.research-os.com` (driven via Chrome).
> Live-verified: manifest 27,726 with the exact `[final]` by-source tally
> (servier 5080, togopic 1323, ebi 241, janosh 156, arcadia 142,
> electricalsymbollib 74, swissbiopics 33, bioicons pruned to 2764), sample
> new-source SVGs return 200 + CORS, embeddings meta count 27,726. NEXT step 2
> (push) is moot, local main is already 0/0 with origin. Only the optional
> follow-ups in NEXT step 3 remain.

## 1. THE ONE LIVE THREAD — the icon ingest is RUNNING DETACHED (resume this first)

A `nohup` process is assembling the new-source bundle. It survives session/account
switches (sub-agents do not, which is why this is a detached shell process).

- Worktree: `/Users/gnickles/Desktop/ROS-ingest-final` (a `git worktree --detach` at
  the fixed HEAD; node_modules symlinked from master).
- Script + log: `frontend/scripts/asset-ingest/run-ingest.sh` + `run-ingest.log`.
- It does: seed the LIVE manifest -> `prune-raster-wrappers.mjs` (drop the ~71 broken
  bioicons) -> run 7 adapters (janosh-diagrams, electricalsymbollib, arcadia,
  togopic 2500, swissbiopics, ebi-icons 400, servier 200 49) -> `embed-assets.mjs
  --manifest <local bundle> --out <local bundle>` -> a final counts + byte-match check.
- It touches NOTHING on R2. The R2 upload is deliberately a SEPARATE manual step.

**To resume / check:** `tail -40 ROS-ingest-final/frontend/scripts/asset-ingest/run-ingest.log`.
When it prints `ALL DONE`, read the `[final]` (per-source counts) + `[check]` line
(must say `MATCH true`: meta.count == manifest length AND bin bytes == count*384*2).

**Then UPLOAD (the irreversible step, do by hand, verify each):**
```
cd ROS-ingest-final/frontend/scripts/asset-ingest/out/bundle
# new SVG dirs + the manifest + the embeddings (COPY never SYNC - sync deletes the 20k existing):
rclone copy assets/janosh-diagrams      r2:researchos-assets/assets/janosh-diagrams      --s3-no-check-bucket --transfers 16 --ignore-times
# ...repeat for assets/{electricalsymbollib,arcadia,togopic,swissbiopics,ebi,servier}
rclone copyto manifest.json             r2:researchos-assets/manifest.json               --s3-no-check-bucket --ignore-times
rclone copyto embeddings-v1.bin         r2:researchos-assets/embeddings-v1.bin            --s3-no-check-bucket --ignore-times
rclone copyto embeddings-v1.meta.json   r2:researchos-assets/embeddings-v1.meta.json      --s3-no-check-bucket --ignore-times
```
USE `--ignore-times` (rclone's checksum/modtime skip wrongly transfers 0 otherwise -
this bit twice). After upload, **Grant runs a Cloudflare dashboard Custom Purge,
type Hostname, `assets.research-os.com`** (manifest.json + embeddings-v1.* are
`cache-control: max-age=14400` = edge-cached 4h, so they serve stale until purged;
new SVG paths are fresh and need no purge). `[[reference_assets_cdn_4h_cache]]`.
Verify live: manifest count, sample new-source SVG 200+CORS, and the ~71 broken
bioicons are gone from /library.

### Ingest gotchas that already bit (do not relearn)
- Adapters have small DEFAULT caps as args: togopic MAX default 150 (pass ~2500),
  ebi-icons default 200 (pass ~400). Servier `[icons-per-pptx] [max-pptx]` default
  `50 5` (pass `200 49` for the full ~8-9k).
- `embed-assets.mjs` `--manifest` DEFAULTS to the LIVE URL. You MUST pass
  `--manifest <local bundle>/manifest.json --out <local bundle>` or it embeds the
  old 20,734, not your new bundle.
- janosh-diagrams hits the GitHub API and can transiently rate-limit (HTML instead
  of JSON). If it fails, just re-run it (window resets); it appends to the manifest.

## 2. Figure Composer (all merged local main; QOL+flip+guardrail already pushed live)

- **Tier-1 QOL** (copy/paste/dup Cmd C/V/D, group/ungroup Cmd G / Cmd Shift G, flip
  H/V, numeric X/Y/W/H-in + rotation inspector, lock/hide, PNG 300dpi, vector PDF via
  jspdf+svg2pdf dynamic-import). Additive data-shape only (`ElementQoL` optional
  fields + `isLogo?`), old docs byte-identical. lockOpen glyph added.
- **Flip/rotation canvas bug** (2 rounds): `elementTransform` emits SVG-attribute
  syntax (space-separated, no units) which is INVALID as a CSS transform on the
  canvas divs -> browser dropped it -> flip/rotate invisible on screen (export was
  fine). Fix = `elementTransformCss()` for the 3 canvas call sites (rotate(Ndeg)
  scale(sx,sy), pivot at element center, NO absolute translate), SVG export path
  unchanged. Browser-verified flip mirrors in place.
- **Devicon guardrail**: `isLogo` was tagged in the manifest but no frontend code
  read it; now threaded LibraryAsset->PlacedAsset, gated at the pure
  `recolorPlacedAsset` helper, recolor UI hidden for logos, bulk-recolor skips them.
- **Illustrator arrange-bar redesign** (`feat/figure-arrange-illustrator`, merged):
  27 registry glyphs replace the text buttons; `distributeElements` is now 6-anchor
  (left/centerX/right/top/centerY/bottom); new `distributeSpacing(gapIn)`; new
  `alignElements` `AlignTarget` selection/page/key (key = most-recently-added to the
  selection; page = FigurePage box). Browser-verified the toolbar renders all groups.

## 3. Icon federation expansion (7 -> ~13 sources)

Two license-verified web research sweeps (findings are in the AGENTS banner + memory
`[[project_bioart_icon_library]]`). NEW adapters, all on the lib.mjs seam, merged:
janosh/diagrams (MIT, physics leaf), ElectricalSymbolLibrary CC0 (electronics),
Arcadia CC0 (71 organisms x 2 styles), DBCLS Togo CC-BY (deduped vs BioIcons),
Servier CC-BY (~8-9k true-vector DrawingML), SwissBioPics CC-BY (33), EMBL-EBI
CC-BY-SA (~241). DROPPED AcheronProject (page-sheets not icons). KiCad = MAYBE,
demand-gated (adapter `ingest-kicad-symbols.mjs` built but needs `kicad-cli` to
convert .kicad_sym; ~8000 CC-BY-SA symbols; install + run only if users ask).
REJECTED traps: NIH BioArt (mixed NC/ND + no bulk API), gwoptics optics (CC-BY-NC),
sciencefigures.org + SVG Repo (bespoke "Open Design License 1.1" with a
"not redistributed in the same or similar way" clause = unsafe for our re-host).
Grant accepted CC-BY-SA (it allows edit/recolor, just propagates in the credit;
NOT ND; ND/NC stay excluded).

Servier had TWO real bugs found by sub-bots: (1) a one-char destructuring reversal
(w/h/inner capture order), (2) a coordinate-scale collapse (DrawingML two-level
child-coordinate xfrm divided by EMU directly -> sub-pixel blank SVGs). Both fixed;
icons now render as whole recognizable illustrations; ~8-9k is the REAL count (not
fragments, confirmed by rasterizing samples) so we ingest all.

## 4. Bioicons render fixes (the live broken-icon reports)

- **146 DBCLS empty-prefix namespaces** (`xmlns:x=""`): illegal XML, browser rejected
  the whole SVG. `sanitizeSvg` now rebinds them + strips Adobe `<i:aipgf>` blobs.
  Repaired 146 live SVGs + uploaded + purged = LIVE FIXED.
- **~71 raster-photo wrappers** (bioicons that are a photo in an `<svg>`, only
  `<image>`, no shapes -> broken-image box once href neutralized). `sanitizeSvg` now
  reports `hasVector`; bioicons adapter skips wrappers; `prune-raster-wrappers.mjs`
  drops the existing ~71 from the seeded manifest. This prune runs INSIDE the
  in-flight ingest, so the broken tiles vanish when that bundle is uploaded.

## 5. Credits + special-thanks banner

- Source projects now thanked at the project level: `SOURCE_LABELS` expanded to 14,
  a "Scientific illustration libraries" group on `/thanks`, a section on
  `/open-source`. Per-asset citation already satisfied the CC-BY/SA legal obligation.
- **Special-thanks banner** at the TOP of `/library`: the canonical `IntroBubbleBot`
  BeakerBot + a pink heart with a double-thump heartbeat + lean-in animation
  (reduced-motion safe), heading + subline, and the 13 source libraries as
  link-pills (name + license, each a real anchor to its site). Browser-verified.

## NEXT (in order)
1. Let the detached ingest finish (section 1), verify `[check] MATCH true`, then
   `rclone copy` the new dirs + manifest + embeddings (NEVER sync, USE --ignore-times),
   Grant purges `assets.research-os.com`, verify live (new sources appear, broken
   tiles gone). Servier will add ~8-9k so total ~28k+.
2. Grant decides when to PUSH local main (11+ commits) to origin = prod deploy. The
   arrange-bar + banner + credits + adapters all ride that push; the QOL/flip/guardrail
   already shipped earlier.
3. Optional follow-ups: KiCad if users ask; tune Servier per-pptx cap if ~8-9k feels
   heavy in the grid; the deferred CS taxonomy leaf.

## Worktrees to sweep later
`ROS-ingest-final` (keep until the upload is done), plus the per-agent worktrees under
`.claude/worktrees/agent-*` for the merged branches (feat/figure-qol-tier1,
figure-pdf-export, figure-arrange-illustrator, ingest-*, credit-asset-sources,
library-special-thanks, servier fixes) are all merged and safe to remove.
