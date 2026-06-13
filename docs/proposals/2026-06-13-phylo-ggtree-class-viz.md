# Tree Studio to ggtree-class: aligned data panels powered by Data Hub

2026-06-13, design proposal. The goal Grant set: the /phylo Tree Studio should do
ALL of what ggtree + ggtreeExtra + aplot can do, the genuinely complicated
publication figures where arbitrary data panels align to the tree by tip, not the
iTOL-level "color a tip" easy stuff. We are unusually well-positioned for this
because we already built the Data Hub, a publication-grade plotting engine. The
play is to make the tree a shared tip-ordering axis that Data Hub panels align to.

## Where we are today (honest baseline)

The Studio renderer (`lib/phylo/render.ts`) draws: tip labels, tip points
(categorical color), one color strip (one categorical column), one bar chart (one
numeric column, rectangular only), a heatmap (N columns but BINARY on/off, not
value gradients, rectangular only), clade highlights, and support values. Color is
a fixed 8-entry categorical palette. There are NO continuous color scales, NO
legends, and circular layout only draws points, strip, and labels. There is one
category column and one bar column, and no way to stack arbitrary aligned panels
or to attach a real plot (a distribution, a scatter, a boxplot) to the tips.

That is iTOL territory. It colors tips and adds a couple of aligned columns. It is
not ggtree.

The demo seed carries varied metadata (Candida auris has numeric lat/long/year
plus categorical clade/country plus resistance calls; HMP has categorical phylum
plus numeric abundance), but the seeded FIGURES under-use it: Candida shows a clade
strip and a 3-column BINARY resistance heatmap, and for HMP we committed the full
ggtreeExtra dataset (tippoint + ringheatmap + barplot) yet the seed wires only the
tip points. We seeded the data for a fancy figure and did not render it.

## The target (what ggtree actually does)

From the ggtree manual (treedata-book ch. 10) and the wider suite:

- `ggtreeExtra::geom_fruit()` re-orders any dataset by the tree structure and
  aligns an arbitrary ggplot geom to the tips: boxplot, violin, bar, point,
  tile/heatmap, and more. You can add MANY geom_fruit layers, so panels STACK as
  concentric rings (circular) or columns (rectangular). Discrete AND continuous
  fill scales, with legends.
- `geom_facet()` / `facet_plot()` does the same in separate aligned panels for
  rectangular layouts.
- `gheatmap()` aligns a value matrix (continuous-scale heatmap) to the tips.
- `msaplot()` aligns a multiple-sequence alignment to the tips.
- `aplot` / `patchwork` glue ANY ggplot to the tree, sharing the tip axis, so a
  bar chart, a dot plot, and a heatmap can all sit beside the same tree, each a
  full ggplot with its own scales and legends.

The unifying idea: the tree is a shared axis (the tip order is the y, or the angle
in circular), and every other panel is laid out against that shared axis.

## Why we are positioned to win this: Data Hub is our ggplot2

ggtree leans on ggplot2 for the panels. We have Data Hub, which is already a
publication-grade, pure-SVG plotting engine:

- 13 plot kinds today (column scatter/bar, xy scatter, grouped bar, survival,
  Gardner-Altman + Cumming estimation, QQ / residual / ROC diagnostics, pie /
  donut / stacked bar), each rendered as a standalone SVG string by a pure
  function (`lib/datahub/plot-spec.ts` `renderPlot()` and the estimation /
  diagnostic / parts-of-whole renderers).
- A real color system (`lib/datahub/palettes.ts`): qualitative palettes
  (Okabe-Ito, Paul Tol, ColorBrewer) AND sequential/continuous palettes (Viridis,
  Blues, Greens) sampled to any N, plus `seriesColors` / `colorForGroup`.
- Axis + scale helpers (d3 `scaleLinear`, `niceTicks`), legend primitives
  (`GroupedLegendItem`), and the SAME SVG/PNG exporter the tree already shares
  (`downloadSvg` / `svgToPngBlob`, reused by phylo today).

So we do not need to invent a charting engine. We need to make Data Hub plots (and
some new native panels) align to tree tips.

## The one architectural unlock

Today every Data Hub plot auto-orders its own category axis (group/row order comes
from table order, positions are evenly spaced and self-determined). `geom_fruit`'s
whole trick is "re-order the data by the tree." So the core enabling change is to
let a plot's row/category axis be DRIVEN by an externally supplied ordering and set
of positions, namely the tree's tip y-coordinates (or angles).

Concretely: introduce a shared "aligned axis" contract. The tree layout already
exposes per-tip y (rectangular) and angle/radius (circular) in
`lib/phylo/layout.ts` (`LaidOutNode`, `yPositions`). A panel renderer takes that
tip axis plus a per-tip data table and renders a column (rectangular) or ring
(circular) aligned tip-for-tip. Native panels render directly; Data Hub plots get
a thin adapter that injects the tip order into the renderer rather than letting it
auto-sort.

## Phasing

### Phase 0 (in flight): level up the existing tracks to publication-grade
Continuous color scales (reuse Data Hub sequential/Viridis palettes), value-based
heatmaps (not binary), legends, a heatmap UI toggle + multi-column picker, and
circular bars + heatmap. This closes the worst of the iTOL gap on its own and
proves the Data-Hub-palette reuse. Additive + back-compat with saved figures.

### Phase 1: the aligned-panel framework (geom_fruit)
A native "aligned panel" abstraction. The tree exposes its tip axis; a panel
renderer draws an aligned column (rectangular) or ring (circular) against it. v1
native panel geoms: gradient tile (value heatmap), bar, dot/point, and boxplot,
each driven by one or more per-tip metadata columns, continuous or categorical,
with a legend. Panels STACK (multiple rings / multiple columns), the geom_fruit
core. The figure spec grows an ordered `panels: AlignedPanel[]` array.

### Phase 2: link real Data Hub plots (aplot / geom_facet)
The headline. Add the tip-order injection to the Data Hub plot renderer so a real
Data Hub plot (boxplot, scatter, bar, distribution) can render as a panel sharing
the tree's tip axis. A per-tip metadata table becomes a Data Hub table; the tree
drives its row order. This is "link a ggplot to the tree by tip" applied to our own
charting engine, so anything Data Hub can plot can hang off the tips.

### Phase 3: full grammar + demo
Multiple mixed stacked panels in one figure, faceting, an MSA/alignment track
(msaplot), composited continuous + categorical legends, and the ggtree-code export
updated to emit the geom_fruit / aplot equivalent so the "export to R" story stays
honest. Reseed the demo with genuinely fancy figures: rebuild the HMP ggtreeExtra
multi-ring figure (tip points by phylum, a ring heatmap of abundance by body site,
an outer bar panel) and a Candida figure with a continuous-scale panel, so the demo
SHOWS the complicated aligned plots rather than the basic ones.

## Data-shape notes (flag before building Phases 1-3)

The persisted phylo figure spec gains an ordered `panels` array and per-panel
scale/column/geom config. All additive and optional, but it is a saved-data-shape
change, so it needs the FLAG-and-confirm step before Phase 1 build, and a
back-compat read path for existing saved figures (no panels = today's behavior).
The per-tip metadata table reuse of the Data Hub table model (Phase 2) is the other
shape decision to lock with Grant.

## Review path

Per the established UI-redesign convention, the target is captured as an
interactive before/after mockup (`docs/mockups/2026-06-13-phylo-ggtree-panels.html`)
showing a genuinely complicated figure: a circular tree with a continuous heatmap
ring, a categorical strip, an aligned bar ring, and an aligned boxplot panel, with
legends, and toggles to add/remove panels and switch continuous vs categorical.
Grant reviews the target (and the tree-to-Data-Hub linkage UX) before the Phase 1-2
build. Phase 0 ships independently as the immediate level-up.
