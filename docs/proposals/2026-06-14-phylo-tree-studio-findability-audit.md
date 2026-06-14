# Tree Studio findability + contextual-controls audit

**Date:** 2026-06-14
**Scope:** The `/phylo` Tree Studio page — making the now-large surface (19 layer kinds, per-type inspectors, metadata binding, Data Hub panels) easy to navigate, with metadata overlays + per-data-type settings that **show/hide based on what's actually on the figure**.
**Status:** Audit + proposed architecture. Decisions to approve, then mockup → build. Nothing built yet. Grounded in a 3-agent read of `PhyloStudio.tsx`, `PhyloLayers.tsx`, `render.ts`, `panel-render.ts`, `panels.ts`, `types.ts`, plus a survey of Data Hub / Sequences / SplitShell patterns.

---

## TL;DR

The page works but its controls live in **three disconnected surfaces** with **hand-wired per-type visibility**, and one of the most important data sources (Data Hub) is added from a different place than every other overlay. The fix is three moves:

1. **One control home, two stable sections** — fold the scattered tree controls into a single right-side Figure panel: **Shape** (everything that changes the tree itself) + **Layers** (everything overlaid on it). Zoom/fit stays on the canvas; Export/Code stay as tabs.
2. **A declarative field schema per layer kind** — replace the `panel.kind === …` conditional chains with a data structure that says, per kind, which fields exist and *when each is relevant*. This is what makes settings appear only when they do something, and lets the Add menu be constraint-aware.
3. **Overlays and their chrome move together** — a layer's legend / value-axis / color key is owned by the layer; toggle the layer and its key appears/vanishes with it, auto-placed clear of the tree. One contextual "Legends & keys" area shows only the keys currently on the figure.

---

## Part 1 — What's hard to find today (the audit)

### A. Global controls are split across three surfaces with no through-line
- **Top toolbar strip** (above canvas): layout (6 options), phylogram/cladogram, scale bar, root edge, time axis, page frame.
- **Setup → Tree card** (right rail): change tree, ladderize, midpoint root, reroot-on-outgroup, branch-color-by, rotate-a-clade.
- **Inside the canvas**: zoom / fit / fullscreen / reset.

Nothing signals these are related. "Make it circular" and "reroot it" are both *reshaping the tree*, but live in different places. **Page frame is the worst case:** the toggle is in the toolbar, but its settings (paper, orientation, rulers, figure width) are under the **Export** tab — discoverable only by reading the toggle's tooltip.

### B. Data Hub is a hidden, inconsistent entry point
`datahubPlot` is the **only one of 19 layer kinds not in the "Add panel" menu**. It can only be created from the Setup → Data Hub card, and its one setting (bar mode) lives back in that card — it has **no inspector** in the Layers list. A user who learned "overlays are added via Add panel" will never find that they can drop a Data Hub figure onto the tree. Given this whole initiative is about *Data Hub data on trees*, that's the headline gap.

### C. The "add a layer, then add things inside it" double-step is opaque
Clades, tip-links, span-strips and node-pies work as: add the *layer*, then click a second "Add clade / link / strip / pie" inside its inspector. The one-layer-holds-many-annotations relationship isn't visible anywhere.

### D. Per-type settings are hand-wired and leak no-ops
Inspector relevance is decided by long `panel.kind ===` chains + `COLORED_KINDS` / `DATA_KINDS` set membership. It mostly works, but it's brittle and already leaks dead controls:
- **sd/sem selector is a no-op** when an explicit error column is set (the value is taken verbatim) — only meaningful in replicate mode.
- **Boxplot shows a Legend toggle** that produces no legend.
- **Dots/bars show a categorical "Scale"** even though they're numeric-length geoms (a categorical scale does nothing).
- The Add menu offers **all 17 catalog kinds regardless of whether the tree has the data** — heatmap/bars/strip are useless with no metadata column bound; nothing says so.
- Column pickers list **every column regardless of numeric/categorical suitability** for the geom.

### E. Smaller scannability + copy issues
- Layer rows read "Heatmap · col1 / Bar panel · col2" with **no preview swatch** — a busy stack is hard to scan.
- **Stale copy**: the MSA + metadata notes say to import "in the Alignment panel on the left" — those panels moved to the right Setup tab.
- Two unrelated "pick clade by tip members" multi-pickers (rotate-a-clade vs clade-highlight members) use the same widget in different tabs — easy to confuse.

---

## Part 2 — Inspiration we can recycle

### On our own site (don't reinvent)
- **Data Hub `NewAnalysisDialog`** — *constraint-aware* chooser: only offers analyses valid for the current table (`validAnalysisTypes(content)`), with a per-type blurb and a "Help me choose" BeakerBot path. → our Smart Add menu, constrained by the tree's bound data.
- **Sequences `SequenceOperationsRail`** — the inspector-swap pattern: one inspector slot that shows the controls for whatever is selected, with a context bar ("On this sequence"). → select a layer, the inspector shows only that layer's fields.
- **`SplitShell` (`useSplitShell`)** — the canonical resizable/collapsible rail already backing all four data pages. Tree Studio already uses it; keep it.
- **Data Hub `DataHubRail`** family-tree nesting + `RailRenameInput` — child rows nest under their parent, inline rename. → annotations (clades, links) nest visibly under their layer; inline layer rename.
- **`PaletteStudio` segmented `Seg` + category filter**, **`WorkspaceToolbar`** action grouping, **Tooltip-on-icon-only** house rule, **CommandPalette** "/" power-user add.

### Other SaaS (the proven shapes)
- **Figma / Illustrator Properties panel** — *contextual*: the panel shows properties for the selected object, figure-level when nothing's selected. This is the exact model for the per-layer inspector.
- **Datawrapper / Flourish "Refine" step** — only shows the controls that matter for the chosen chart type; the rest never appear. This is our field-schema idea, validated by two mainstream tools.
- **iTOL (the direct competitor)** — its "datasets" model is powerful but notoriously hard to navigate (everything always visible, no constraint hints). We beat it precisely by being constraint-aware and contextual.
- **Airtable/Notion type-aware field editors** — a field's input depends on its type. → column pickers filtered by numeric/categorical; geom-appropriate controls only.
- **Observable Plot / ggplot grammar** — layers = marks with their own aesthetics. Our `panels[]` already *is* this stack; lean into "each layer is a mark," which makes the mental model teachable.

---

## Part 3 — Proposed architecture

### 3.1 One Figure panel, two stable sections (+ Export/Code)
Collapse the three control surfaces into a single right-side panel with two always-present sections and the two existing tabs:

- **Shape** — *everything that changes the tree itself*: layout (rect/slanted/circular/fan/inward/unrooted), phylogram vs cladogram, rooting (midpoint / outgroup / ladderize), rotate-a-clade, branch-color-by, scale bar / time axis, and the **Page frame** toggle **with its paper/size settings inline** (not under Export). Mental model: "how the tree looks before I add data."
- **Layers** — *everything overlaid on the tree*: the layer stack + Smart Add + per-layer inspector (below). Data Hub becomes a normal layer kind here.
- **Export** / **Code** — unchanged tabs.

Zoom/fit/fullscreen stay on the canvas (they're *view*, not *figure*). This is the single biggest findability win: one place for "change the tree," one for "add to the tree."

### 3.2 The declarative field schema (the heart of the contextual-settings ask)
Define each layer kind as data, not conditionals:

```
LAYER_SCHEMA[kind] = {
  category: 'tip' | 'aligned-data' | 'highlight' | 'alignment' | 'datahub',
  needs: ['metadataColumn'] | ['numericColumn'] | ['replicateColumns'] | ['alignment'] | ['datahubTable'] | [],
  fields: [
    { key: 'column',      type: 'column', filter: 'numeric',     when: () => true },
    { key: 'errorColumn', type: 'column', filter: 'numeric',     when: p => p.mode === 'value' },
    { key: 'errorKind',   type: 'seg',    options: ['sd','sem'], when: p => p.mode === 'replicate' },  // hidden when an error column is set → kills the no-op
    { key: 'legend',      type: 'toggle', when: p => kindDrawsLegend(p) },                              // boxplot → false
    ...
  ],
}
```

The inspector renders `fields.filter(f => f.when(panel, data))`. Payoffs, all of which directly answer "seamlessly hide/display depending on what's on the display":
- **Settings appear only when they do something** — sd/sem hides with an error column, boxplot loses its dead legend, dots lose the categorical scale.
- **Column pickers are type-filtered** — numeric geoms list numeric columns, categorical geoms list categorical ones (Airtable-style).
- **Add a kind = one schema entry**, not edits across six conditionals.
- **The schema feeds the Add menu** (next).

### 3.3 Smart Add — constraint-aware, includes Data Hub
Replace the flat 17-item menu with a Data-Hub-`NewAnalysisDialog`-style chooser:
- **Categorized + searchable** (already are) **+ constraint-aware**: kinds whose `needs` are satisfied by the current tree's bound data float to the top; unsatisfiable kinds are shown greyed with a one-line reason ("needs a metadata column", "needs an aligned FASTA", "needs a Data Hub table") and a one-tap fix ("Bind a table…").
- **Data Hub is a first-class category here** — fixes the split entry point. Picking it inlines the table + join-column picker (with the live "joins N of M tips" indicator) right in the add flow.
- **"/" to add by name** for power users (reuse CommandPalette), and an optional **"Help me overlay"** BeakerBot path mirroring "Help me choose".

### 3.4 Overlays and their chrome travel together
A layer *owns* its legend / value-axis / color key. Toggling the layer's eye shows/hides its key with it; keys auto-place clear of the tree (the decoration-offset work already landed). Add one contextual **"Legends & keys"** disclosure that lists only the keys currently on the figure (position, show/hide, order) — so the legend controls themselves are progressively disclosed: no visible data layers → no legend controls at all.

### 3.5 The layer stack is TYPED into three groups (not a flat equal list)
A flat stack hides that the rows are fundamentally different things. The stack is grouped, and each group gets its own visual language so a glance tells you what you're looking at (decided 2026-06-14):

- **Tree elements** — *intrinsic styling of the tree itself* (tip labels, tip points, branch support, node points). These always exist; you are styling something already on the tree. **Non-removable: show/hide + restyle only, no delete** (Grant, 2026-06-14) — deleting "tip labels" makes no sense; you hide them. Treatment: lighter/flatter rows grouped under one hairline, no drag grip, a quiet `style` pill, **no data-source chip**. They deliberately recede.
- **Data overlays** — *things that exist only because you attached data* (color strip, heatmap, bar, boxplot, point+error, Data Hub plot). Treatment: full cards, blue left-accent, drag-reorder + hide + **remove** (remove takes the data off the figure), and — the load-bearing differentiator — a **data-source chip** naming exactly what it's bound to (`section`, `genome size +2`, `Genome stats`) with a db/chart icon. You can never confuse "I'm styling the tips" with "I attached the genome-size column."
- **Highlights** — *annotations on the tree* (clade, span strip, tip links, node pies). Treatment: amber left-accent, callout/container rows with a count badge + **nested annotation rows** (Data-Hub-rail family-tree style) so the one-layer-holds-many relationship is visible.

Every row still has a **mini preview swatch** (the geom's actual look), inline rename, and selecting it swaps the inspector to its fields (Illustrator Properties model). The three groups map **1:1 to the Smart Add menu categories**, and **"remove" only ever appears on things safe to remove** (overlays + highlights, never tree elements). Mockup of the typed stack: shown + approved 2026-06-14.

---

## Decisions to approve

1. **One Figure panel with Shape + Layers sections** (fold the top toolbar strip + Setup→Tree into Shape; Page-frame settings move inline). — *the structural change.*
2. **Declarative per-kind field schema** driving both the inspector and the Add menu (type-filtered columns, no-op fields removed). — *the contextual-settings engine.*
3. **Data Hub becomes a normal layer kind** in the Smart Add menu (fix the split entry), constraint-aware.
4. **Layer owns its legend/key**; one contextual "Legends & keys" area; nested annotation rows for container kinds.
5. **Preview swatches + inline rename** on layer rows.
6. **APPROVED 2026-06-14 — the typed three-group stack** (Tree elements / Data overlays / Highlights), each with its own visual treatment; **Tree elements are non-removable** (style + show/hide only); **added overlays wear a data-source chip**; groups map 1:1 to the Smart Add categories; "remove" never appears on tree elements. See §3.5.

## Build sequencing (after approval, all additive — `AlignedPanel.options` seam + `figureToRenderSpec` stay the contract)
- **Phase 0 (pure, low-risk): ✅ BUILT + BROWSER-VERIFIED 2026-06-14.** `lib/phylo/layer-schema.ts` (category / removability / column-type filters / legend / error-bar / scale rules, 21 unit tests) now drives the existing inspector — no layout moved. Type-filtered column pickers (size-by numeric, shape-by categorical, value/error/replicate numeric; an active binding is never dropped), the sd/sem no-op collapsed to a "Show error bars" toggle in value mode, the boxplot's inert Legend toggle removed, and bars/dots' categorical-scale no-op replaced by a "Color by value" toggle. Whole-repo tsc 0, 296 phylo tests. Claude-in-Chrome verify: all 5 checks PASS, console clean (Aspergillus 7-tip sample, columns section/gliP categorical + genome numeric). Files: `layer-schema.ts` + test, `PhyloLayers.tsx`, `PhyloStudio.tsx`.
- **Phase 1: ✅ BUILT + BROWSER-VERIFIED 2026-06-14.** Smart Add is now constraint-aware (overlays whose data is missing render greyed with a reason — "needs a numeric column / metadata column / aligned FASTA / timed tree / Data Hub table"; available kinds sort to the top of each category). **Data Hub is a first-class layer kind** in the Add menu (inline table picker, auto-best join column) — fixes the old hidden/split entry. Add-by-name: type to filter, Enter adds the top available match. Schema gained `kindNeeds`/`kindAvailable`/`unmetReason` + `LayerCapabilities` (24 schema tests). Whole-repo tsc 0, 301 phylo tests. Claude-in-Chrome verify: all 5 checks PASS, console clean (greyed pre-bind → enabled post-bind, Data Hub plot added from menu, "heat"+Enter added a Heatmap). datahubPlot's selected inspector shows a note + width; its bar mode still lives in Setup until the Phase 2/3 reorg.
- **Phase 2: ✅ BUILT + BROWSER-VERIFIED 2026-06-14.** Tab IA is now **Shape · Layers · Data · Export · Code** (Grant picked a dedicated Data tab over folding binding into Layers). The top toolbar strip above the canvas is removed; its controls (layout, phylogram/cladogram, scale bar/root edge/time axis) moved into **Shape** alongside the Tree card (change/ladderize/reroot/branch-color/rotate-clade) and the **Page frame toggle with its paper/orientation/width controls inline** (out of Export). **Data** = the old Setup minus Tree (Metadata/Alignment/Data Hub source). **Export** keeps SVG/PNG/Copy/Page/Save (a line points page-size to Shape). **Data Hub bar-mode moved onto the layer inspector** (writes `options.barMode`, same resolution path; removed `setPanelBarMode` + the Data-tab per-panel list). Whole-repo tsc 0, 301 phylo tests. Claude-in-Chrome verify: tabs/Shape/Data/Export all PASS; bar-mode relocation structurally PASS + functional (its visual render needs a Data Hub table that actually joins to the tips — orthogonal to the move, confirmed rendering in the Phase 1 verify).
- **Phase 3:** scannable rows (swatches, nested annotations, rename) + contextual Legends & keys.

Each phase is independently shippable and browser-verifiable.

## Out of scope / respected seams
`AlignedPanel.options` key names (read by `render.ts` + `ggtree-code.ts`), the `tracks→panels` projection, the `alignedAxis` Data Hub contract (layout-only), `figureToRenderSpec` as the sole render mapping, `buildColorScale` as the single color source. The redesign is UI + a schema layer on top; the render core doesn't change.
