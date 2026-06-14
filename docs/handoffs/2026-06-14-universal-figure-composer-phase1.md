# Handoff — Universal Figure Composer, Phase 1 (seam + Data Hub panels + UI)

**Date:** 2026-06-14
**State:** MERGED to LOCAL main `80c9a0eb4` (merge of `b050cb706`). Purely additive
(new files + two new routes; `/figures` is NOT in nav). tsc 0, 42 figure-composer
tests pass. NOT browser-verified yet — that is the next agent's first job with Grant.
**Proposal + decisions:** `docs/proposals/2026-06-14-universal-figure-composer.md`
(sections 14 = decisions locked, 15 = build status).

---

## Where this picks up

The prior session built phase 1, ran the gate (tsc 0, 42 tests), committed
`b050cb706`, confirmed the merge-tree was CLEAN (additive only), and merged to main
`80c9a0eb4` so it would be live on Grant's `:3000` (which runs main). It then removed
the `figure-composer-phase1` worktree. The session hit its token/usage limit at exactly
that point, so the **AGENTS.md update + this handoff were the last asks and are what
this takeover completes.** No code was left half-written; HEAD is clean at `80c9a0eb4`.

Grant's words: *"i'll pick up on this test with the next agent."* → **the immediate
next step is the live end-to-end dogfood of the composer on `:3000`.**

---

## What Phase 1 is

The app-level **Figure-page composer**: assemble multiple plots/figures from any
surface onto one publication page and export it as a single exact-units SVG. It is the
universal cousin of the per-figure "Page artboard" (one figure on a page) — a Figure
page is a separate, multi-panel document and must stay a distinct object (do NOT merge
the two, see proposal §13).

### The seam (the part other lanes will plug into)

- `frontend/src/lib/figure/figure-source.ts` — the **`FigureSource` registry**. Any
  surface (Data Hub, phylo, sequences, chemistry) registers a source that can (a) list
  its available figures and (b) `render(id, sizeInRealUnits, theme)` to an SVG, returning
  `missing` instead of crashing when a referenced figure is gone. **This contract is the
  thing to keep stable** — churning it churns every downstream lane (proposal §13).
- `frontend/src/lib/figure/register-sources.ts` — the ONE place that registers every
  source. Today it registers only Data Hub; **phylo/sequence/chemistry add one line here
  as their adapter lands.**

### The model + compositor (pure, unit-tested)

- `frontend/src/lib/figure/figure-page.ts` — the `FigurePage` doc + pure layout helpers:
  label styles (ABC / abc / 123 / none, user-pickable per page), reading-order, snap-to-grid
  (align-positions vs resize-to-cells), panel ops.
- `frontend/src/lib/figure/figure-compose.ts` — composites N panel SVGs into ONE
  exact-real-units page SVG (the export artifact).
- Tests: `figure-page.ts` helpers + `figure-compose.ts` covered in
  `frontend/src/lib/figure/__tests__/figure-composer.test.ts` (+ `figure-page-store.test.ts`).

### Storage

- `frontend/src/lib/figure/figure-page-store.ts` — a `figures` entity persisted as plain
  JSON (`createFigurePageDoc`, `listFigurePages`, load/save). Phase-1 storage commit was
  `9982d3f7c`.

### The Data Hub adapter (first concrete source)

- `frontend/src/lib/datahub/figure-source.ts` — wraps the existing Data Hub `renderPlot`
  + `PlotSpec.id` so **every Data Hub plot becomes a composable panel via the same
  render path** (no new rendering engine). Tests in `__tests__/figure-source.test.ts`.
  This is the read-only reuse of Data Hub primitives (do not inject figure logic into the
  Data Hub renderer — same discipline the phylo lane followed).

### The UI + routes

- `frontend/src/components/figure/FigureComposer.tsx` (432 lines) — the composer surface.
- `frontend/src/app/figures/page.tsx` — Figures home (list + "New figure").
- `frontend/src/app/figures/[id]/page.tsx` — opens a page in `FigureComposer`.
- **Nav:** `/figures` is reachable by URL only; it is intentionally NOT in the nav bar yet
  (the Figures-home / collection-rail IA is a deliberate next step, see below).

---

## Decisions already locked (proposal §14, Grant 2026-06-14)

1. Panel labels USER-PICKABLE per page (ABC / abc / 123 / none), not a fixed default.
2. Layout: free drag by default + a "Snap to grid" button, with UNDO.
3. Annotations: 3 combined tools — Text; Arrow with 0/1/2 head toggle (= line); Bracket
   with label (= significance) — each with a hover tooltip.
4. Panel sizing: each independent; "Snap to grid" asks resize-to-cells vs align-only.
5. Add figures: cross-source picker.
6. Scope: UNIVERSAL seam now, Data Hub panels first.
7. Live reference + optional per-panel overrides (hide title/legend).
8. Access: a "Figures" top-level home AND per-surface collection-rail entries.
9. Build order after Data Hub: **phylo adapter next** (flexible).

---

## NEXT (in order)

1. **LIVE DOGFOOD on `:3000` (the test Grant is waiting to run with you).** Open
   `/figures` → New figure → add Data Hub plot panels via the cross-source picker →
   drag/arrange → snap-to-grid → set panel labels → export the single SVG and confirm it
   is exact-real-units and theme-consistent. This needs Grant's browser (real mouse for
   drag; synthetic events miss drag thresholds — see memory
   `feedback_mouse_testing_via_chrome_extension`). Capture findings, fix anything live.
2. **Figures-home / rail nav IA** — surface `/figures` (top-level home + per-surface
   collection-rail entries per decision #8). Reuse the shared `SplitShell` + collection-rail
   pattern the data pages already use (see `project_phylo_v3_unified_rail`).
3. **Annotation-placement UI** — wire the 3 annotation tools (decision #3) into the canvas.
4. **More adapters via the §3 contract** — phylo first (decision #9), then sequence /
   chemistry. Each is one `register…FigureSource()` line in `register-sources.ts` + a
   `lib/<surface>/figure-source.ts`. Confirm seq + chem can render-at-real-size (the
   artboard work already made Data Hub + phylo size in real units; proposal §13 flags this
   as the open risk for seq/chem).

---

## Gotchas / discipline

- **Shared main checkout is contended.** Build in an isolated worktree, then merge atomically
  (`git merge --no-ff <branch> -m …` in ONE bash call) — never leave a turn-length gap
  between `git merge --no-commit` and `git commit`, a concurrent session's commit resets the
  index. (Memory `feedback_integrate_from_worktree`, `feedback_shared_manifest_race`.)
- **Worktree node_modules** must be a COW copy (`cp -c -R`), not a symlink, or Turbopack/next
  dev breaks (memory `reference_worktree_node_modules_cow`).
- Run vitest/tsc from `frontend/` (the `@` alias lives in `frontend/vitest.config.mts`).
- Keep the per-figure "Page artboard" (single figure on a page) byte-identical; a one-panel
  Figure page and a single-figure artboard look alike but are different objects (proposal §13).
- The composed page is ONE SVG document → all panels must render in a consistent theme; the
  page sets light/dark and passes it to each `render` (proposal §13).

Memory to consult: `project_plot_artboard` (the shared real-units artboard this builds on),
`project_data_hub` / `project_datahub_v2_stats` (the Data Hub plot source),
`project_phylo_v3_unified_rail` (the rail pattern for the nav IA step).
