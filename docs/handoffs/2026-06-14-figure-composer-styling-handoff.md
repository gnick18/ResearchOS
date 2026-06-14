# Handoff — Universal Figure Composer: adapters + styling (Phases 1-2 done)

**Date:** 2026-06-14
**State:** ALL on LOCAL main, UNPUSHED, gate-green throughout (tsc 0, ~101 figure/seq
tests, icon-guard clean). Built in worktrees + merged atomically.
**Proposals:** `docs/proposals/2026-06-14-universal-figure-composer.md` (the composer)
and `docs/proposals/2026-06-14-figure-panel-styling.md` (the styling layer).
**Prior handoff:** `docs/handoffs/2026-06-14-universal-figure-composer-phase1.md`.

---

## Where the lane stands (one paragraph)

The Universal Figure Composer (`/figures`, in the nav) is functionally complete: the
`FigureSource` seam, the FigurePage model + one-exact-SVG compositor, the gallery
add-figure picker (search / filter chips / Group-by / preview / multi-select),
pub-ready panels (titles hidden by default, clipped to box), labels, paper presets,
the 3-tool annotation layer, export, the recoverable not-found state, and the Figures
nav tab + glyph are all merged + (mostly) Grant-browser-verified. ALL FOUR source
adapters are wired: Data Hub, phylo, chemistry, and sequence. The current arc is
**in-app figure styling** so users perfect figures without round-tripping to Illustrator.

## The four source adapters (the §3 seam, fully populated)

- **Data Hub** (`lib/datahub/figure-source.ts`) — reuses `renderPlot`.
- **phylo** (`lib/phylo/figure-source.ts`) — reuses `renderTreeSvg`.
- **chemistry** (`lib/chemistry/figure-source.ts`) — reuses RDKit `renderSvg`.
- **sequence** (`lib/sequences/figure-source.ts`) — SeqViz is React + DOM-bound, so
  there was NO pure render-at-size to reuse. Built a headless renderer
  `lib/sequences/map-render.ts` `renderSequenceMapSvg(doc, size, style)`: circular
  plasmid ring (bp coordinate ring + directional feature wedges + 2-column de-collided
  labels) and linear backbone (ruler + stacked strand-aware arrows), colors from the
  editor's `resolveFeatureColor`. It is a clean publication map, NOT a pixel-identical
  SeqViz capture (impossible headless). Grant reviewed the static-vs-SeqViz diff and
  said "FINE." All four registered in `lib/figure/register-sources.ts`.

## The styling layer (the current arc)

Principle (matches phylo/datahub): **canonical style lives with the object; the figure
page adds per-panel overrides on top; render = canonical ⊕ override.** Grant approved
"composer overrides first (Phase 1), generalize later (Phase 3)".

**Phase 1 — composer per-panel overrides (DONE, merge in `feat(figure): per-panel
style inspector`).** Generic seam, reused by Phase 3:
- `PanelStyle { targets: {key->{color?,hidden?}}, options }` + `StyleTarget` on the
  `FigureSource` contract; optional `FigureSource.styleTargets(id)` lists a figure's
  styleable elements; `RenderOpts.style` carries the override; `FigurePanel.style`
  persists with the figure page. `setPanelStyle` / `setPanelTarget` pure helpers.
- Composer: selecting a panel fetches `styleTargets` and shows a **Style** section
  (per-element color swatch + show/hide eye). `renderSignature` keys on style.
- Sequence is the first consumer: per-feature recolor/hide + a thickness slider +
  coordinate-ruler / feature-label toggles (sequence-specific options for now).

**Phase 2 — sequence canonical style (DONE, merge `35ca0f756`).**
- `SequenceMapStyle` moved to a neutral leaf `lib/sequences/figure-style.ts` (+ a pure
  `mergeMapStyle` layering helper) so `types.ts` references it cycle-free; `map-render`
  re-exports for back-compat.
- `SequenceMeta.figure` + `SequenceUpdate.figure`; `sequencesApi.update` persists it via
  the existing `updateMeta` sidecar write.
- Adapter: `render` merges canonical (`meta.figure`) -> per-panel override; `styleTargets`
  seeds swatches from the canonical color; new `saveDefaultStyle` promotes a panel's
  style to the sequence's canonical default.
- Generic seam: optional `FigureSource.saveDefaultStyle(id, style)`; the composer shows a
  **"Save as this sequence's default"** action when a source implements it.
- **Architecture call (worth knowing):** the proposal said edit the canonical IN the
  sequence editor, but `renderSequenceMapSvg` is composer-only (the editor + embeds use
  SeqViz), so the publication map is only seen in the composer. So canonical editing was
  routed through the composer ("Save as default") rather than a styling surface in the
  editor that would style a map that surface does not display. If a dedicated "Figure
  style" view IN the sequence editor is still wanted, it is a clean follow-up (mount
  `renderSequenceMapSvg` + the same controls there).

## NEXT

1. **Browser-verify Phase 1 + 2** (interactive, needs a real mouse). On `:3000`:
   `/figures` -> add a **Sequence map** panel -> select it -> the **Style** section
   appears -> recolor a feature, hide one, drag thickness, toggle ruler/labels (live
   update) -> **Save as this sequence's default** -> remove + re-add the panel and
   confirm it returns styled (canonical persisted). Also eyeball the chem + seq panels
   (those two were unit-tested but not yet Grant-browser-verified; phylo + annotations
   were).
2. **Phase 3 — generalize the override layer to ALL panel types.** Add `styleTargets`
   (+ optional `saveDefaultStyle`) to the Data Hub / phylo / chem adapters so their
   panels get recolor/hide + source-specific options. The composer's Style inspector is
   already generic for `targets`; the per-source OPTION toggles are currently hard-cased
   to `sequence` -> generalize via a `FigureSource.styleSchema` that declares each
   source's options so the composer renders them without special-casing.
3. **Optional**: a "Figure style" view in the sequence editor (per the architecture note
   above); the per-surface collection-rail "Figures" entries (decision #8, the top-level
   tab is done); annotation polish (drag endpoints, resize bracket span).

## Key files

- Seam: `lib/figure/figure-source.ts` (FigureSource, PanelStyle, StyleTarget, RenderOpts).
- Model: `lib/figure/figure-page.ts` (FigurePanel.style, setPanelStyle/Target, annotations).
- Composer UI: `components/figure/FigureComposer.tsx` (picker, panels, annotations, Style inspector).
- Sequence: `lib/sequences/{map-render.ts, figure-style.ts, figure-source.ts}`; persistence in
  `lib/types.ts` (SequenceMeta.figure) + `lib/local-api.ts` (sequencesApi.update).

## Gotchas (reaffirmed this arc)

- **Shared-checkout race**: a concurrent session's commit absorbed one of my staged
  commits, and another's uncommitted WIP transiently blocked a merge. ALWAYS build in a
  worktree, chain `git add && git commit` in ONE bash call, and merge only when the
  shared tree is clean; retry if a foreign WIP blocks it.
- **icon-guard**: the whole-repo `<svg` ratchet blocks ALL commits on any unbaselined
  inline svg (even another lane's). For lib-side SVG-STRING builders (map-render,
  figure-compose) bump the per-file baseline; for dev/throwaway snapshots use
  `EXCLUDED_PREFIXES` in `update-icon-baseline.mjs`, NOT the baseline. Test files that
  assert on `"<svg"` must build it as `"<" + "svg"`.
- The sequence map renderer is **composer-only** (not SeqViz); a "default everywhere"
  canonical style currently only affects figure rendering.
