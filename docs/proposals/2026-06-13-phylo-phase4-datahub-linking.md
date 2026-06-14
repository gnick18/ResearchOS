# Phylo Phase 4: true Data Hub linking (any category-axis plot aligned to tips)

Status: DRAFT / planning. Approved direction (Grant, 2026-06-13): "wire true
Data Hub linking". Build is GATED on the seam agreement with the Data optimizer
lane (they own `lib/datahub/`); coordination message sent. No code until the
seam is confirmed. This doc is the build-spec so the work is teed up.

No em-dashes, no emojis.

## Goal

The ggtree-class viz doc (`2026-06-13-phylo-ggtree-class-viz.md`) named Phase 2
"link real Data Hub plots (aplot / geom_facet)": inject the tree's tip order +
positions into the Data Hub plot renderer so a real Data Hub plot renders as a
tip-aligned panel. The shipped Phase 2 instead re-implemented three stat geoms
(violin, point+error, scatter) phylo-side to keep the lanes decoupled. So the
actual "any Data Hub plot hangs off the tips" capability was never built. This
phase builds it: ONE injection point in the Data Hub geometry layer, plus a
phylo-side adapter, so category-axis plot kinds align to tips for free instead
of being hand-ported one geom at a time.

## Honest scope (this is NOT literally all 13 plot kinds)

`renderPlot()` returns one of SEVEN geometry families. Only the families whose
category axis is "one value or distribution per row" map to "one per tip". The
relationship / curve / diagnostic families do not (they are one figure per
dataset, not per tip).

Data Hub `PlotKind` mapped to tip-alignment (CORRECTED 2026-06-13 after checking
the renderers; the first draft mis-mapped `stackedBar`):

- THE TRAP: Data Hub `stackedBar` is the parts-of-whole renderer = a SINGLE
  100-percent column showing the composition of ONE whole. It has no category
  axis to align, so it does NOT fit the alignedAxis seam. The phylo "microbiome
  ring" is the opposite figure: ONE stacked bar PER TIP (N stacked bars on a
  category axis). So the headline ring is NOT parts-of-whole; it is the
  column/bar path. Same for `pie` / `donut` (parts-of-whole, one whole).
- Maps per-tip AND is a NEW capability (the real prize):
  - `groupedBar` -> a real category axis (groups) with multiple series per group;
    category = tips gives multiple bars per tip. The genuine new win. BUT it is
    DODGE ONLY today (no stack mode; stacking lives only in parts-of-whole). The
    iconic stacked-per-tip ring therefore needs a STACK / 100-percent position
    mode added to groupedBar (a Data Hub engine change), after which the SAME
    seam delivers both dodge and stacked per-tip.
- Maps per-tip but we ALREADY have a native phylo panel (do NOT duplicate):
  - `columnBar` ~= native `bars` / `point` (point+error).
  - `columnScatter` ~= native `scatter` / `dots`.
  - distributions ~= native `box` / `violin`.
- Does NOT map per-tip (leave out of scope; one figure per dataset):
  - `xyScatter`, `survivalCurve`, `estimationGardnerAltman` / `estimationCumming`,
    `qqPlot` / `residualPlot` / `rocCurve`, and (per the trap above) the
    parts-of-whole `pie` / `donut` / `stackedBar`.

So the deliverable is grouped bars at the tips (dodge first), then stacked /
100-percent bars per tip once groupedBar gains a stack mode (the microbiome ring).
The seam reaches the COLUMN/BAR geometry path (`PlotGeometry` /
`GroupedBarGeometry`), never the parts-of-whole renderer. Future category-axis
kinds are then free.

## The seam (the question out to the Data optimizer lane)

`renderPlotSvg(geo, style)` (plot-spec.ts ~1223) draws from a precomputed
geometry; the category axis order + positions live in the geometry, built by the
per-family geometry builders, not in the SVG drawer. So the injection belongs in
the geometry builders for the category-axis families (the `PlotGeometry` /
`GroupedBarGeometry` / `PartsOfWholeGeometry` paths), not in `renderPlotSvg`.

Proposed contract (additive, back-compat, no fork):

```
alignedAxis?: {
  order: string[];          // category/row ids in tree-tip order
  positions: number[];      // tip center per id (px for rectangular, angle for circular)
  band: number;             // per-tip band height (px) or angular width
  orientation: "rows" | "angles";
}
```

When present, the geometry builder uses `order` + `positions` + `band` for the
category axis and skips its own sort + even-spacing. When absent, byte-identical
to today. Threaded through `renderPlot(spec, content, analysis, opts?)` as
`opts.alignedAxis`.

OPEN (asked the Data optimizer lane):
1. Do they own the datahub-side change (their engine) while phylo owns the
   adapter + panel kind, or do they want phylo to add the optional param under
   review.
2. Is the per-family geometry builder the right injection point, or would they
   rather expose a dedicated aligned-geometry entry.
3. Exact signature / naming preference.

## Phylo side (this lane owns it regardless)

1. Adapter `lib/phylo/datahub-panel.ts` (new): given a `TipAxis`
   (layout.ts, already exposes per-tip slots + layout + band/ring geometry) and a
   per-tip table (tip id -> the value columns), build the `alignedAxis` and a
   minimal `PlotSpec` for the chosen kind, call `renderPlot(..., {alignedAxis})`,
   and return the SVG string + its measured thickness.
2. New `AlignedPanelKind`: `"datahubPlot"` with `options` = `{ plotKind:
   "groupedBar", barMode: "dodge" | "stack" | "stack100", valueColumns:
   string[], paletteId?: string }`. v1 plotKind is `groupedBar` only (the
   column/bar geometry the seam reaches); `barMode` maps straight to the Data Hub
   `style.barMode` the Data optimizer lane is adding (Commit 2): `dodge` = 4a,
   `stack` (absolute) + `stack100` (100-percent normalized, the microbiome ring)
   = 4b. Stored on the figure spec like every other panel (additive, back-compat).
3. `panel-render.ts` `renderPanel`: for the `datahubPlot` kind, call the adapter
   and place the returned SVG as a ring (circular) / column (rectangular) against
   the `TipAxis`, same as every native panel. Per-tip band already known.
4. Per-tip data shape: stacked / grouped / pie need MULTIPLE metadata columns per
   tip (one per series / segment). Reuse the click-driven `MultiColumnField`
   (just rebuilt) to pick the value columns; reuse Data Hub palettes
   (`lib/datahub/palettes.ts`) for series colors, READ-ONLY.

## UI

- Add-panel catalog (`PANEL_CATALOG`): a "Data panels" group with "Stacked bar",
  "Grouped bar", and "Pie / donut".
- Inspector: the multi-column value picker + a palette pick + a normalize toggle
  (100 percent stacked) + legend on/off. Mirrors the existing panel inspectors.

## ggtree-code export

Extend `ggtree-code.ts` to emit the `ggtreeExtra::geom_fruit()` equivalent:
`geom_fruit(geom = geom_col, mapping = aes(y = tip, x = value, fill = series),
position = "stack")` for stacked, `position = "dodge"` for grouped. Pie/donut at
tips has no clean geom_fruit form, so emit a commented note rather than wrong
code (keep the export honest, per the standing phylo rule).

## Phasing

- 4a: the Data Hub seam (Data optimizer) + the phylo adapter + `groupedBar`
  (DODGE) tip-aligned, RECTANGULAR, with a legend. Real new capability, no new
  geometry, just the seam. Unblocks me as soon as the seam lands.
- 4b: the STACKED / 100-percent per-tip ring (the iconic microbiome figure), once
  groupedBar gains a stack position mode (Data Hub engine change). Same seam +
  adapter, one new mode.
- 4c: ggtree-code export (`geom_fruit(geom = geom_col, position = "stack"|"dodge")`)
  + reseed the HMP demo with a genuine rectangular multi-panel figure (tip points
  by phylum + an abundance stacked-bar panel by body site).
- Fast-follow (separate, co-designed): CIRCULAR rings. Needs a real polar render
  mode in the engine OR a phylo-native ring re-render. No SVG-warping. Out of v1.

## Edge cases / notes

- Circular: stacked bar becomes stacked radial segments per tip wedge; pie at a
  tip is tiny in circular, flag it as rectangular-favored.
- Missing per-tip values: render an empty band slot, do not drop the tip.
- Legends: reuse the existing multi-panel legend collection (continuous +
  categorical already composited in render.ts).
- Validation gate: the numbers come from the metadata table verbatim (no stat),
  so this is descriptive and gate-exempt like parts-of-whole, but the Data Hub
  palette + scale reuse must stay READ-ONLY (no `lib/datahub/` fork phylo-side).
- Cross-lane: the artboard (Data optimizer) wraps the whole figure and is
  orthogonal; these panels render inside `renderTreeSvg` and flow through the
  artboard unchanged.
