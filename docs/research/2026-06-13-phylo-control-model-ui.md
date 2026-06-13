# Tree Studio control model: from a toggle wall to a layers stack

2026-06-13, UI research + recommendation. Grant's concern: as we add ggtree-class
plotting features, a flat list of toggles becomes impossible to navigate. We need
to expose EVERY option while keeping it findable. This decides the Phase 1 control
model before we build it.

## The problem, stated precisely

The current Studio is a flat panel of toggles (labels, points, strip, bars,
heatmap, clade, support) plus a few dropdowns. That is fine at 7 tracks. The
trajectory (geom_fruit panels, gheatmap matrices, aligned Data Hub plots, MSA
tracks, each with its own column / scale / palette / geom config) is dozens of
options. A flat control surface costs screen space proportional to the WHOLE
feature catalog, and every new feature makes the panel longer and harder to scan.
That does not scale.

## What feature-dense tools actually do

The established playbook (confirmed by the UX literature on complex-visualization
interfaces, see sources) is four patterns, used together:

1. Progressive disclosure: show the few common controls, tuck the rest behind
   expand / advanced / inspector. Detail on demand.
2. Layer / panel management: represent the artifact as an ordered STACK of layers
   you add, reorder, hide, and delete, rather than a fixed grid of switches. This
   is how Photoshop, Illustrator, Figma, and (critically) ggplot2 itself work, a
   plot is `ggplot() + layer + layer + layer`.
3. Inspector: selecting one layer reveals only THAT layer's properties (Figma's
   right rail, Prism's format dialog), so the visible option count is bounded by
   the selected element, not the catalog.
4. Focus + context and presets: start from a template close to the target rather
   than from zero, and let direct manipulation on the canvas select the thing to
   edit.

The anti-pattern is iTOL itself, where every dataset type is a separate fiddly
form and assembling a rich figure is notoriously painful. We do not want to be a
prettier iTOL form-wall.

## Recommendation: the figure IS a layer stack

Replace the toggle wall with a LAYERS panel. The figure is an ordered list of
layers: the tree, then each annotation track / data panel, in draw order.

- A single "+ Add" affordance (a searchable, categorized menu) replaces N
  persistent toggles. Categories: Tree styling, Tip decorations (labels, points,
  strip), Aligned data panels (heatmap, bars, dots, boxplot, the Data Hub plots),
  Highlights (clade, support), Alignment (MSA). The add surface is O(1) screen
  space no matter how many panel types exist; the catalog can grow forever.
- Each added layer is a ROW: an eye (show / hide, the old toggle), a drag handle
  (reorder = draw order, inner ring to outer), a name, and a disclosure to expand
  its inspector.
- The INSPECTOR (expanded row, or a right rail) shows ONLY the selected layer's
  options: which metadata column it binds, the scale (continuous palette vs
  categorical), legend on / off, geom-specific options. Adding the 30th panel type
  adds one menu entry and one inspector, not 30 toggles.
- Presets / templates: "Start from" a known figure (basic phylogram, the
  ggtreeExtra multi-ring, a gheatmap matrix). This is the single biggest
  discoverability win, it answers "how do I make THAT" by example.
- Direct manipulation: click a ring or tip on the canvas to select its layer
  (canvas and layer-list selection are two-way), so the figure itself is a
  control.
- Power-user escape hatch: a "/" command to add any layer by name, reusing the
  in-app BeakerSearch palette pattern.

## Why this is the right architecture, not just nicer UX

The layers model maps 1:1 onto the two things Phase 1 already needs:

- The planned persisted figure spec is an ordered `panels[]` array. A layer row IS
  a panel entry. The UI and the data model become the same shape.
- ggtree's grammar is layered (`+ geom_fruit() + geom_fruit()`). Each layer is a
  geom. So our layer stack also makes the ggtree-code export a clean per-layer
  emit, and makes "reproduce this ggtree figure" a matter of matching the layer
  list.

So adopting the layers model now is not extra work bolted onto Phase 1, it IS the
Phase 1 UI, and it replaces (not adds to) the toggle code. The cost scales with
the panels in a given figure, never with the size of the feature catalog.

## Migration

Phase 0's toggles keep working underneath (each maps to a default layer). Phase 1
introduces the layer stack as the control surface and the `panels[]` spec; the
existing saved figures read back as a default layer set (labels + whichever tracks
were on). No saved figure breaks.

## Next step

An interactive mockup of the control model
(`docs/mockups/2026-06-13-phylo-control-model.html`) shows the layers panel, the
categorized Add menu, an expanded inspector, presets, and a Today-vs-Proposed
toggle, so Grant reacts to the control model before the Phase 1 build. This
reshapes the Phase 1 UI from "more toggles" to "the layer stack."

## Sources

- Progressive disclosure in complex visualization interfaces (Dev3lop).
- Designing UI for heavy-data applications (AlterSquare).
- Material Design data visualization guidance.
- Graph visualization UX (Cambridge Intelligence).
