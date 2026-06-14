# Universal Figure Composer (multi-panel publication pages, any surface)

Status: DRAFT for review (Grant + lane leads), 2026-06-14. Grew out of the Data
Hub WS2 "multi-panel figure composition" mockup
(`docs/mockups/2026-06-14-datahub-multi-panel-composition.html`) once we asked the
right question: should a Figure 1A/B/C page be able to combine a stats plot, a
phylogeny, and a sequence map. Answer: yes, and that makes it an app-level
capability, not a Data Hub feature. No code until the seam contract below is
signed off. House voice (no em-dashes, no emojis, no mid-sentence colons).

Relates to `[[project_plot_artboard]]` (the single-figure artboard this extends),
`[[project_phylo_ggtree_coverage]]` (a figure source), the Phase 4 seam
(`docs/proposals/2026-06-13-phylo-phase4-datahub-linking.md`, the proof that
cross-surface rendering already works).

## 1. The goal (and why it is unique)

Let a researcher build a complete multi-panel publication figure, "Figure 1A/B/C",
by arranging several existing figures on one real publication page, labeling them,
annotating across them, and exporting one publication-exact SVG. The figures can
come from DIFFERENT surfaces. A page can hold a Data Hub bar chart (A), a
Kaplan-Meier curve (B), a phylogeny (C), and a plasmid map (D), live-linked to
their sources. No other tool composes phylogenetics + statistics + sequence maps
into one page. GraphPad arranges its own graphs only; this composes across the
whole lab notebook.

## 2. The reframe: Data Hub multi-panel -> universal composer

The original WS2 was "put several Data Hub plots on a page." The moment a panel
can be a tree or a sequence map, the composer is no longer Data Hub specific. So:

- The composer, the page document, and the layout/annotation/export logic are ONE
  thing, app-level, in the shared `lib/figure` (already shared by Data Hub + Tree
  Studio for the single-figure artboard).
- Each surface that can draw a figure contributes a small adapter (a FigureSource)
  rather than reimplementing composition.

This is the inverse of Phase 4. There, the phylo lane plugged INTO the Data Hub
plot renderer. Here, every surface plugs into the Data Hub-owned composition
framework.

## 3. Core architecture: the FigureSource registry (the seam)

The whole design rests on ONE contract. A FigureSource is what a surface registers
so its figures become composable panels. Keep this contract small and stable, this
is the part to get right.

```
interface FigureSource {
  type: string;                 // "datahub" | "phylo" | "sequence" | "chemistry"
  label: string;                // "Data Hub plot", "Phylogeny", "Sequence map"
  // List the surface's figures the user can add, scoped to a collection/project.
  list(scope: FigureScope): Promise<FigureRef[]>;   // { id, type, name, thumbnailSvg? }
  // Render ONE figure to a self-contained SVG at a requested size, in real units.
  // Pure of DOM. This is the same call the surface already makes to draw itself.
  render(id: string, opts: RenderOpts): Promise<RenderedFigure>;
  // opts: { widthIn, heightIn, dpi, theme } -> { svg, naturalAspect, missing? }
  // Open the source figure's own editor (for double-click-to-edit round-trips).
  editHref(id: string): string;
}
```

Surfaces register at startup: `registerFigureSource(dataHubSource)`, etc. The
composer never imports a surface directly, it only walks the registry. A new
surface lights up by registering, with zero change to the composer.

Already-met by today's code (low adapter cost):
- Data Hub: `renderPlot(spec, content)` returns a self-contained SVG, `PlotSpec.id`
  is stable, figures recompute live. Phase 4 proved the cross-render.
- Phylo: `renderTreeSvg(figure)` + `PhyloFigureSpec.id`.

Needs a thin adapter (confirm the render-at-size entry):
- Sequence: linear / circular map SVG (`lib/sequences/export.ts` already exports
  SVG; wrap a render-at-size).
- Chemistry: structure SVG (confirm the molecule-to-SVG entry exists at size).

## 4. The Figure-page document

A new lightweight document type, NOT a plot and NOT tied to one table:

```
interface FigurePage {
  id: string;                   // minted from _counters.json under a new "figures" entity
  name: string;
  collectionId: string | null;  // the app-wide collection it belongs to (section 7)
  paper: PaperState;            // reuse lib/figure artboard paper/orientation/rulers
  panels: FigurePanel[];
  annotations: Annotation[];
}
interface FigurePanel {
  panelId: string;
  ref: { type: string; id: string };   // a FigureSource type + figure id (live link)
  placement: { xIn, yIn, wIn, hIn };    // real units on the page
  label?: string;                       // auto A/B/C, overridable
  overrides?: PanelOverride;            // section 5, never mutates the source
}
interface Annotation { id; kind: "text"|"arrow"|"bracket"; ... }  // section 12 decision
```

Stored like other Data Hub docs (Loro or JSON under `users/<owner>/figures/<id>`),
collection-scoped, version-controlled. The single-figure artboard (PlotStyle.artboard)
is UNCHANGED; a Figure page is the separate multi-panel surface (section 13).

## 5. Live reference, never a copy (+ optional overrides)

The decision that fits the whole product: a panel stores a REFERENCE
(`{ type, id }`), not a snapshot. At render the composer calls the source's
`render(id, ...)`, so:

- Edit the source figure's style in its own editor -> the panel updates.
- Edit the underlying DATA (table, tree, construct) -> the figure recomputes ->
  the panel updates.
- Double-click a panel -> `editHref(id)` opens the source editor; return and it is
  refreshed.

One source of truth, fully reproducible, the Data Hub philosophy. Edge over Prism,
whose layout panels drift from their source.

Optional per-panel OVERRIDE layer (additive, composition-local, never mutates the
source figure), mirroring the method-attachment override pattern already in the
app: hide title, hide legend, tighten margins for the layout. v1 ships pure-live +
"hide title/legend"; grow from there.

## 6. Information architecture: where it lives and how it opens

A Figure page is collection-scoped and cross-surface, so it must be reachable from
anywhere the collection is, and it is ONE document opened from many doors:

- A dedicated "Figures" home (a top-level surface, or a section in the existing
  data surfaces), the canonical list of all Figure pages.
- It also appears in the collection rail on EVERY producing surface (Data Hub rail,
  Phylo rail, Sequences rail), since it belongs to the collection. Opening it from
  the Data Hub or the Phylo page loads the SAME composer on the same document.
- Route: `/figures/<id>` (or reuse the datahub doc route pattern). The composer is
  one shared component regardless of entry door.

Add a panel: "+ Add figure" opens a picker that lists figures from ALL registered
sources in the current project (grouped by source), so a tree and a bar chart sit
side by side in the same picker.

## 7. Collections (the shared scope)

Collections are already app-wide (phylo, sequences, and Data Hub all reference
them). A Figure page belongs to a collection and may compose any figure produced
by any surface within that project (and shared-in figures, later). Collections are
the natural unit of "this paper's figures".

## 8. Export (one exact vector)

Reuse the artboard export math (real inches -> SVG/PNG at DPI). The page composes
each panel's source-rendered SVG, translated and scaled into its placement, plus
the annotation layer, into ONE self-contained SVG. Every panel stays
publication-exact because each source renders at its real target size, not a
rescaled bitmap. Page-mode (full sheet) and tight-bbox export both fall out.

## 9. THE AUDIT: where this touches (review this table)

| Area | What it needs | Owner | Status today |
|------|---------------|-------|--------------|
| `lib/figure` composition framework | FigureSource registry, FigurePage model, layout + annotation + compose-export | Data Hub lane (me) | new, mine, uncontested (Phylo confirmed) |
| Composer UI | the page canvas, add-figure picker, drag/label/annotate, inspector | Data Hub lane | new |
| Figure-page storage + route | `figures` entity in `_counters.json`, `users/<owner>/figures/<id>`, `/figures/<id>` | Data Hub lane | mirror the datahub doc pattern |
| Data Hub adapter | wrap `renderPlot` + `PlotSpec.id` + editHref | Data Hub lane | renderer ready (Phase 4) |
| Phylo adapter | wrap `renderTreeSvg` + `PhyloFigureSpec.id` + editHref | Phylo lane | renderer ready, ~Phase-4-size handoff |
| Sequence adapter | render-at-size map SVG (`lib/sequences/export.ts`) + seq id + editHref | Sequence lane | export.ts exists, confirm size entry |
| Chemistry adapter | structure-to-SVG-at-size + id + editHref | Chemistry lane | confirm SVG export entry |
| Single-figure artboard | unchanged; relationship documented (section 13) | Data Hub lane | byte-identical path preserved |
| ZoomPanCanvas | view-only wrapper around the composed page (pan/zoom/fullscreen) | Phylo lane (shared) | shipped, drops in |
| IA / "Figures" home + per-surface rail entries | nav + collection-rail listing on each surface | cross-lane | new, needs Grant IA call |
| Collections | already shared, no change | n/a | done |

## 10. Phasing (do not boil the ocean)

1. Seam + framework: the FigureSource registry, the FigurePage doc + storage +
   route, the composer UI, the compose-export. Data Hub lane.
2. Data Hub adapter: ships the composer usable immediately with Data Hub panels.
3. Phylo adapter: first cross-surface page (tree + stats), a small handoff.
4. Sequence adapter, then Chemistry adapter.
5. Overrides depth, annotation depth, the IA "Figures" home polish.

Each step is independently shippable. The composer is useful at step 2; every
later step just adds a source.

## 11. Cross-lane adapter contract (the handoff)

The registry contract in section 3 IS the handoff. Once signed off, each lane
implements its adapter to that interface on its own side and registers it, exactly
like Phase 4. The composer does not change per surface. Risks to pin so adapters do
not churn (section 13).

## 12. Open decisions (carried from the mockup + new)

From the WS2 mockup:
1. Panel-label style default (A B C cap, recommended).
2. Layout model (free drag + snap guides, recommended; grid optional).
3. Annotation set: collapse to 3 (Text, Arrow with head-toggle, Bracket with
   optional significance label) to kill icon ambiguity, recommended.
4. How figures get on the page (cross-source picker, recommended).
5. Panel sizing (each independent + a "match size" action, recommended).

New (from this proposal):
6. Universal-from-the-seam (recommended) vs Data-Hub-only v1.
7. Live reference + optional per-panel overrides (recommended) vs pure-live v1.
8. IA: a dedicated "Figures" top-level home, or only per-surface collection-rail
   entries, or both (recommended both).
9. Cross-surface from day one, or Data Hub + phylo first then seq/chem.

## 13. Getting the seam right (risks)

- Stable contract. Adapters are owned by other lanes; churning `FigureSource` means
  churning every lane. Decide the contract once, version it if it must change.
- Render-at-size. Every source must render to a requested real-unit size, not a
  fixed px. Data Hub + phylo already size in real units (the artboard work);
  confirm seq + chem can.
- Theme. The composed SVG is one document, so panels must render in a consistent
  theme (the page sets light/dark, passes it to each `render`).
- Live resolution + missing sources. A referenced figure can be deleted or live in
  another collection. `render` returns `missing` so the panel shows a placeholder,
  never a crash.
- Single-figure artboard relationship. Keep the existing per-figure "Page artboard"
  toggle (one figure on a page) byte-identical. A Figure page is the separate
  multi-panel doc. A one-panel Figure page and a single-figure artboard look the
  same but are different objects; do not merge them in v1.
- ZoomPanCanvas. The shared pan/zoom wraps the composed page on screen, orthogonal
  to the figure model. No interaction with composition or export.

## 14. Decisions locked (2026-06-14, Grant)

1. Panel labels: USER-PICKABLE per page (ABC / abc / 123 / none), not a fixed default.
2. Layout: free drag by default + a "Snap to grid" button, with UNDO.
3. Annotation set: the 3 combined tools (Text, Arrow with 0/1/2 head toggle =
   line, Bracket with label = significance), each with a hover tooltip.
4. Panel sizing: each independent; "Snap to grid" asks resize-to-cells vs
   align-positions-only (keep sizes).
5. Add figures: cross-source picker.
6. Scope: UNIVERSAL seam now, Data Hub panels first.
7. Live: live reference + optional per-panel overrides (hide title/legend).
8. Access: a "Figures" top-level home AND per-surface collection-rail entries.
9. Build order after Data Hub: phylo adapter next (flexible).

## 15. Build status

- Phase 1 IN PROGRESS (worktree figure-composer-phase1). DONE: the FigureSource
  registry seam (`lib/figure/figure-source.ts`) + the FigurePage model + pure
  layout helpers (label styles, ordered-by-reading, snapToGrid align/resize, panel
  ops) in `lib/figure/figure-page.ts`, with 10 unit tests (tsc 0). NEXT: the page
  compositor (compose N panel SVGs into one exact-units page SVG + export), the
  Data Hub FigureSource adapter (wraps renderPlot + PlotSpec.id), storage (a
  `figures` entity), the composer UI, routing + the Figures-home / rail IA. Then
  hand the section-3 adapter contract to the phylo / sequence / chemistry lanes.
