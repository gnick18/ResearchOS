# Handoff — Smart-search go-live (COMPLETE) + bracket fix + demo-fixture/dose-response engine

**Date:** 2026-06-15 (Figure Composer lane, takeover session)
**Memory:** `[[project_bioart_icon_library]]`
**Everything in this handoff is on `origin/main`** (pushed, not just local).

## One-paragraph state

Took over the Figure Composer lane mid-flight and closed out the smart-icon-search
go-live end to end, then fixed two things Grant surfaced (the "fucked" significance
brackets, and stale demo fixtures). Smart search is now **fully live-verified in a
real browser** — the previous session had only unit-tested it, which is exactly why
it shipped two latent blockers that only appear in a browser run. All work is on
`origin/main`. Net: a BioRender-class hybrid icon search (keyword + lazy client
embeddings) is live, the Data Hub significance brackets no longer cram, and the demo
+ dose-response analysis engine handle dose data correctly.

## 1. Smart-search go-live — COMPLETE + live-verified

The prior session built the hybrid search (keyword `asset-search.ts` + lazy semantic
`asset-embed-search.ts` + page-boot `BeakerBotLoader`) and "handed it to MobileUI to
merge". It merged (`af34dc855`) but the in-browser semantic check had never been run.
Running it on prod (`research-os.app/demo` → `/figures`, Chrome) surfaced **two
layered blockers**, both browser-only:

1. **`@xenova/transformers` v2 crashed at Turbopack module-evaluation** —
   `TypeError: Cannot convert undefined or null to object / at Object.keys / at module
   evaluation`. The dynamic `import()` never resolved, so zero CDN requests fired
   (INJEST's R2 was blameless). Diagnosed by pulling the swallowed `BootState.error`
   out of React state via a fiber DFS (the boot's `.catch` swallows it; nothing logs).
   **Fix (Grant's call): migrate to `@huggingface/transformers` v3** (`^3.8.1`). Key
   detail: `dtype:'q8'` maps (via v3's `DEFAULT_DTYPE_SUFFIX_MAPPING`) to the SAME
   `onnx/model_quantized.onnx` already on R2 → no model re-staging.
2. **CSP `script-src` blocked the ort wasm loader** — v3's onnxruntime-web 1.22 loads
   its wasm backend by **dynamically importing `ort-wasm-simd-threaded.jsep.mjs` as an
   ES module**, which is governed by CSP `script-src`, NOT `connect-src`. The R2 CDN
   was only in `connect-src` (so `fetch()` of model/vectors/wasm-binary worked but the
   module `import()` was blocked — the giveaway: `fetch(url)`→200 but `import(url)`
   fails). v2 never hit this (it didn't do a cross-origin module import).
   **Fix:** add `https://assets.research-os.com` to `script-src` in `next.config.ts`.

R2 also needed two ort files staged (INJEST did the wasm, I staged the `.mjs` myself
with Grant's OK): `ort/ort-wasm-simd-threaded.jsep.wasm` + `.jsep.mjs`. **The `.mjs`
MUST serve `Content-Type: text/javascript`** or the browser refuses to import it as a
module.

**VERIFIED working end-to-end** on a local prod build against live R2: Smart toggle →
loader runs model→vectors→warm-up with no error → 90 results, "programmed cell death"
returns `apoptosis`/`apoptosis 2` at the top (pure semantic, no shared tokens).

Also shipped from the prior session's backlog: **favorites/recents tray** + per-tile
star toggle (`lib/figure/asset-recents.ts`, localStorage, fails-soft), **~35 new
synonym groups**, and an **actionable empty state** (clear-category / try-Smart /
browse-library). The AI-"generate on no match" idea is still deferred (needs a Grant
product decision).

Commits: `f5aa045dd` (favorites/recents + synonyms + empty state), `a65f2a1fc` (v3
migration), `71a1ca83e` (CSP fix).

## 2. Significance-bracket headroom + vs-control demo polish (`87239ba84`)

Grant's "why do the between-group error bars look so fucked" = the significance
brackets crammed onto the data. Root cause: `layoutPlot`'s y-axis headroom was sized
from the DATA only (`dataMax * 1.15`), so a tall bracket stack overflowed and the
ceiling clamp shoved it down onto the points. The demo's ultra-tight replicates made
all 6 pairwise comparisons significant (worst case). **Fix:** `niceYMax`/`layoutPlot`
now reserve room for the stack — a pure `bracketStackDepth()` computes the tier count
and `yMax` expands so the data sits low enough for the tiers to fit. Also added
`PlotStyle.bracketComparisons` (`"all"` | `"vsControl"`, GraphEditor "Compare" toggle)
and set the demo's panel A to `vsControl` (3 tidy vs-WT brackets). Verified by
rasterizing the plot SVG (`qlmanage`).

## 3. Demo fixtures + dose-response engine (`52f8dbb0c`, `e5f2c815a`)

"Stale fixtures" turned out to be a real **engine-contract change in disguise**:
re-running the seed generator NULLED the dose-response (table 4) and global-fit
(table 7) analysis caches. Root cause: the dose-response engine now takes **RAW** dose
and log10's it internally (`prepareFitData` in `engine/fit/models.ts` drops
non-positive x). The demo's dose tables stored **pre-logged** x (`-9..-4`, all
negative) → every point dropped → "Need more than 4 finite points". A blind regenerate
would have silently destroyed the demo's fits.

**Fix (`52f8dbb0c`):** demo dose + global-fit tables now hold raw molar concentration
(1e-9..1e-4) with `xScaleType:'log'` on the figures — identical `ec50` (4.0415e-7),
proper sigmoid on a log axis. Fixed a secondary bug it exposed: `fmtTick` rounded tiny
ticks (1e-9 → "0"); now uses compact exponential for `|v|<1e-3` or `>=1e5`. Regenerated
all six fixtures (also picks up legit current-engine enrichments: anova
`postHoc`/`effectSize`, logistic `method`).

**Engine follow-up (`e5f2c815a`), via two background-task chips, merged here:** the same
contract means a real user with pre-logged dose input hits the same failure. Added
`fitLog10sDose`/`xLooksLogDose` (a concentration is physically non-negative, so any
strictly-negative X is already log dose; a lone zero stays raw) as the **single source
of truth** used by the fit, the rendered curve (`plot-spec`/`plot-code`) and the
generated Python (`show-code`), plus an `xScale` param (Auto/Concentration/Log dose)
and an actionable error. Also fixed a pre-existing global-fit codegen bug (it never
log10'd X). 1126 datahub tests, 21 new in `dose-x-scale.test.ts`.

## Lessons / gotchas worth keeping

- **A browser run catches what unit tests can't.** The whole smart-search go-live
  hinged on two blockers (Turbopack module-eval, CSP `script-src`) that are invisible
  to tsc + vitest. Always do the real in-browser pass before declaring a lazy/
  client-loaded feature live.
- **`import()` is governed by CSP `script-src`; `fetch()` by `connect-src`.** If a
  cross-origin `fetch` works but the matching `import()` fails with "Failed to fetch
  dynamically imported module", check `script-src`.
- **Pull a swallowed boot error from React state via a fiber DFS** when the loader only
  shows a friendly message (the page-boot `.catch` hides the real error).
- **`resourceTiming.responseStatus === 0` on a cross-origin asset is OPAQUE, not
  failed** — don't read it as an error.
- **Verify a plot headlessly:** write the SVG to `public/`, `qlmanage -t -s 1000 -o
  /tmp x.svg`, then Read the PNG. Used for every plot change this session.
- **Shared-checkout merge hazard:** the dose-response chips ran in the shared main
  checkout (`/Users/gnickles/Desktop/ResearchOS`) on a stale local main (35 behind
  origin) and left work UNCOMMITTED. To land it without reverting newer origin changes
  (my `fmtTick` fix in `plot-spec.ts`), I captured `git diff HEAD` as a patch and
  `git apply --3way` onto a branch off origin/main. Watch for ALL touched files —
  barrel re-exports (`engine/index.ts`, `engine/fit/index.ts`) are easy to miss and
  cause "has no exported member" errors.

## Open / optional (nothing functional outstanding)

- Favorites/recents tray is unit-tested but not browser-verified (quick live pass).
- AI-"generate this icon" on no-match — deferred, needs a Grant product decision.
- Circulate the page-boot loader primitive to Data Hub / Phylo (the prior session's
  "prove on figures first" is done).
- Branch/worktree cleanup: `figure-icon-favorites`, `figure-bracket-headroom`,
  `figure-transformers-v3`, `fix-demo-fixtures`, `land-dose-x-scale`, `docs-session-
  handoff`, and the `ROS-icon-fav` worktree are all merged/redundant and can be deleted.
