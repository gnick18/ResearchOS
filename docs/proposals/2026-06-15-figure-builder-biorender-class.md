# Figure Builder → BioRender-class diagram tool

**Date:** 2026-06-15
**Memory:** `[[project_bioart_icon_library]]`, `[[project_figure_composer_styling]]`, `[[project_plot_artboard]]`
**Builds on:** `/figures` FigureComposer (data-linked panels + icon library + shared ZoomPanCanvas), the open-asset federation (R2 CDN `assets.research-os.com`), the figure-styling styleSchema seam.

## Thesis

We do NOT need to out-Illustrator BioRender. We need to make `/figures` *feel* like
BioRender for the 80% science-figure loop, while keeping the two things BioRender
structurally cannot do:

1. **Seamless data-type linking** — a panel on the page is a LIVE view of a real
   sequence / molecule / phylo tree / Data Hub plot. BioRender figures are static
   clip-art. This is already built and is the moat.
2. **Open-license federation + auto-attribution + true vector SVG export** — directly
   neutralizes BioRender's three loudest complaints (no SVG export, the
   "everyone-looks-the-same" aesthetic, CC-BY licensing ambiguity, first-author seat lock).

So the work is: **copy BioRender's *interaction polish* and *diagram primitives*, keep
our data + licensing moat.** This doc maps their editor onto ours and phases the build.

## What "BioRender feeling" actually is (ranked, from research)

Public-source research (BioRender help center, Learning Hub, reviews; see
`docs/proposals/_research/biorender-ux-2026.md` notes inline below) says the feeling
comes from, in order of "wow per unit effort":

1. Curated, searchable, **drag-and-drop** asset library with near-miss-tolerant search and a designed "no match → fallback" path.
2. **Smart connectors** — arrows whose endpoints anchor to elements and **re-route automatically when elements move**. The signature interaction.
3. **Multi-part recolor** (recolor a whole grouped icon OR drill into one layer) + **bulk** recolor/resize/opacity across a multi-selection.
4. **Smart guides / snapping** + a first-class, always-reachable **Align & Distribute** (and "select similar objects").
5. **Templates** — gallery → "Use template" seeds the canvas; drag-template-onto-canvas with Replace-vs-Add; evolving toward "Smart Templates" that stay interactive.
6. **Typed text objects** (Heading / Label / Body presets) + sub/superscript + insert-symbol.
7. **Publication export** — they cap at PDF/600 DPI and have NO SVG. We already beat this.
8. **Beginner scaffolding** from the empty state (blank-vs-template fork + "make your first figure").

## Where we are today (audit)

Current `/figures` = center canvas (now shared **ZoomPanCanvas**: pan, zoom-at-cursor,
minimap) + a single **right rail**. Element model in `lib/figure/figure-page.ts`:

| Element | What it is | vs BioRender |
| --- | --- | --- |
| `FigurePanel` | a data-linked figure (seq/mol/phylo/datahub), real-inch box, per-panel style | **our moat — they have no equivalent** |
| `PlacedAsset` | an icon: real-inch box, rotation, **single-tint** | matches their icon, but single-tint only + no multi-select |
| `Annotation` | `text` / `arrow` / `bracket`, absolute coords | their arrow is **element-anchored**; ours floats |
| Export | true **vector SVG** at 300 DPI | **beats them** (they have no SVG) |
| Rail | Add figure / Add icon / Snap to grid / Page / Annotate / Export | one right rail; no left library, no inspector split, no align tools |

**Gaps vs the ranked list:** drag-drop + semantic search + favorites (#1 partial),
smart connectors (#2, missing), multi-part/bulk recolor + multi-select (#3, missing),
smart guides + align/distribute (#4, missing), templates (#5, missing entirely), typed
text (#6, partial). Export (#7) we already win.

## Proposed layout (the structural decision)

BioRender's new canvas unifies insert+edit on the LEFT + a contextual TOP bar. I
recommend instead the **Figma / Illustrator three-zone model**, which fits our existing
patterns (ZoomPanCanvas, the phylo unified rail, the declarative layer-schema inspector):

```
┌──────────────────────────────────────────────────────────────┐
│  TOP BAR  — contextual: align/distribute, arrange (z-order),  │
│             group/ungroup, when ≥1 element selected           │
├───────────┬──────────────────────────────────────┬───────────┤
│ LEFT RAIL │            CENTER CANVAS             │  RIGHT     │
│ (insert/  │   (ZoomPanCanvas: pan/zoom/minimap,  │  INSPECTOR │
│  browse)  │    smart guides, multi-select,       │ (contextual│
│           │    connectors)                       │  per       │
│ Figures   │   ┌────────────────────────────┐     │  selection)│
│ Icons     │   │  white artboard = export    │     │            │
│ Text      │   │  panels · icons · text ·    │     │ recolor    │
│ Shapes    │   │  connectors                 │     │ size/rotate│
│ Connect   │   └────────────────────────────┘     │ opacity    │
│ Templates │                                      │ text style │
│ Layers    │                                      │            │
└───────────┴──────────────────────────────────────┴───────────┘
```

- **Left rail** = the "what to add" surface (BioRender's content toolbar): Figures
  (our data picker), Icons (the library), Text, Shapes, Connect tool, Templates, and a
  **Layers** list (z-order, lock, rename — needed once figures get many elements).
- **Right inspector** = contextual per-selection editing (reuses the declarative
  `styleSchema` pattern we already built for phylo/datahub panels — extend it to
  PlacedAsset + connectors + text).
- **Top bar** = appears on selection: Align L/C/R + distribute, arrange order,
  group/ungroup. Cheap, huge perceived polish.

This is a real restructure of the current single-right-rail, but it reuses three seams
we already own (ZoomPanCanvas, styleSchema inspector, the picker).

## Phased build plan

Each phase ships standalone behind the existing `ASSET_LIBRARY_ENABLED` umbrella (or a
new `FIGURE_DIAGRAM_V2` flag), gate-green, in a worktree.

### Phase 1 — Selection + alignment polish (cheapest "feels pro" win)
- **Multi-select** (marquee drag + Shift-click) on panels/icons/annotations.
- **Smart guides** — snap-to-edge/center alignment lines while dragging (we already
  compute positions in inches; add a guide solver).
- **Align & Distribute** top bar (L/C/R/top/middle/bottom + distribute h/v).
- **Group / ungroup** + **z-order** (arrange front/back) — needs a `z` field on elements.
- Foundation: a unified `Element` selection model over panels/assets/annotations.
*No new element types. Highest polish-per-effort. Do this first.*

### Phase 2 — Smart connectors (the signature feature)
- New element `Connector`: endpoints reference `{elementId, anchor}` (not absolute
  coords), re-solved on every element move so the line auto-reroutes.
- Hover an element → anchor nodes appear; drag node→node to connect.
- Geometry: straight / elbow / curve, arrowheads, mid-line editable nodes.
- Supersedes the floating `arrow` annotation with an anchored one.
*This is what turns "clip-art canvas" into "diagram tool." Highest wow.*

### Phase 3 — Icon library depth + recolor
- **Drag-and-drop** placement from the left rail (today it's click-to-place).
- **Per-fill / multi-part recolor** (the sanitizer already preserves per-fill structure)
  + a whole-icon "color overlay" mode — single vs multi-part, like BioRender.
- **Bulk recolor / resize / opacity** across a multi-selection (rides on Phase 1).
- **Favorites / recents** tray; **semantic search** (embedding the manifest) + a
  "can't find it → request / generate" fallback path.
- Scale the CDN ingest past the ~300-asset proof batch (bump MAX, re-rclone) so the
  library is full.

### Phase 4 — Templates + typed text + empty-state
- **Template gallery**: BioRender-style "Use template" seeds the page; drag-onto-canvas
  with Replace-vs-Add. Our **phylo Smart Data Binding** work is the same idea — templates
  that bind to the user's data, which BioRender *cannot* do.
- **Typed text objects** (Heading / Label / Body presets) + sub/superscript + insert-symbol.
- **Empty-state fork**: blank vs template, + a "make your first figure" guided path.

### Always-on differentiators (already shipped — market them)
- Live data-linked panels · true SVG export · open-license auto-attribution credits
  block · usable free tier · no first-author seat lock.

## Open decisions (need Grant)

1. **Layout restructure** — adopt the three-zone (left insert / right inspector / top
   contextual) model, or keep the single right rail and just add tools to it? (I
   recommend three-zone; it's more work but it's the BioRender feeling and reuses our seams.)
2. **Scope ambition** — full diagram tool (connectors + templates + layers), or stop at
   Phase 1+3 (polish + icon depth) and defer connectors/templates? Connectors are the
   single biggest "feel" lever but also the biggest build.
3. **Naming** — does `/figures` stay "Figure Composer," or does this become a broader
   "Figure & Diagram Studio" (posters already nearly free via the artboard)?
4. **AI parity** — BioRender leans on AI (generate-a-figure, semantic search, make-an-icon).
   Do we want an AI "describe your figure" entry, given our metered-AI billing is built?

## Recommended next step

Build a **clickable mockup** of the three-zone layout (light default) showing: left rail
with the library open, a canvas with two data-linked panels + icons + a smart connector
mid-draw, the right inspector on a selected multi-part icon, and the top align bar on a
multi-select. Grant reacts to the mockup → we lock scope → Phase 1 starts in a worktree.
