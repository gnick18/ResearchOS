# Phylo Phase 2 build spec: Data Hub-class statistical panels aligned to tips

2026-06-13. Phase 2 of the ggtree-class arc, scoped for build on top of the merged
Phase 1 (panels[] + TipAxis + panel-render.ts). Goal: per-tip data renders as real
statistical-plot panels aligned to the tree, the aplot/geom_fruit payoff. The box
panel from Phase 1 is the first taste; Phase 2 fills out the Data Hub-class set.

## Design refinement (and the cross-lane boundary, IMPORTANT)

The Phase 1 proposal framed Phase 2 as "inject the tree tip-order into the Data Hub
renderer." On reflection that is the wrong seam: the Data Hub renderer lays plots
out against ITS OWN axes (group bands, self-ordered), and aligning to a tree tip
axis fundamentally needs a different layout (the tip positions drive the bands).
So Phase 2 renders the panels PHYLO-SIDE against the Phase 1 TipAxis, REUSING Data
Hub's pure primitives (box statistics, d3 scaleLinear, niceTicks, the palette
engine) read-only. We do NOT modify `lib/datahub/*` (that is the Data Hub lane).
This keeps Phase 2 entirely in the phylo lane, consuming Data Hub primitives the
same way Phase 0/1 already reuse `lib/datahub/palettes.ts`, with zero cross-lane
collision. Same user outcome (Data Hub-class plots aligned to tips), cleaner
architecture, no shared-file contention with the Data Hub or BeakerAI lanes.

## New aligned-panel geoms (added to the panels[] catalog + panel-render.ts)

Each binds one or more per-tip metadata columns, renders as a column (rectangular)
or ring (circular) against the TipAxis, shares a per-panel numeric axis + scale +
legend, and reuses Data Hub primitives for stats/scales/color.

- violin / density: per-tip distribution from replicate columns (the box's sibling;
  reuse the box's multi-column binding).
- point + error (lollipop): one point per tip at the mean with an SD/SEM whisker,
  from either a value+error column pair or the mean/sd of replicate columns. Error
  kind (sd/sem/none) reusing Data Hub's ErrorBarKind semantics.
- strip / jitter scatter: the individual replicate points per tip (the column-
  scatter analog), optional jitter.
(box already shipped in Phase 1.)

A shared numeric axis ticks helper (reusing Data Hub niceTicks) so these panels
carry a readable value axis, not just bare glyphs.

## Data binding

Reuse Phase 1's AlignedPanel `columns[]` (already used by the box) for the
multi-value (replicate) geoms; `column` + an optional error column for the point
geom. No persisted-shape change beyond what Phase 1 already added (panels[] is
sufficient; if the point geom needs an error-column field, add an OPTIONAL
`errorColumn?` to AlignedPanel, additive + back-compat, FLAG it in the report).

## UI

Add the new geoms to the searchable Add-panel menu under "Aligned data panels", and
give each its inspector options (the bound columns, error kind, show-points, axis
on/off), in the Phase 1 inspector pattern. No new control paradigm.

## Out of scope (Phase 3)

MSA/alignment track, faceting, the full publication-figure multi-legend layout
polish, demo reseed, the handbook (parked).

## Gate + delivery

tsc 0, `vitest run src/lib/phylo src/lib/transparency`, icon-guard 0, new tests for
each geom renderer + any data binding. Built in an isolated worktree, committed
incrementally, then an ATOMIC guarded merge (merge + foreign-bleed check + commit
in one shot, the lesson from the Phase 1 sweep). Validate locally against the
ggtree corpus (`~/Desktop/ggtree-testdata/`, never committed): a per-tip boxplot /
violin figure aligned to a tree.
