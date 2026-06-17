# Data Hub, large tables (the big-dataset lane)

Status: design, approved in concept 2026-06-13 (review mockup `docs/mockups/2026-06-13-datahub-large-tables.html`, all 7 changes approved). This doc is the buildable spec. House voice applies (no em-dashes, no emojis, no mid-sentence colons).

## 1. The problem

The Data Hub grid is a hand-edited, cell-versioned spreadsheet. Every cell is its own Loro CRDT key (`rows` is a list of per-cell `LoroMap`s, `frontend/src/lib/loro/datahub-doc.ts`), the grid renders every row to the DOM (`DataTableGrid.tsx`, no virtualization), footer stats rescan all cells each render, analyses pull whole columns into main-thread JS arrays (`columnValues` in `column-table.ts`), and the importers have no size guards. That model is correct for a 200-row table and fatal at 200,000. We need a second lane for tables that are queried and analyzed rather than hand-edited cell by cell.

Scientists routinely work with tables of thousands to hundreds of thousands of rows, sometimes with thousands of columns. They already drop to code for this. The goal is to make the Data Hub a place they can do that work, fully local, on their own processor, without crashing Chrome.

## 2. The lane model

Two storage-and-compute lanes for one feature.

- **Editable lane (today, unchanged).** Loro cell-level CRDT, hand-editable grid, footer stats, collaboration. Default for small tables.
- **Dataset lane (new).** Columnar file on disk, queried by a background engine, virtualized preview, rule-based editing, analyses. No per-cell editing.

How a table enters the dataset lane:

1. **Automatic, on import.** During parsing, the moment a table crosses the size threshold, it goes straight to the dataset lane before a single row reaches the cell store. One-time explainer card (mockup change 1), then the quiet status chip (change 2).
2. **Manual, on any table (Grant, 2026-06-13).** The dataset lane is also a feature people want on purpose, for speed and the rule-based tooling, even on a medium table. So any table carries a "Switch to large-dataset mode" control. Clicking it warns that the switch takes a few seconds to load and not to refresh, then converts. Auto-trip is the safety net, the manual switch is the opt-in.

Reversibility. A table under the threshold can switch back to the editable lane (it fits in memory). A table over the threshold cannot return to cell editing (the warning at switch time says so). Switching back re-materializes the columnar data into the Loro cell store.

## 3. On-disk shape (data-shape change, flagged)

A dataset lives at `users/<owner>/datahub/<id>/`:

- `<original-filename>.csv` / `.xlsx` etc. The user's original import, untouched. A research record, never silently rewritten. Absent for pasted or derived data.
- `data.parquet`. Compact columnar working copy the engine queries. Parquet stores the table column by column and compressed, so a 60 MB CSV is a few MB and the engine reads only the columns an analysis needs. Derived datasets (transform outputs) are stored here too.
- `dataset.json`. Small sidecar holding schema (column names, types, null counts, sample values), lineage (source file, transform recipe that produced this dataset), saved analyses, and the stored rule pipeline. This is the only file the list API needs to open, mirroring how the editable lane keeps a `.json` mirror beside the `.loro`.

Everything is on the user's disk. Nothing sits as a multi-gigabyte blob in browser cache. For datasets larger than RAM, the engine spills to OPFS, still on-device.

## 4. The engine (DuckDB-WASM, lazy)

- **DuckDB-WASM** (MIT), loaded lazily in a Web Worker the first time a dataset opens, the same pattern as the RDKit and Pyodide kernels. Columnar SQL engine, SIMD plus multithreading, reads Parquet directly, pages with `LIMIT/OFFSET`, spills to OPFS. Zero cost to the editable lane (the worker and wasm never load for a small table).
- **Apache Arrow** (Apache-2.0) for result interchange. DuckDB returns Arrow batches, the preview grid renders from them.
- **Off the main thread.** All scanning, filtering, slicing, and column extraction run in the worker. The UI thread only ever handles the visible window plus small result sets.

On GPU. The lever is columnar plus threaded WASM on the CPU, not GPU. Browser GPU compute means WebGPU, which DuckDB does not use and which we will not promise. WebGPU stays a possible future accelerator for plotting millions of points, nothing more.

### The validation gate stays intact (hard rule)

DuckDB only **moves data**, it never computes a statistic that ships to the user. Filter, slice, partition groups, page, extract columns. Every published number stays on the existing validated JS engine with its transparency pin. A t-test on 247,000 rows runs as a DuckDB query that pulls the two columns (a column of 247k doubles is roughly 2 MB) and hands the arrays to the same `unpairedTTest` that is pinned vs scipy today. Descriptive previews (a quick group mean shown in the grid footer) may use DuckDB aggregation, but any number that is published, exported, or embedded routes through the validated engine, or gets its own transparency pin before it ships. No stat migrates to an unverified path.

## 5. Rendering and the wide-column tiers (mockup change 3, refined)

Row rendering is virtualized (`@tanstack/react-virtual`), first ~100 rows fetched from the engine, paged on scroll, plus a jump-to-row box. Only the visible window is ever in the DOM.

Columns scale in tiers, because the chip picker does not survive thousands of columns (Grant, 2026-06-13):

- **Tier A, up to ~30 columns.** Inline chip column-picker (as in the mockup).
- **Tier B, dozens to a few hundred.** A searchable column panel. Filter box, group by type, select all or none, checkboxes. The grid previews the selected subset.
- **Tier C, thousands of columns.** No grid is rendered by default. We show a **schema browser** first (column name, type, percent null, a sample value), and the user explicitly picks a handful of columns to preview. Crucially, columns can be **selected by rule** (a name pattern, for example keep `^expr_` or drop `*_raw`), which is the wide-table mirror of the row rules in section 6. Hand-picking from thousands is infeasible, so pattern selection is the primary tool.

## 6. The operation vocabulary (mockup change 4, fleshed out)

The "edit with code" bulk editor is not a new system. The Data Hub already has a transform engine (`frontend/src/lib/datahub/transform/`) that is **pandas-matched by design** and ships a **pandas code generator** (`codegen.ts`), built on the one shared expression language (the Custom Calculator Builder's `expr-eval-fork` parser, reused so the app has ONE formula language). The dataset lane reuses that exact `TransformOp[]` recipe and adds two things, a **DuckDB SQL execution path** beside the existing JS engine, and a **SQL code generator** beside the existing pandas one (so show-the-code offers both pandas and SQL).

A bulk edit is a pipeline of ops. Each op is one verb plus params, previewed live on the sample with an estimated affected-row count, and reflected in the generated code. The same recipe runs in JS for a small table or compiles to one DuckDB query for a huge one. The "rows where the column is empty, set to X" and "rows where y starts with sbc, replace the first three characters with dog" examples are a filter plus a string op, both below.

### Already in the engine (reuse verbatim)

`filter` (pandas query semantics), `select` (keep columns), `drop`, `rename`, `sort`, `dedupe`, `union`, `join` (merge), `groupby` (named aggregations), `derive` (computed column via the shared expression language), `pivot`, `unpivot` (melt), plus the column transforms (`column-transform`, `normalize`, `transpose`, `remove-baseline`, `fraction-of-total`).

### To add (the pandas coverage gap C4 asks for)

Organized by pandas surface, each maps cleanly to DuckDB SQL and to a one-line pandas expression for show-the-code.

- **Missing data.** `fillna` (constant, forward-fill, back-fill, column mean or median), `dropna` (rows null in any or all selected columns), `interpolate` (numeric).
- **Conditional set (the headline edit).** Set a column to a value (or an expression) where a predicate holds, the pandas `.loc[mask] = ...` / `np.where` / SQL `CASE WHEN`. Covers "set empty cells to X" and arbitrary if-elif-else columns.
- **String ops (the `str` accessor).** `slice` (covers replace-first-N-chars), `replace` (literal or regex), `extract` (regex group to new column), `split` (to multiple columns), `upper` / `lower` / `title`, `strip` / `lstrip` / `rstrip`, `pad` / `zfill`, `len`, `cat` (concatenate columns with a separator), `contains` / `startswith` / `endswith` as filter predicates.
- **Type and schema.** `astype` (cast to number, text, date, boolean, category), `to_datetime` (parse) plus datetime extract (year, month, day, weekday, hour), column reorder.
- **Derived and windowed.** `clip` (bound to min/max), `round`, `bin` / `cut` (fixed or quantile bins to categories), `map` / `replace` (lookup dictionary), `rank`, cumulative (`cumsum`, `cummax`), `shift` / `diff` / `pct_change` (lag), `rolling` (window mean or sum over N, needs an order key), row-wise aggregate across selected columns.
- **Row selection helpers.** `isin` / not-in, `between`, top-N or bottom-N (`nlargest` / `nsmallest`), random `sample` (n or fraction).
- **Reshape and summarize.** `groupby` + agg (sum, mean, median, min, max, count, nunique, std), `value_counts`, `describe`, `crosstab`, `pivot_table`. These produce a new small table that flows into analyses and plots.
- **Combine.** `merge` / `join` (inner, left, right, outer on a key), `concat` (stack rows).

Hard-at-scale notes. Full `transpose` and very wide `pivot` can explode column counts, so they prompt before running on a large dataset. Everything else is a straightforward DuckDB query.

Each op carries a plain-language description, a live preview on the sample, an affected-row estimate, and the generated pandas plus SQL. A pipeline's output is a stored query (the recipe), not a materialized copy, run on demand against the source and materialized to a Parquet file only when the user saves (see section 9). The recipe is the lineage.

## 7. The UX surfaces

- **Explainer card** (change 1), once per dataset, calm, states large plus local plus previewed.
- **Status chip** (change 2), persistent, quiet, hover and click reopen the explainer.
- **Manual switch** (change 1 refined), on any table, warns about load time and refresh.
- **Full-render warning** (change 6), no soft-lock. Clicking "render all rows" explains the browser cannot draw that many, points at the file on disk and at external apps, and keeps preview, jump-to-row, filter, transform, and analyze alive.

## 8. Phasing

- **Phase 0.** Dependencies plus flag plus lane scaffold. Add `duckdb-wasm` (lazy worker), `apache-arrow`, `@tanstack/react-virtual`. Bundle-weight check (lazy-loaded, so first-load JS unchanged). New dataset object type plus the on-disk shape (section 3). Detection at import (threshold) plus the manual switch.
- **Phase 1.** Ingest plus virtualized preview plus status chip plus explainer plus the three wide-column tiers plus jump-to-row plus the full-render warning. End state, a user can import or paste a huge table and browse it safely.
- **Phase 2.** The operation builder (section 6), executing in DuckDB, reusing the TransformOp recipe, adding the SQL codegen and the gap ops, with show-the-code parity. Derived datasets plus lineage.
- **Phase 3.** Analyses on datasets. Engine pulls columns via DuckDB into the validated stats engine, group partitioning, plots sample or aggregate for large N. Transparency gate held throughout.
- **Phase 4.** Embeds (a dataset embed renders the preview, never the full grid), BeakerBot consume tools (coordinate with the BeakerAI lane, they consume our engine read-only), the wiki page, and one-click export of a filtered slice to CSV or Parquet.

## 9. Decisions (locked 2026-06-13)

- **Threshold.** Roughly 1,000 rows (Grant chose lower, to push most non-trivial tables into the fast lane by default). Tunable, and the manual switch covers anyone who wants either lane regardless.
- **Derived datasets are stored queries, not copies (the key one).** A transform pipeline is the recipe (SQL / TransformOp list), kept in the sidecar (tiny, and it doubles as lineage). DuckDB is lazy, so preview windows and analyses run the recipe on demand against the on-disk source Parquet, materializing only the visible window or the needed columns. Nothing caches in the browser. The full transformed result only becomes a Parquet file on disk when the user names and saves it (`COPY (query) TO`, streamed to disk). Heavy chains (large sort, join, aggregation) still make DuckDB process the whole source per page, but it spills to OPFS on disk and returns only the window. A rare intermediate pinned for speed goes to a temp Parquet on disk, auto-cleaned on cancel or close, never browser cache. This is how "ephemeral on a massive table without caching anything in the browser" actually works (Grant's question, 2026-06-13).
- **Export filtered slice.** Yes. A one-click "export this view as CSV or Parquet" writes the current filtered or transformed result for handing a slice to R, Python, or a spreadsheet.

## 10. Coordination and dependencies

- **BeakerAI lane** owns `lib/ai/tools/*` and consumes our engine read-only. New dataset query and transform surfaces become consume-only tools for them later, relayed via Grant.
- **Embeds** render a dataset as a preview card, never a full grid.
- **Dependencies.** `duckdb-wasm`, `apache-arrow`, `@tanstack/react-virtual`. All lazy or preview-only, so per the bundle-weight trap the small-table first-load is unchanged. Confirm with a `next build` size delta in Phase 0.
- **Flag.** Reuses `NEXT_PUBLIC_DATAHUB_ENABLED`, the dataset lane behind an internal sub-capability until verified.
