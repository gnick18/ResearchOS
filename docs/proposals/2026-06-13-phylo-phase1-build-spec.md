# Phylo Phase 1 build spec: layers control model + aligned-panel framework

2026-06-13. Phase 1 of the ggtree-class arc, scoped for build. Direction approved:
the figure is a LAYERS stack (control-model mockup
`docs/mockups/2026-06-13-phylo-control-model.html`), and panels align to the tree
by tip (the geom_fruit model, target mockup
`docs/mockups/2026-06-13-phylo-ggtree-panels.html`). This phase delivers the
control model + the native aligned-panel framework. It does NOT yet embed full
Data Hub plots (that is Phase 2); it does build the shared tip-axis those plots
will later plug into, and a boxplot panel as the first taste.

## 1. Data model (the one persisted-shape change, FLAG)

`PhyloFigureSpec` gains an ordered, OPTIONAL array. Additive, back-compat: a saved
figure with no `panels` reads exactly as today.

```ts
interface PhyloFigureSpec {
  // ...existing fields unchanged...
  panels?: AlignedPanel[];   // ordered, inner (near tips) to outer = draw order
}

interface AlignedPanel {
  id: string;
  kind: "labels" | "points" | "strip" | "heat" | "bars" | "dots" | "box"
      | "clade" | "support" | "msa";   // the layer catalog; grows over phases
  visible: boolean;
  column?: string;            // bound metadata column (colored/data panels)
  columns?: string[];         // multi-column (a heat matrix, gheatmap-style)
  scale?: { kind: "continuous" | "categorical"; paletteId?: string };
  legend?: boolean;
  width?: number;             // panel thickness (px column / ring)
  options?: Record<string, unknown>;  // geom-specific (bar width, label italic, support cutoff)
}
```

A layer row in the UI IS an AlignedPanel. The order of the array is the draw order.
This is also exactly what the ggtree-code export walks to emit one geom per panel.

## 2. The aligned-axis contract

`lib/phylo/layout.ts` already computes per-tip positions (y in rectangular,
angle+radius in circular). Expose a small `TipAxis` (tip id -> position + the
band size per tip) that a panel renderer consumes, so every panel lines up
tip-for-tip and the tree reserves the right outer room (extend `rightInsetFor` /
`circularRingRoom`, both already touched in Phase 0).

A panel renderer signature, pure SVG like the rest:
`renderPanel(panel, axis, perTipValues, scale): string` returning the column
(rect) or ring (circular) SVG. Phase 0's strip/heat/bars become panels rendered
through this path (consolidation, not a parallel system).

## 3. Native panel geoms in v1

Reuse `lib/phylo/color-scale.ts` (Phase 0) for color and `lib/datahub/palettes.ts`
for continuous ramps. v1 geoms:
- `heat` (single + multi-column matrix, continuous or categorical, the gheatmap case)
- `bars` (numeric, continuous color optional)
- `dots` (numeric -> position/size, the lollipop/point panel)
- `box` (per-tip distribution from replicate columns; the first panel drawn with
  Data Hub box primitives, the bridge to Phase 2)
- plus the existing labels / points / strip / clade / support as panels.

All work in BOTH rectangular (columns) and circular (rings), legends per panel.

## 4. UI (PhyloStudio refactor)

Replace the toggle wall with the layers control:
- A `LayerList` (reorder via pointer drag, show/hide eye, delete, select).
- An `Inspector` for the selected layer (column / scale / palette / legend /
  geom options), progressive disclosure, only the selected layer's options.
- An `AddPanelMenu` (searchable, categorized: Tip decorations / Aligned data
  panels / Highlights / Alignment).
- A `Templates` "Start from" (basic phylogram, ggtreeExtra multi-ring, gheatmap).
- Canvas selection two-way (click a ring -> select its layer) if cheap; else defer.
Reuse existing control primitives; icons via `<Icon>`, tooltips via `<Tooltip>`,
no inline `<svg>` in components.

## 5. Migration / back-compat

On load, a figure with no `panels` is projected into a default layer set from its
existing tracks/columns (labels + whichever Phase 0 tracks were on), so nothing
saved breaks and the first open of an old figure just works. Writing always emits
`panels` going forward. Phase 0 track booleans stay readable for one version.

## 6. Out of scope (Phase 2+)

- Embedding a full Data Hub plot (scatter, survival, estimation) as a panel by
  injecting the tree tip-order into the Data Hub renderer. Phase 1 builds the axis
  contract; Phase 2 wires Data Hub plots onto it.
- MSA/alignment track rendering (msaplot), faceting, composited multi-legend
  layout polish.

## 7. Gate + delivery

tsc 0, `vitest run src/lib/phylo src/lib/transparency`, icon-guard 0, plus new
tests for the panel renderer + the spec migration. Built in an isolated worktree,
guarded merge. Validated locally against the ggtree corpus
(`~/Desktop/ggtree-testdata/`, never committed): rebuild the ggtreeExtra fig1
multi-ring and the HMP gheatmap matrix and compare to the originals.
