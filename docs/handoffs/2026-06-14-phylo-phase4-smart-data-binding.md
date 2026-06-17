# Handoff — Phylo Phase 4: Smart Data Binding (auto-detect joinable tables + add-data wizard)

**Date:** 2026-06-14
**Lane:** phylogenetics / Tree Studio (`/phylo`) + cross-lane with **BeakerAI** (the chat front door)
**Status:** Design APPROVED + LOCKED. **GUI front door BUILT + browser-verified + on origin/main.** Chat front door BUILT by BeakerAI. **JOINT CHECK CLOSED ✅ (2026-06-15, Grant's authed :3000).** Both chat-door bugs verified FIXED on the running checkout: bug 1 (persist) + bug 2 (in-place result card). Adapted re-run (MIC->Bars on the already-bound MIC column, since on-disk state had drifted to a lone MIC heatmap) PASSED: two MIC panels (bars + heatmap) landed on the single `MIC` column, both legends + render persisted through a full reload, wizard replaced in place by a live tree card, no auto-navigate. CORE PROVEN earlier (one engine, two doors, identical detection). **Only the bridge `projectIds` follow-up remains (now landing, coordinated w/ BeakerAI).**

Memory: `project_phylo_tree_studio_redesign` (Phase 4 section). Proposal: `docs/proposals/2026-06-14-phylo-phase4-smart-data-binding.md`. Mockup: `docs/mockups/2026-06-14-phylo-phase4-smart-data-binding.html` (light-default + dark toggle). Joint test script: `docs/test-prompts/2026-06-14-phylo-phase4-joint-chrome-test.md`.

---

## The feature
When a tree is open, the hub proactively finds Data Hub tables in the tree's collection that join its tip labels, ranks them by tip-coverage, enumerates the overlays each column can drive, and adds them via a 3-step wizard. **ONE deterministic engine, TWO front doors** (the `/phylo` GUI wizard + a BeakerBot inline tool mounting the SAME widget). Engine computes every join-rate / possible-plot / the add; the model only narrates.

## Locked decisions (Grant 2026-06-14)
- Auto-suggest = **quiet dismissable banner** ("N tables can overlay this tree") + a persistent "Find data for this tree" button; NOT auto-open.
- Scope = **same project** (`listByProject`); unsaved/unfiled tree has no collection -> no suggestions.
- **One table per wizard run**, several overlays at once, + an **"Add another table" loop-back** on the done step.
- Show **all tables with rate > 0**, sorted, rate visible.
- Add mechanism = **per-column overlays**: merge a joined table's chosen columns into the tree's ONE tip-keyed metadata binding, then native `heat`/`bars`/`dots`/`point`/`strip` panels per column (NOT a whole-table `datahubPlot`).

---

## What shipped (all origin/main unless noted)

### Engine — `frontend/src/lib/phylo/smart-binding.ts` (pure, 12 unit tests)
- `rankJoinCandidates(tree, tables)` — rank a collection's tables by tip-coverage, drop zero-join/key-only, stable on ties.
- `enumerateOverlays(tree, content, joinColumnId)` — per non-join column: classify numeric/categorical -> drivable geoms (numeric=bars/heat/dots/point, category=strip); skip all-blank cols + the join key.
- `mergeTableColumnsIntoMetadata(...)` — merge chosen columns into tip-keyed metadata (fresh when unbound, preserve existing + append rows otherwise). **REUSES an already-merged identical (table,column)** instead of namespacing a duplicate (so "same column, many geoms" = 2 panels on 1 column); genuine collisions still namespace.
- `geomsForKind(kind)`. Reuses `datahubJoinRate` / `matchMetadataToTips` / `classifyColumn`.
- Commits: `f9449efa2` (engine), `ed9a3cc1f` (reuse refinement).

### Widget — `frontend/src/components/phylo/SmartDataWizard.tsx` (self-contained, icon-guard clean)
3-step wizard (pick table -> columns -> geom gallery) + done step with "Add another table" loop-back. **Prop contract** (what both front doors mount): `candidates: JoinCandidate[]` in; `onAddOverlays({tableId, tableName, joinColumnId, selections})` out (host owns the write); `onClose`. Presentational, reads NO page/store/router state. Geoms shown as labeled cards (live thumbnails deferred — see below). Header glyph = `bolt`.
- Commits: `51c381246` (widget), `308b136db` (removed unused done-step Open props — see Bug 2).
- **ICON-GUARD GOTCHA:** the guard counts ANY `<svg` substring incl. in COMMENTS. No inline SVG anywhere; live preview thumbnails need a render path AND a Grant-signed icon-baseline bump.

### GUI mount — `frontend/src/components/phylo/PhyloStudio.tsx`
Candidate scan on tree open (**project-scoped** via `dataHubApi.listByProject`, unioned/deduped across the tree's projects; `openTreeProjectIds` state captured from saved meta in `onPickSaved`, cleared on import), the banner + "Find data" button in the Layers tab, `addSmartOverlays` handler (merge + `makePanel(geom,[name])` spliced before labels), wizard as a centered overlay; banner re-arms per saved tree (`openTreeId`).
- Commits: `6d3145ebb` (wiring), `9cd1d6ac2` (project-scope alignment).

### Chat front door — BeakerAI lane (`src/lib/ai/tools/*`, `overlay-commit.ts`)
- `suggest_tree_overlays` tool (`60b2af01a`): resolves the open tree via the context bridge (deictic "this tree" handled), calls the SAME engine, narrates ranked facts, mounts `<SmartDataWizard>` inline (their `_ui` seam strips the payload before the model).
- Host commit `onAddOverlays`: `mergeTableColumnsIntoMetadata` + `makePanel` spliced before labels, persisted via `phyloApi.updateMeta`; **loud-fail guard** if no panel resolves (`15c7425ff`); on success replaces the wizard in place with a live `<ObjectEmbed>` tree card (`c8c838f24`).
- **Pass-through confirmed:** `overlay-commit.ts:66` passes `columnIds` straight to the engine, NO "already-bound" filter.
- ALSO built by BeakerAI (now on origin/main, Grant said push): `create_datahub_table` (`0b8d69552`, one-shot table creation via `importTextToTable` + `dataHubApi.create`, `table_type:"column"` — shape confirmed correct) and `compare_tree_recipes` (`ffdb9ab2c`, the PDF-reproduce light-comparison carve-out).

---

## Joint Chrome check (ran on Grant's authed :3000)
**CORE PROVEN:** both doors gave IDENTICAL detection + ranking (resistance_assay, "joins 7 of 8 tips", MIC bars/heat/dots/point, phenotype strip). **GUI door FULL PASS + persists.** Chat door narrated correctly + rendered the inline wizard. Two chat-door bugs, BOTH FIXED:
1. **Silent no-op persist** (heat overlay claimed "Added" but never landed): fixed by the engine reuse refinement (`ed9a3cc1f`, re-added MIC now reported in `addedColumns` so the host binding fires) + BeakerAI's loud-fail guard (`15c7425ff`).
2. **No tree card** at end of chat reply: fixed by BeakerAI's in-place `<ObjectEmbed>` card (`c8c838f24`); my done-step props approach was reverted (`308b136db`).

## THE ONLY THING LEFT — fast chat-door re-run
Artifacts from run 1 are still on Grant's `:3000`: **Phase4 Test** project, **resistance_assay** table, **Phase4 Tree** (w/ 2 GUI overlays). Dedicated re-run prompt (BeakerAI authored): **`docs/test-prompts/2026-06-14-overlay-chat-door-rerun.md`** — chat-door-only, no re-seeding (falls back to the full joint script if artifacts are gone):
1. Open **Phase4 Tree** in `/phylo`. 2. BeakerBot -> **"What data can I overlay on this tree?"**. 3. Inline wizard -> **MIC -> Heatmap** -> Add. 4. VERIFY: heatmap lands as a real layer on the one `MIC` column (alongside bars), survives reload, wizard replaced in place by the live tree card.
Decisive: persists = closed; still no-ops = BeakerAI's guard makes it fail LOUDLY and they pair immediately. Whole-repo tsc = 0, both lanes' commits on origin/main AND the `:3000` checkout (they match). Run against either.

## Open follow-ups (none blocking)
- **Bridge `projectIds` — LANDED ✅ (2026-06-15, commit `e81e1f882`, both lanes credited, whole-repo tsc 0).** Three files: `context-bridge.ts` (`projectIds?: string[]` on `BeakerSelection`, BeakerAI), `PhyloStudio.tsx` (publish `projectIds: openTreeProjectIds` on the selection + dep array; `openTreeProjectIds` useState hoisted above the publisher effect to fix declaration order, mine + BeakerAI), `create-datahub-table.ts` (consume: `getBeakerContext().selection?.projectIds?.[0]` as the default when the model passes no explicit `projectId`; explicit still wins, BeakerAI). End-to-end: "make a table from this and put it on my tree" now files into the open tree's project. LOCAL-only (held with `a3682f3fd` pending Grant's push).
- **Live preview thumbnails** in the geom gallery — deferred (render path + icon-baseline sign-off).
- **Sparkle glyph** — header uses `bolt`; a dedicated sparkle needs Grant sign-off.
- **create_datahub_table / compare_tree_recipes push** — BeakerAI's call + Grant's (held local).

## Gate to re-run before any change here
`cd frontend && npx tsc --noEmit` (0) + `npx vitest run src/lib/phylo` (314) + icon-guard. ZoomPanCanvas/UI interaction verified manually.

## DEPLOY POSTURE (read this)
My pushes carried BeakerAI's earlier ADDITIVE commits (`60b2af01a`/`15c7425ff`/`c8c838f24`) to origin via shared main (they're ancestors of my HEAD). BeakerAI confirmed harmless (additive AI tools, lab tier stays flag-gated) but had been HOLDING pushes; their latest two (`0b8d69552`, `ffdb9ab2c`) are LOCAL-ONLY pending Grant's say. **I agreed to STOP pushing shared main while BeakerAI's lane is staging.** A future agent on this lane: do NOT `git push origin main` without checking whether another lane is holding commits (`git log origin/main..main`).

## Unrelated quick fix this session
Landing page (`OAuthFirstLanding.tsx`): the Made-in-Madison badge was clashing with the centered "What is ResearchOS?" scroll affordance -> moved to the empty bottom-right corner + sized up (`6c050b4ea`, browser-verified). Shared `MadeInMadison` untouched. Also added memory `feedback_mockups_light_default` (quick mockups light by default; dark only as a toggle, never forced via prefers-color-scheme).
