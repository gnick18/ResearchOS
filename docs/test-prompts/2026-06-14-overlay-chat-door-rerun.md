# Smart Data Binding — chat-door re-run (Claude in Chrome)

Fast re-run of ONLY the chat door, after the two host-commit fixes. The shared
engine + GUI door already passed the full joint test; only the chat door's "Add"
failed (bug 1 silent no-op + bug 2 no result card). Both are now fixed:
- bug 1: phylo lane's `mergeTableColumnsIntoMetadata` reuse (`ed9a3cc1f`) reports an
  already-present column in `addedColumns`, so the chat host binds + persists the
  panel; the host also fails loudly now if nothing resolves (`15c7425ff`).
- bug 2: on Add the chat host replaces the wizard in place with a live tree-embed
  card (no auto-navigate) (`c8c838f24`).

Run on **http://localhost:3000** (authenticated, real folder). This reuses the
first joint run's artifacts still on the machine: project "Phase4 Test", table
"resistance_assay" (strain_id A..G + MIC + phenotype), and "Phase4 Tree" (8 tips
A-H).

**STATE NOTE (2026-06-15, verified by Grant):** the on-disk Phase4 Tree currently
carries a SINGLE **MIC heatmap** overlay (MIC metadata bound 8/8), NOT the
original GUI door's "MIC bars + phenotype strip". The artifacts are NOT gone
(project + table + tree + bound metadata all present), so the full re-seed script
is NOT required. We adapt the geom choice to preserve the test's intent: the
chat door must add a DIFFERENT geom on the SAME already-bound MIC column. Since
the existing panel is a heatmap, we add **Bars** (not heatmap). This still
exercises the exact fixed path (re-adding an already-bound column -> reported in
`addedColumns` -> host binds + persists a 2nd panel). If the project/table/tree
themselves are gone, run the full script
`docs/test-prompts/2026-06-14-phylo-phase4-joint-chrome-test.md` instead.

## Steps

1. Go to `/phylo` and open **Phase4 Tree** (this publishes it to the BeakerBot
   context bridge). Confirm the current state: a single **MIC heatmap** panel
   (Layers: Tree -> Heatmap (MIC) -> Tip labels; "Heatmap key - MIC" legend;
   Data panel shows tip column "tip" matched 8/8).

2. Open **BeakerBot**, start a fresh chat, and send exactly:

   `What data can I overlay on this tree?`

   EXPECT: `suggest_tree_overlays` fires, resolves "this tree" to Phase4 Tree via
   the bridge, and narrates the facts: resistance_assay joins **7 of 8 tips**, MIC
   offers bars/heatmap/dots/point, phenotype a color strip. The **inline wizard**
   mounts below the reply (same widget as the GUI door).

3. In the wizard, pick **MIC -> Bars** (a DIFFERENT geom than the existing
   heatmap, on the SAME already-bound MIC column), then **Add**.

4. EXPECT (the bug fixes):
   - **bug 1 (persist)**: the Bars overlay actually lands. A bar panel bound to
     the **MIC** column appears, and it is a SECOND panel on the one "MIC" column
     alongside the existing heatmap (NOT a duplicate "resistance_assay:MIC"
     column).
   - **bug 2 (result card)**: the wizard is replaced **in place** by a live tree
     card of the now-overlaid Phase4 Tree (with its own "Open" button). It does
     **NOT** auto-navigate you away to /phylo.

5. **Reload** `/phylo?doc=<Phase4 Tree id>`. EXPECT BOTH MIC panels (the new bars
   + the pre-existing heatmap) are STILL there (they persisted to the saved
   figure).

## Pass / fail
- PASS: narration matches the engine facts, the wizard mounts, Add lands a real
  persisted MIC bars layer (one MIC column, two panels: bars + existing heatmap),
  the live card replaces the wizard with no navigation, and BOTH overlays survive
  reload.
- FAIL (relay the symptom + any tool chip / console error):
  - "Added" toast but no heat layer / gone after reload -> bug 1 regressed (the
    loud-fail guard should instead surface an error, so a SILENT success with no
    layer is the worst case to report).
  - a duplicate "resistance_assay:MIC" column instead of a 2nd panel on "MIC" ->
    the engine reuse did not apply in the running checkout.
  - auto-navigates to /phylo with no in-chat card -> bug 2 regressed.

Report the result so BeakerAI + Phylo can close the joint check (or pair if it
still no-ops).
