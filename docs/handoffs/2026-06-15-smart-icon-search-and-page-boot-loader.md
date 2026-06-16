# Handoff — Smart icon search + page-boot BeakerBot loader + Data Hub plot fixes

**Date:** 2026-06-15 (Figure Composer lane, cont'd)
**Memory:** `[[project_bioart_icon_library]]`, `[[project_plot_artboard]]`
**Branch for go-live:** `figure-smart-search-A` (handed to MobileUI for the merge)

## One-paragraph state

Three things this session. (1) **Data Hub plot fixes** — the "error bars look fucked"
report turned out to be the **between-group significance brackets**, not the in-group
whiskers; fixed + the I-beam cap nesting; **MERGED + LIVE on prod** (`a35043d1d`). (2)
**Smart icon search** (BioRender doc #1) — a hybrid: always-on near-miss keyword search
(typo + synonym) + an opt-in lazy semantic layer (client MiniLM embeddings, blended).
(3) **Page-boot BeakerBot loader** — a shared honest-progress page-load framework, reusing
the official `SplashBeaker`, first-customer = the smart-search 34MB load. Smart search is
**cleared to go live** (R2 assets staged + verified, Vercel vars set); the branch is
verified + ff-able and **handed to MobileUI to merge+push** → that build makes it live.

## Data Hub plot fixes — DONE + LIVE (`a35043d1d` on origin/main)

`lib/datahub/plot-spec.ts`. Two commits: error-bar caps tied to mean-line width so the
top-cap/mean/bottom-cap read as one nested I-beam (`capHalf = max(6, round(meanHalf*0.62))`);
significance brackets now sit just above the TALLEST element under the groups each span
CROSSES (not the global top), stepping a tier above any overlapping bracket — narrow
adjacent comparisons hug their pair, the long span goes on top. Placement nailed via an
interactive draggable-bracket calibration widget (Grant approved). 88 plot-spec tests.
**The root-cause lesson:** when Grant says "error bars" on a GraphPad-style plot, clarify
in-group whiskers vs between-group significance brackets BEFORE coding (I burned a loop).

## Smart icon search — BUILT, cleared, on `figure-smart-search-A`

Hybrid (see `docs/proposals/2026-06-15-icon-semantic-search.md`):
- **C, keyword baseline (always on):** `lib/figure/asset-search.ts` — trigram fuzzy +
  curated science-synonym map, blended into one score. **Perf-optimized:** `buildSearchIndex`
  tokenizes the 14.5k manifest ONCE (memoized), `rankDocs` reuses it; trigram is a FALLBACK
  (cheap literal+synonym pass first, trigram only when results are sparse / a likely typo);
  query trigrams computed once. 333-460ms → 10-98ms. Wired in `FigureLeftRail` IconsPanel
  with a 120ms input debounce + render cap 90 (was 240; each tile fetches a CDN SVG).
- **A, semantic (opt-in, lazy):** `lib/figure/asset-embed-search.ts` — a "Smart" toggle
  lazy-loads MiniLM + the precomputed L2-normalized vector matrix (behind the BeakerBot
  loader, byte-streamed progress), embeds the query in-browser, cosine via dot-product,
  BLENDS with C (literal hits stay on top). Pure helpers (`halfToFloat`, `decodeF16Matrix`,
  `dotTopK`, `blendResults`) unit-tested. Flag `NEXT_PUBLIC_ASSET_SMART_SEARCH`.
- **Precompute:** `scripts/asset-ingest/embed-assets.mjs` (INJEST runs + R2-syncs) — MiniLM
  384-d, fp16, row order == manifest. Verified on real corpus: "programmed cell death"→
  apoptosis, "tiny swimming microbe"→Bacteria Swimming, "brain nerve cell"→Neurons.
- **CSP-safe hosting (critical):** the app CSP does NOT allow huggingface.co, so the MiniLM
  model AND the onnxruntime `.wasm` must load from our R2. `NEXT_PUBLIC_ASSET_MODEL_HOST`
  points the model fetch at our CDN; `wasmPaths` points ort at `<embed-base>/ort/`,
  single-threaded (no COOP/COEP). CSP already has connect-src `assets.research-os.com` +
  `wasm-unsafe-eval`. Adds `@xenova/transformers` dep (code-split dynamic import).

### Prod go-live state
- **R2 (INJEST, LIVE + verified 200 + CORS `*`):** `embeddings-v1.bin` + `.meta.json`
  (14,559×384 f16, builtFrom live manifest), `Xenova/all-MiniLM-L6-v2/{config,tokenizer,
  tokenizer_config}.json + onnx/model_quantized.onnx`, `ort/ort-wasm-simd.wasm` + `ort-wasm.wasm`.
- **Vercel vars SET (Grant):** `NEXT_PUBLIC_ASSET_SMART_SEARCH=1` +
  `NEXT_PUBLIC_ASSET_MODEL_HOST=https://assets.research-os.com` (build-time inlined → vars
  MUST be set before the build, which they are).
- **Branch:** merged current origin/main in (no conflicts, lockfile clean), tsc 0, 161 tests,
  ff-able. **HANDED TO MOBILEUI** to `git merge --ff-only figure-smart-search-A` + push →
  that Vercel build makes smart search live.
- **Footprint:** ~44MB lazy, first-use-only, cached (vectors 11 + model 23 + ort 10). Grant
  greenlit. INJEST owns the manifest↔vectors regen coupling (ping after any corpus change).

## Page-boot loader — BUILT (in `figure-smart-search-A`)

`lib/page-boot/{page-boot.ts, fetch-with-progress.ts}` + `components/page-boot/{BeakerBotLoader,
PageBoot}.tsx`. A page declares weighted `BootTask`s; `runBoot` aggregates TRUE progress +
real ETA from localStorage-cached timings, never fakes 100%, emits `error` for a retry (no
soft-lock). `fetchWithProgress` streams big downloads by bytes. `BeakerBotLoader` reuses the
**official `SplashBeaker`** (animations/ dir, icon-guard exempt — do NOT reinvent the beaker).
Lane-neutral so Data Hub / Phylo adopt the same primitive. 12 core tests. Rollout decision:
"prove on figures first" (DONE via smart search) → THEN orchestrator circulates to other lanes.

## Coordination / dev rigs (cleanup)

- **MobileUI:** holds the go-live merge of `figure-smart-search-A`.
- **INJEST:** smart-search R2 fully staged; watching the build; owns vector regen.
- **Phylo:** relayed Grant's "legend overlaps 4 elements" advisor question (their
  `PhyloLayoutAdvisor` collision-detection; likely a legend-bbox false-positive — awaiting them).
- **Dev servers to stop:** `:3014` (ROS-smart-search, real R2), `:3012` (ROS-fig-verify).
- **Worktrees to remove after go-live merge:** ROS-smart-search, ROS-page-boot, ROS-icon-search,
  ROS-fig-verify. Local branches `figure-page-boot-loader` + `figure-semantic-search` are
  subsumed by `figure-smart-search-A` (delete after merge). Leave the prior session's
  `ROS-fig-diagram` for Grant.

## Open / next

1. After MobileUI pushes: confirm live model/vector/ort fetches (INJEST will curl prod).
2. Smart-search A backlog (doc #2): the "no match → request/generate" fallback; favorites/recents
   tray; sub/superscript + insert-symbol in typed text.
3. Page-boot: circulate the primitive to Data Hub (DuckDB-WASM) + Phylo (layout) lanes.
4. The loader's "Why the wait?" wiki page (local-first philosophy) — NOT written; touches wiki
   content, so run `node scripts/check-wiki-coverage.mjs --ci` (note: that script itself
   MODULE_NOT_FOUND'd when run — may be broken, worth a look).
5. Optional C tuning: extend the synonym map; vague phrasings ("look at samples up close") are
   the MiniLM long-tail A is meant to cover.
