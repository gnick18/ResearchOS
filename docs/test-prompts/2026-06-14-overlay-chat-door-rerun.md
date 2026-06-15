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
A-H) which ALREADY carries the GUI door's two overlays (MIC as bars, phenotype as
a color strip). If those are gone, run the full script
`docs/test-prompts/2026-06-14-phylo-phase4-joint-chrome-test.md` instead.

## Steps

1. Go to `/phylo` and open **Phase4 Tree** (this publishes it to the BeakerBot
   context bridge). Confirm the tree already shows the GUI overlays (a MIC bar
   panel + a phenotype color strip).

2. Open **BeakerBot**, start a fresh chat, and send exactly:

   `What data can I overlay on this tree?`

   EXPECT: `suggest_tree_overlays` fires, resolves "this tree" to Phase4 Tree via
   the bridge, and narrates the facts: resistance_assay joins **7 of 8 tips**, MIC
   offers bars/heatmap/dots/point, phenotype a color strip. The **inline wizard**
   mounts below the reply (same widget as the GUI door).

3. In the wizard, pick **MIC -> Heatmap** (a DIFFERENT geom than the GUI door's
   bars, on the SAME column), then **Add**.

4. EXPECT (the bug fixes):
   - **bug 1 (persist)**: the Heatmap overlay actually lands. A heat panel bound
     to the **MIC** column appears, and it is a SECOND panel on the one "MIC"
     column (NOT a duplicate "resistance_assay:MIC" column).
   - **bug 2 (result card)**: the wizard is replaced **in place** by a live tree
     card of the now-overlaid Phase4 Tree (with its own "Open" button). It does
     **NOT** auto-navigate you away to /phylo.

5. **Reload** `/phylo?doc=<Phase4 Tree id>`. EXPECT the MIC heatmap overlay is
   STILL there (it persisted to the saved figure), alongside the GUI's MIC bars +
   phenotype strip.

## Pass / fail
- PASS: narration matches the engine facts, the wizard mounts, Add lands a real
  persisted MIC heatmap layer (one MIC column, two panels), the live card replaces
  the wizard with no navigation, and the overlay survives reload.
- FAIL (relay the symptom + any tool chip / console error):
  - "Added" toast but no heat layer / gone after reload -> bug 1 regressed (the
    loud-fail guard should instead surface an error, so a SILENT success with no
    layer is the worst case to report).
  - a duplicate "resistance_assay:MIC" column instead of a 2nd panel on "MIC" ->
    the engine reuse did not apply in the running checkout.
  - auto-navigates to /phylo with no in-chat card -> bug 2 regressed.

Report the result so BeakerAI + Phylo can close the joint check (or pair if it
still no-ops).
