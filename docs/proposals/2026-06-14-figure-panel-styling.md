# Figure panel styling — make publication figures in-app (no Illustrator round-trip)

**Date:** 2026-06-14
**Status:** PROPOSAL, awaiting Grant's sign-off before build.
**Origin:** Grant, on the sequence map adapter — "the static render is FINE, but we
need tools to adjust the plot itself (colors, width, thickness, hide a feature...).
A full build-out of a seq svg editor to make pub-quality versions, otherwise we're
forcing them to export the SVG to another app to perfect and reimport."

---

## 1. The problem

A composed figure panel renders from the source's own renderer (Data Hub
`renderPlot`, phylo `renderTreeSvg`, chem `renderSvg`, sequence `renderSequenceMapSvg`).
Today the user can place, size, label, and annotate panels, but cannot restyle the
*content* of a panel (recolor a feature, hide one, thicken blocks, drop the legend).
So to make a figure publication-ready they export the SVG and finish it in Illustrator
or Inkscape, then have a static file they can't edit again. That breaks the whole
promise of "make the figure in ResearchOS."

## 2. The principle (how the system already works)

Two distinct concerns, and the existing surfaces already split them this way:

1. **Canonical figure style** — the object's *official* look, saved WITH the object in
   its own surface. Phylo: `PhyloFigureSpec` saved in Tree Studio. Data Hub: the plot's
   style saved with the plot. This canonical style is what shows in embeds, on the
   object's own page, and is the *starting point* when the object is dropped into a figure.
2. **Figure-local overrides** — tweaks specific to ONE figure panel, non-destructive,
   stored on the panel, never mutating the source object. The composer already does this
   for `hideTitle` / `hideLegend` via `FigurePanel.overrides`.

**So the answer to "source surface OR figure page" is BOTH, layered:**

```
panel render style  =  object's canonical spec   (from the source surface)
                       ⊕  this panel's overrides  (from the composer)
```

This is consistent with phylo/datahub today and non-surprising.

## 3. What each surface owns

| Surface | Owns | Persists in | Status |
|---------|------|-------------|--------|
| Source surface (Tree Studio; Data Hub palette; **a NEW sequence figure-style panel**) | the object's CANONICAL figure style | with the object | phylo/datahub DONE; **sequence is the gap** |
| Figure composer | per-panel OVERRIDES on top, figure-local | with the figure page (`FigurePanel.overrides`/`style`) | `hideTitle` exists; needs the general style override |

Trees + plots already have a canonical-style surface, so for them this proposal is just
the composer override layer. **Sequence needs its canonical-style surface built** (a
lightweight "figure style" mode in the sequence editor, the seq analogue of Tree Studio's
style controls) AND the override layer. The renderer groundwork is already done:
`renderSequenceMapSvg(doc, size, style: SequenceMapStyle)` with per-feature color/hide,
`featureScale`, `showTicks`, `showLabels` (merged 2026-06-14).

## 4. The seam (small, generic, reused)

- Add an optional `style?: Record<string, unknown>` to `FigurePanel` and to `RenderOpts`.
  The composer passes `panel.style` into `source.render()`. Each source interprets its own
  style shape (sequence reads it as a partial `SequenceMapStyle`; a Data Hub panel could
  later read recolor/legend toggles; etc.). The seam stays surface-agnostic.
- The adapter MERGES canonical ⊕ override: e.g. the sequence adapter loads the object's
  saved canonical style, then deep-merges the panel override before calling the renderer.
- **One shared control component** (`SequenceMapStyleEditor`, pure props -> a
  `SequenceMapStyle`) is rendered in BOTH the sequence surface (writes the canonical spec)
  and the composer panel inspector (writes `panel.style`). Build the controls once.

## 5. Control set (sequence v1)

- **Feature list**: each feature row = color swatch (recolor) + eye toggle (hide from the
  figure). Keyed by `featureKey(f)`.
- **Block thickness** slider (`featureScale`).
- **Coordinate ring** toggle; **labels** toggle.
- **Topology**: respect the sequence's own circular/linear; optional "force linear" later.
- Later: label font size, backbone color, drag-to-reposition labels, GC-content ring,
  restriction-site track, per-feature label show/hide.

## 6. How the composer surfaces it

When a panel is selected, the right rail shows a "Panel style" section driven by the
panel's `source.type`. v1 special-cases `sequence` -> `SequenceMapStyleEditor`. A later
generalization: a `FigureSource.styleSchema` so any source declares its controls and the
composer renders them generically (so chem/datahub/phylo panels get override controls too,
without the composer hard-coding each).

## 7. Phasing

1. **Composer per-panel override (generic seam) + the shared `SequenceMapStyleEditor`** in
   the composer panel inspector. Delivers Grant's core need (perfect the figure in-app)
   fastest. Style saves with the figure page. [Smallest shippable slice.]
2. **Sequence canonical figure-style surface** — the same editor mounted in the sequence
   editor, writing a saved `SequenceMapStyle` on the sequence (a `figure` field on
   `SequenceMeta`, mirroring phylo's `meta.figure`). The adapter then starts from the saved
   canonical style. [Fills the sequence gap; makes the style portable to embeds + the
   object page.]
3. **Generalize the override layer** to other panel types via `FigureSource.styleSchema`
   (Data Hub recolor/legend, phylo branch width, chem bond style). [The universal payoff.]
4. **Depth**: label drag-reposition, GC ring, restriction sites, more controls.

## 8. Open decisions (for Grant)

1. **Build order**: Phase 1 first (composer override, fastest visible win), or Phase 2
   first (sequence canonical surface, more "correct")? Recommend Phase 1 -> 2.
2. **Sequence canonical surface home**: a tab/mode inside the existing sequence editor, or
   a dedicated "Sequence Studio" like Tree Studio? Recommend a mode in the existing editor
   (lighter; the map already renders there).
3. **Override scope**: do per-panel overrides also offer a "push these back to the object's
   canonical style" button (promote figure tweaks to the saved default)? Recommend yes,
   later (Phase 2+).
4. **Color picker**: reuse an existing swatch/picker component if one exists, else a small
   native `<input type=color>` + a preset palette. Confirm there's a house color picker.
