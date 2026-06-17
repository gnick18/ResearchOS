# Orchestrator handoff, Data Hub large-table lane (2026-06-13)

This briefs an inheriting orchestrator on the Data Hub large-table arc. It is a NEW lane for the Data Hub (the Prism alternative) that lets scientists work with tables of thousands to hundreds of thousands of rows (and thousands of columns) without crashing Chrome, fully client-side on the user's own processor. Read this end to end before continuing the arc.

## The problem this solves

The existing Data Hub grid is a hand-edited, cell-versioned spreadsheet. Every cell is its own Loro CRDT key (`frontend/src/lib/loro/datahub-doc.ts`), the grid renders every row to the DOM (`DataTableGrid.tsx`, no virtualization), footer stats rescan all cells per render, analyses pull whole columns into main-thread JS arrays (`column-table.ts`), and the importers had zero size guards. Correct for 200 rows, fatal at 200,000. The fix is not to make that grid faster, it is a second lane where a big table is a dataset you query and analyze, not a spreadsheet you hand-edit.

## Locked decisions (Grant, 2026-06-13)

- **Two lanes.** Small tables stay the Loro editable grid (unchanged). Large tables become columnar datasets. Auto-trips at **~1,000 rows** (or >256 columns), AND a **manual "Switch to large-dataset mode"** control on any table (a user may want the fast lane on a medium table for speed and the rule tooling). Auto when needed, opt-in always.
- **Engine: DuckDB-WASM**, lazy, in a Web Worker, on the user's CPU. Self-hosted, no CDN.
- **On disk:** the user's ORIGINAL imported file untouched + a compact `data.parquet` working copy + a small `dataset.json` sidecar (schema, lineage, recipe). A dataset is a DIRECTORY at `users/<owner>/datahub/<id>/`.
- **Editing is rule-based, not cell-based.** A bulk edit is a predicate + action ("rows where the column is empty, set to X"; "rows where y starts with sbc, replace the first 3 chars with dog"). This REUSES the existing pandas-matched transform engine (`frontend/src/lib/datahub/transform/`), extended with a DuckDB SQL execution path. One rule reads identically small (runs in JS) or huge (compiles to SQL).
- **Derived datasets are STORED QUERIES, not copies.** DuckDB is lazy, so a transform pipeline is the recipe (kept in the sidecar, tiny, doubles as lineage). Preview windows and analyses run the recipe on demand against the on-disk source, materializing only the visible window or needed columns. Nothing caches in the browser. The full result becomes a Parquet file ONLY when the user saves (`copyQueryToParquet`). Heavy chains spill to OPFS on disk. This is how "ephemeral on a massive table without caching anything in the browser" works.
- **The validation gate stays intact (HARD).** DuckDB only MOVES data (filter, slice, partition, page, extract columns). The existing VALIDATED JS stats engine still computes every published number (a t-test pulls its two columns via DuckDB then runs the same transparency-pinned `unpairedTTest`). No statistic migrates to an unverified path.
- **Export:** one-click export of the current filtered/transformed view to CSV and Parquet.
- **GPU is NOT the mechanism** (told Grant plainly). The lever is columnar + threaded WASM on the CPU. WebGPU is a possible future plotting accelerator only; do not promise it.

Design artifacts: spec `docs/proposals/2026-06-13-datahub-large-tables.md`; approved review mockups `docs/mockups/2026-06-13-datahub-large-tables.html` (the lane) and `docs/mockups/2026-06-13-datahub-transform-builder.html` (the transform builder + wide-column tiers). Both reviewed change-by-change and fully approved.

## What is BUILT and on LOCAL main (not pushed)

All behind `NEXT_PUBLIC_DATAHUB_ENABLED` + a new `NEXT_PUBLIC_DATAHUB_BIGTABLE` (default off; Grant set both in his `frontend/.env.local`).

- **Increment 1 + 2 (foundation + preview), merge `659b0a5c1`.**
  - `frontend/src/lib/datahub/bigtable/`: `duckdb-client.ts` (lazy worker singleton: init/query/registerParquetBuffer/copyQueryToParquet/buildParquetFromRows), `dataset-store.ts` (persistDataset/readDatasetSidecar/listDatasets/nextDatasetId + atomic disk I/O), `ingest.ts` (shouldRouteToDatasetLane/ingestToDatasetLane), `dataset-view.ts` (open/page/close; `fromSource` is the single swap-point for a recipe sub-query), `types.ts` (`DatasetSidecar` with `recipe: TransformOp[]`), `detection.ts` (`LARGE_TABLE_ROW_THRESHOLD=1000`, `LARGE_TABLE_COL_THRESHOLD=256`), `config.ts` (`isBigTableEnabled()`), `column-tiers.ts`, `explainer-dismissal.ts`.
  - `frontend/src/components/datahub/bigtable/`: `DatasetView` (virtualized `@tanstack/react-virtual` grid, paged DuckDB reads, jump-to-row, render-all control), `ColumnManager` (3 tiers: chips / searchable panel / schema browser + regex column-select), `DatasetStatusChip`, `DatasetExplainerCard`, `FullRenderWarning`, `ManualSwitchControl`.
  - Detection wired into the real import path at `frontend/src/app/datahub/page.tsx` `handleImport`. `DataHubRail.tsx` gained a "Large datasets" section.
  - Vendored `frontend/public/duckdb/**` (~38MB) + `frontend/scripts/build-duckdb-bundle.mjs` (`pnpm run build:duckdb-bundle`). Deps `@duckdb/duckdb-wasm@1.29.0`, `apache-arrow@21.1.0`, `@tanstack/react-virtual`, `esbuild` (dev).
- **Increment 2a (transform builder), merge `f164467e9`.**
  - `frontend/src/lib/datahub/transform/sql-codegen.ts` (`recipeToSql` CTE chain mirroring `recipeToPandas`, + `translateDeriveFormulaToSql`).
  - `frontend/src/components/datahub/bigtable/TransformBuilder.tsx` (palette grouped by category, pipeline, live DuckDB preview, affected-row estimate, pandas + SQL code panels).
  - `dataset-view.ts` `fromSource(handle, recipe?)` runs the recipe as a sub-query; `saveRecipeAsDataset` materializes a derived dataset (kind `derived`, lineage = sourceDatasetIds + recipe).
  - `ManualSwitchControl` mounted on the editable-table toolbar.
  - Wired ops: filter, derive, sort, select, drop, rename, dedupe, groupby (pivot/unpivot/join/union compile in SQL but lack a param editor yet).

Every increment was gate-verified (tsc 0, next build 0, vitest green, icon-guard 0, DuckDB confirmed lazy) and LIVE-verified in demo mode (`/datahub?wikiCapture=1`): import a >1000-row table, paged preview, jump-to-row, the 3 column tiers (300+ col paste hits Tier C), the full-render warning, the manual switch, build a filter+derive+sort recipe with live preview + code panels, and save a derived dataset.

## IN FLIGHT

- **Phase 2b-1** (branch `feat/datahub-transform-ops-1` off `f164467e9`, a background sub-bot): the data-cleaning / "edit with code" operation set = `fillna`, `dropna`, `set-where` (conditional set), the string ops (slice / replace / extract / split / case / strip / cat), and `astype` / `to-date` / `date-parts`. Each gets a TransformOp kind + pandas codegen + DuckDB SQL codegen + JS engine execution + a param editor + a test. When it lands, MERGE it the same guarded way (see below) and dispatch 2b-2.

## REMAINING phases

- **Phase 2b-2** (next): the rest of the vocabulary. clip, round, bin/cut, map/replace, rank, cumulative, lag (shift/diff/pct_change), rolling; isin, between, top-N, sample; value_counts, describe, crosstab, pivot_table. Serialize after 2b-1 (they edit the SAME files: pipeline.ts / codegen.ts / sql-codegen.ts / engine.ts / TransformBuilder.tsx, so NO parallel batches, the cross-arc collision trap).
- **Phase 3:** analyses on datasets. Engine pulls columns via DuckDB into the validated stats engine, group partitioning, plots sample/aggregate for large N. Transparency gate held (every published stat through the validated engine or with its own pin).
- **Phase 4:** embeds (a dataset embed renders the preview, never the full grid), the one-click export-filtered-slice (CSV/Parquet), BeakerBot consume tools (coordinate with the BeakerAI lane, they consume the engine read-only, relay via Grant), and the wiki page.

## How to continue (integration discipline)

- The big-table lane is mergeable in clean increments. The shared main checkout is contended, so build in an isolated worktree off current main, then merge guarded: `git merge --no-commit --no-ff <branch>`, grep the `--cached` staged set for any file NOT in the increment's expected list (foreign bleed), then commit with `git commit -F /tmp/msg.txt`. Every datahub merge so far has been conflict-free because main never touched the bigtable files; verify that still holds with `git merge-base` + a per-file diff check before merging.
- After a merge that adds deps, run `cd frontend && pnpm install --frozen-lockfile --prefer-offline` in the MAIN checkout so Grant's `:3000` does not break on reload. Then `npx tsc --noEmit` (EXIT 0) on the integrated tree.
- Serialize Phase 2b batches and Phase 3 (shared transform/codegen/engine files). Phase 4 embeds can branch off once 2b is in.
- NOT pushed. Local main only. Push on Grant's explicit say-so.

## Gotchas (hard-won this arc)

- **DuckDB-WASM must NEVER enter Turbopack's module graph, or `next build` panics** (`chunk_group.rs:269 unreachable code`). Even a dynamic `import("@duckdb/duckdb-wasm")` panics. The working pattern: the duckdb browser ESM is pre-bundled (apache-arrow inlined, zero bare specifiers) via esbuild into `frontend/public/duckdb/duckdb-browser.bundled.mjs` (regen with `pnpm run build:duckdb-bundle`), and imported ONLY from a runtime URL string (`${origin}/duckdb/duckdb-browser.bundled.mjs` with `/* webpackIgnore: true */`); types via an erased `import type`. Anywhere duckdb is consumed, use this pattern; a normal static/dynamic bundler import reintroduces the panic.
- **No CSP change was needed.** The existing Ketcher-era tokens (`script-src 'unsafe-eval' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self'`) already cover DuckDB's Emscripten worker + same-origin asset fetches. A CSP violation in WORKER scope reads as a silent hang, not an error (it did not happen here, but watch for it).
- **Parquet is a LOADABLE extension** in duckdb-wasm 1.29.0, default-fetched from `extensions.duckdb.org` (CSP-blocked + not local-first). It is self-hosted under `frontend/public/duckdb/v1.1.1/wasm_eh/` and loaded via `SET custom_extension_repository=<origin>/duckdb; INSTALL parquet; LOAD parquet;`. Pin the extension version to the bundled DuckDB version and re-fetch on upgrade.
- **The vendored duckdb bundle goes stale silently** on a `@duckdb/duckdb-wasm` or `apache-arrow` upgrade. Re-run `pnpm run build:duckdb-bundle` (esbuild's build script is skipped on install, approve it if regenerating).
- **The ~38MB wasm asset is in the repo** (`public/duckdb/`). Accepted, same precedent as the vendored RDKit wasm.
- Per-open DuckDB buffer names must be unique, an id-stable name let a React remount's cleanup drop the buffer the new mount registered ("No files found"). Fixed with a per-open suffix.

## Caveats for Grant's `:3000` test

- **Real-folder Parquet write is not yet verified.** Every live check ran in demo mode's in-memory blob store. Grant's import against a REAL connected folder is the first true exercise of the FSA Parquet write path (it goes through the atomic `fileService` primitives, which are well-tested, and the store has unit tests, but the end-to-end real-folder write has not run).
- The `next build` "failure" seen in sub-bot reports is a pre-existing unrelated prod guard (`NEXT_PUBLIC_COLLAB_RELAY_URL` unset with the Loro pilot on); it clears when the env var is set (the real build env sets it).

## Memory pointer

`~/.claude/.../memory/project_datahub_large_tables.md` carries the running state (decisions, commits, phase status, the DuckDB pattern).
