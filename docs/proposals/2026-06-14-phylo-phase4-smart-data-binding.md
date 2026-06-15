# Phylo Tree Studio — Phase 4: Smart Data Binding (auto-detect joinable tables + add-data wizard)

**Date:** 2026-06-14
**Lane:** phylogenetics / Tree Studio (`/phylo`)
**Status:** BUILT + APPROVED (Grant re-approved 2026-06-15). All 3 build-order steps complete and committed on local main: (1) `smart-binding.ts` engine + 12 unit tests, (2) `SmartDataWizard.tsx` mounted in `PhyloStudio` (Add menu + auto-suggest banner), (3) BeakerBot `suggest_tree_overlays` tool (`src/lib/ai/tools/phylo-tools.ts` + `overlay-wizard.ts` + `overlay-commit.ts`, with tests). Gate green: `tsc --noEmit` 0; 328 phylo + overlay tests pass. REMAINING = Claude-in-Chrome browser verify of both front doors (see `docs/handoffs/CHROME_VERIFY_PHYLO_PHASE4_SMART_BINDING.md`). Builds on the LOCKED Phases 0–3 findability redesign + the `layer-schema.ts` engine.
**Mockup:** `docs/mockups/2026-06-14-phylo-phase4-smart-data-binding.html`
**Memory:** `project_phylo_tree_studio_redesign` (Phase 4 captured), `[[feedback_beakerbot_no_interpretation]]`, `[[project_beakerbot_record_set_widget]]`.

---

## The problem

After Phases 0–3 the hub is *coherent* but still *passive*: the user has to know that a table elsewhere in their collection can be overlaid on the open tree, hunt for it, add it, and pick a join column. Most users never discover that their resistance table or growth-rate sheet *could* sit on the tree.

**Phase 4 makes the hub proactive: it finds data that can go on the tree, ranks it by how well it joins, enumerates the overlays each column can drive, and lets the user add one or several at once — as a guided wizard.** Same idea Grant locked: *the hub should find the data, not make the user hunt for it.*

---

## Two non-negotiable constraints (Grant, locked)

1. **ONE shared engine, TWO front doors.** The deterministic core — detect joinable tables, rank by tip-coverage, enumerate the overlays each column can drive, perform the add — is a reusable pure module + a wizard widget. The `/phylo` GUI mounts it. **BeakerBot mounts the SAME widget inline in chat** via a tool when a prompt calls for it ("what data can I put on this tree?", "overlay my resistance data"). No parallel LLM-only reimplementation of the join/suggest logic.
2. **Deterministic tools compute, the model only narrates.** Every join-rate number, every "possible plots" enumeration, every actual add is done by the engine. BeakerBot only picks/justifies a table or column in prose and walks the user through the steps. This is the established BeakerBot rule (`[[feedback_beakerbot_no_interpretation]]`).

---

## What already exists (this is wiring, not new infra)

| Need | Existing piece | Location |
|---|---|---|
| Tip-coverage of a table column | `datahubJoinRate(content, joinColumnId, tree): number` (0..1) | `lib/phylo/datahub-panel.ts:77` |
| Add a table as a panel (auto-best join col) | `addDatahubFromTable(tableId)` | `components/phylo/PhyloStudio.tsx:581` |
| Candidate tables in the same collection | `dataHubApi.listByProject(projectId)` / `listByFolder(projectId, folderPath)` | `lib/datahub/api.ts:121,131` |
| Load a table's content | `dataHubApi.getContent(tableId)` | `lib/datahub/api.ts` |
| Numeric vs categorical column | `classifyColumn(root, metadata, column): "numeric"\|"categorical"` | `lib/phylo/color-scale.ts:71` |
| Which overlay kinds a column can drive | `kindNeeds` / `columnFilterFor` / `kindAvailable` + `LayerCapabilities` | `lib/phylo/layer-schema.ts:67,174,179` |
| Open tree's tips | `leaves(tree)` → `.name` / `.id`; `tree` in `PhyloStudio` state | `lib/phylo/parse.ts:294` |
| Constraint-aware chooser UX to mirror | `NewAnalysisDialog` (only-what-fits) | `components/datahub/NewAnalysisDialog.tsx` |
| Gallery picker UX to mirror | `AddFigurePicker` + `buildPickerView` + `onPickMany` + thumbnail render | `components/figure/FigureComposer.tsx:825`, `lib/figure/picker-view.ts:45` |

**Overlay kinds an overlaid table can drive** (from `layer-schema.ts` / `types.ts:178`): numeric column → `heat` / `bars` / `dots` / `point` (point+error) / `scatter`; categorical column → `strip` (color strip) / `nodepie` (node pies); the table itself → `datahubPlot` (grouped-bar panel).

---

## Add mechanism — LOCKED: per-column overlays (Grant 2026-06-14)

A joined table's chosen columns become **native per-column overlay panels** (`heat`/`bars`/`dots`/`point` for numeric, `strip` for categorical) — each a first-class, individually-restyleable layer in the stack — NOT a single whole-table `datahubPlot`. Rationale: matches the approved mockup's per-column "possible plots", and the overlay reads/restyles exactly like any hand-bound overlay.

**Consequence (NOT pure wiring):** native overlays bind to the tree's **metadata** (`panel.column` → a metadata column), and a tree holds ONE `PhyloMetadataBinding` (`types.ts:249`, inline `rows` keyed by `tipColumn`, or one linked Data Hub table). So Phase 4 needs a new **metadata-merge step**: take the joined table content (`joinContentToTips` already keys rows to tips), and merge the chosen columns into the tree's inline-rows metadata binding — handling (a) no existing binding, (b) an existing inline-rows binding (union columns on the shared tip key), (c) an existing linked-table binding (materialize to inline rows, then merge), and (d) column-name collisions (namespace as `<table>:<col>` or suffix). The wizard's "Add N overlays" then: merge-once, then append one overlay panel per chosen (column, geom).

This merge logic is pure + unit-testable and lives in the engine module alongside the ranking.

## The engine (new, pure, unit-testable)

New module `frontend/src/lib/phylo/smart-binding.ts` — no React, no I/O beyond what's passed in. Mirrors the pure+tested discipline of `layer-schema.ts`.

```
type JoinCandidate = {
  tableId: string;
  tableName: string;
  bestJoinColumnId: string;
  bestJoinColumnName: string;
  joinRate: number;          // 0..1, from datahubJoinRate
  matchedTips: number;       // joinRate * tipCount, for "joins N of M tips"
  totalTips: number;
  overlays: OverlaySuggestion[];
};

type OverlaySuggestion = {
  columnId: string;
  columnName: string;
  columnKind: "numeric" | "categorical";
  kinds: AlignedPanelKind[];     // overlay kinds this column can drive
  recommendedKind: AlignedPanelKind;  // the default thumbnail/preview
};

// Pure: given the open tree + the loaded contents of candidate tables, rank them.
rankJoinCandidates(tree, tables: {id,name,content}[]): JoinCandidate[]
//   - for each table: find the column with the highest datahubJoinRate as bestJoinColumn
//   - drop tables whose best rate is 0 (no usable join)
//   - for every OTHER column, classifyColumn + map to overlay kinds via columnFilterFor/kindNeeds
//   - sort candidates by joinRate desc (highest-coverage tables first)

enumerateOverlays(tree, content, joinColumnId): OverlaySuggestion[]
//   - the "possible plots" logic, reused by both the table card and the column step
```

The component layer (`PhyloStudio` / a BeakerBot tool) loads the candidate table contents (async `dataHubApi`), then calls these pure functions. The engine never fetches.

---

## The wizard widget (new, shared)

New component `frontend/src/components/phylo/SmartDataWizard.tsx` — a self-contained widget the GUI mounts in the Add menu AND BeakerBot mounts inline in chat. Three steps:

### Step 1 — "Tables that can go on this tree"
Auto-runs on open. A ranked list of `JoinCandidate`s, each a card:
- table name + type
- **join-rate chip**: "joins 42 of 50 tips" (partial coverage is fine and shown honestly — it does NOT need 100%)
- a one-line preview of what it enables: "3 numeric columns → heatmap, bars, points · 1 category → color strip"
- highest-coverage tables float to the top; a quiet "Open anyway" affordance on low-coverage tables (no soft-lock — `[[feedback_no_soft_locks]]`).

If nothing joins: an explicit empty state ("No table in this collection shares a column with these tip labels"), not a dead end.

### Step 2 — "Which columns to overlay"
Pick a table → its columns as a constraint-aware multi-select (mirrors `NewAnalysisDialog`): each column shows its kind (numeric/categorical) and the overlay kinds it can drive. The join column is shown as the anchor (locked, like Phase 0's "active binding never dropped"). Columns that can't drive any overlay are greyed with a reason (reuse the Phase 1 `unmetReason` pattern).

### Step 3 — "Possible plots" gallery
For the chosen columns, a gallery of the DIFFERENT overlays possible (mirrors `AddFigurePicker`): each is a **live preview thumbnail** rendered through the real render path (same discipline as `FigureSource.render` thumbnails). Multi-select → **one "Add N overlays"** button adds them all at once (the `onPickMany` pattern), each via the existing `addDatahubFromTable`-style insert (auto-join-column already resolved in step 1).

**Auto-suggest on tree open (the proactive bit):** when a tree opens with ≥1 joinable table, a quiet inline banner in the Layers tab — "3 tables in this collection can overlay this tree" → opens the wizard at Step 1. Dismissable, non-modal.

---

## BeakerBot front door

A new tool (coordinate the surface with the BeakerAI lane, owner of `src/lib/ai/tools/*`) — e.g. `suggest_tree_overlays` — that:
1. calls the SAME engine (`rankJoinCandidates`) to get the deterministic ranked candidates,
2. renders the SAME `SmartDataWizard` widget inline in chat (the inline-widget-in-chat pattern, `[[project_beakerbot_record_set_widget]]`),
3. lets the model narrate ("Your `resistance_assay` table joins 48 of 50 tips — its MIC column could be a heatmap or a bar overlay") and walk the user through, while the user drives the widget.

The model never computes a join rate or invents an overlay — it reads them off the engine output and explains/justifies.

---

## Decisions — LOCKED (Grant 2026-06-14)

1. **Auto-suggest aggressiveness** — ✅ **Quiet, dismissable, non-modal banner** in the Layers tab ("N tables can overlay this tree" → opens the wizard). Also reachable any time from the Add ＋ menu. NOT auto-open.
2. **Collection scope** — ✅ **Same project** (`listByProject`), with a **folder filter chip** to narrow.
3. **Step 3 multi-add target** — ✅ **One table per run** (add several of that table's overlays at once), BUT after the add, the wizard shows an **"＋ Add another table"** loop-back that returns to Step 1 so the user keeps going without closing/reopening. Make the loop feel smooth.
4. **Low-coverage threshold** — ✅ **Show all tables with rate > 0**, sorted high→low, rate visible so the user judges. No hidden floor.

## Build order (after mockup approval)
1. `smart-binding.ts` engine + unit tests (mirror `layer-schema.ts` test style; assert ranking + overlay enumeration against fixtures).
2. `SmartDataWizard.tsx` widget (GUI mount in the Add menu + the auto-suggest banner).
3. BeakerBot tool wiring (with the BeakerAI lane).

## Gate to re-run
`cd frontend && npx tsc --noEmit` (0) + `npx vitest run src/lib/phylo` + icon-guard.
