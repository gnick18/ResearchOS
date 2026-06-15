# Claude-in-Chrome test — Figure Composer styling Phase 3 (generalized)

**DO NOT RUN until Phase 3 is merged into the running `:3000` checkout.** Phase 3
lives on branch `worktree-figure-style-phase3` until the Phase 1/2 verify is signed
off; testing before the merge just re-tests old code. Once merged + the dev server
has reloaded, paste below the line into a fresh Claude-in-Chrome session.

**What Phase 3 changed:** the composer's Style inspector is now generic — each
source declares its own option controls (`FigureSource.styleSchema()`), so panels
beyond sequences get style controls:
- **Data Hub** plot -> a **Color palette** dropdown (recolors the whole figure).
- **phylo** tree -> **Scale bar / Legend / Root edge** checkboxes.
- **sequence** -> the same Thickness + ruler/label controls as before (now via the
  generic path; this is a no-regression check).
- **chemistry** molecule -> intentionally **no** Style controls (documented).

**Folder rule:** Part A is **demo mode** (parallel-safe, zero setup). Parts B-D need
a real folder; reuse the SAME folder/session from the Phase 1/2 styling test
(`feedback_chrome_test_one_folder_demo_parallel`). Run Part A first if the Phase 1/2
test is still using the folder.

Why Chrome not Preview/Playwright: swatches, sliders, dropdowns, and panel selection
use real pointer events (`feedback_mouse_testing_via_chrome_extension`).

---

You are testing **Phase 3 of in-app figure styling** on ResearchOS at
**http://localhost:3000**: the composer's Style inspector is now driven by a generic
per-source schema, so Data Hub / phylo / sequence panels each get their own style
controls and chemistry gets none. Drive the browser yourself, report PASS/FAIL with
what you saw, and **do not edit any code**. Keep the console open the whole time.

**FOCUS FOR THIS RUN:** Part A (Data Hub palette) and Part C (sequence) already
passed in a prior run. The goal now is to get **Part B (phylo)** and **Part D
(chemistry)** to actually run — the last run was blocked because the trees/molecules
were never SAVED into the library. The steps below now spell out the exact save
controls. Run B and D for real; re-running A and C is optional confirmation.

## Part A — Data Hub palette (DEMO MODE, no folder needed)

1. Go to **http://localhost:3000/demo**, wait for the workbench to load.
2. Go to **http://localhost:3000/figures** -> **New figure** -> **Add figure** ->
   add one **Data Hub plot** (any of the seeded demo plots) -> it lands as a panel.
3. **Select the panel.** In the right rail "Selected panel" card, below "Show plot
   title", a **Style** section appears with a **Color palette** dropdown (it should
   read "Plot default" initially). PASS if the dropdown is present.
   - (A Data Hub plot has no per-feature swatch list — that is expected. Only the
     palette dropdown should show here.)
4. **Change the palette.** Pick a clearly different palette (e.g. "Okabe-Ito",
   "ColorBrewer Set1", "Paul Tol bright"). PASS if the plot's series **recolor live**
   to the new palette (bars/points change color, no reload).
5. **Back to default.** Set the dropdown back to "Plot default". PASS if the plot
   returns to its original colors.
6. **Persists.** Reload `/figures/<id>`. If you left a non-default palette selected,
   the panel should come back recolored (the override is saved on the figure page).
   PASS/observe.

## Part B — phylo tree toggles (REAL FOLDER)

**Heads-up (this blocked the last run):** rendering a tree in Tree Studio is only a
live PREVIEW — it does NOT persist until you click **Save to my trees**, and only
SAVED trees appear in the figure-composer picker. Do NOT use the "Import" file
button (it opens an OS file dialog you cannot drive); paste the Newick instead.

7. Open **Phylo / Tree Studio** (`/phylo`). If there is already a saved tree, use it.
   Otherwise create one WITHOUT a file dialog:
   a. Start a new tree (e.g. "New tree" in the collection rail) and **paste this
      Newick** into the tree-text input: `((A:1,B:1):1,(C:1,D:1):1);` (or click "Try
      a sample"). A tree should render in the canvas.
   b. **Click the "Save to my trees" button** (a save-icon button below the Export
      controls). You should see the confirmation **"Saved to your trees"**, and the
      tree should now appear in the collection rail (the list goes from 0 -> 1 tree).
      If you do not see "Saved to your trees", the save did not happen — say so.
8. In **/figures**, **Add figure** -> the saved **tree** should now be listed under a
   "Phylogenetic tree" heading. Add it as a panel -> select it.
   The Style section should show **three checkboxes**: **Scale bar**, **Legend**,
   **Root edge** (no swatch list — phylo has no per-element targets yet). PASS if all
   three render.
9. **Toggle each:**
   - Uncheck **Scale bar** -> the scale-bar ruler under the tree disappears; re-check
     -> returns.
   - Toggle **Legend** -> a legend appears/disappears (most visible if the tree has a
     colored metadata track; if the tree has no legend to show, note that and move on).
   - Check **Root edge** -> a short stub line appears at the tree root; uncheck ->
     gone.
   PASS for each that visibly responds. Flag any that do nothing.

## Part C — sequence no-regression (REAL FOLDER, reuse the annotated sequence)

10. Add your **annotated sequence** from the Phase 1/2 test as a panel -> select it.
    Confirm the Style section still shows the **feature swatch list + eye toggles**,
    the **Thickness** slider, and **Coordinate ruler** / **Feature labels** checkboxes,
    and that recolor / hide / thickness / toggles all still work live (same as Phase
    1/2). PASS if nothing regressed. The save button now reads **"Save as this
    figure's default"** (was "Save as this sequence's default") — confirm it still
    saves + the canonical persists on remove + re-add.

## Part D — chemistry shows no Style section (REAL FOLDER)

**Heads-up:** like trees, a molecule must be SAVED to appear in the picker. Do NOT
use the file-import path (OS dialog). The picker-free way to get a molecule is
PubChem-by-name.

11. If there is already a saved molecule, use it. Otherwise create one without a file
    dialog:
    a. Open **Chemistry** (`/chemistry`) -> click the **PubChem** rail action ->
       search a common name (e.g. `aspirin`) -> pick the result -> confirm/save it so
       it lands in your library (you should see it appear in the molecule list).
12. In **/figures**, **Add figure** -> add the saved **molecule** as a panel -> select
    it. PASS if the "Selected panel" card shows the "Show plot title" toggle but
    **no Style section at all** (chemistry declares no style controls). Selecting it
    must not error or show an empty/broken Style box.

## Throughout

- Report ANY red console errors / React warnings (especially "Maximum update depth",
  render loops, hydration) and which step triggered them.
- Flag anything visually broken: a control that does nothing, a panel that fails to
  re-render after a style change, the Style section appearing for chemistry, or the
  palette/toggles not affecting the figure.

## Report back

A PASS/FAIL table for steps 1-12, the console state (clean or exact errors), and a
1-2 sentence verdict: does the generalized per-source styling work on `:3000`, and
what (if anything) is broken or rough. List concrete bugs with the step number and
saw-vs-expected.
