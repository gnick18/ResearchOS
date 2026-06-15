# Debug/Chrome-verify prompt — Collision-aware layout advisor (phylo, Phase 1-4)

Verifies the advisor end to end: the 3 new toggles, the auto-fix wand (reversible),
the per-fix preview menu, and per-plot silence. Folder-dependent (needs a tree +
overlays). Dev server on :3000.

---

You are verifying the Tree Studio "layout advisor" at http://localhost:3000/phylo on a running dev server. Connect/create a scratch folder if prompted. Import a tree: in the Data tab paste the Newick
`((Aspergillus_fumigatus:0.1,Aspergillus_flavus:0.1):0.2,(Candida_albicans:0.1,Candida_auris:0.1):0.2);`
then load + save it (long tip names help trigger label crowding).

TRIGGER A CROWDED FIGURE:
1. Add metadata so overlays exist (Data Hub table in the same project keyed by these tip names with a numeric column "MIC", or paste inline metadata if the Studio offers it).
2. In the Layers tab, add the SAME numeric column as MULTIPLE overlays: MIC as a Bar panel AND MIC as a Heatmap AND MIC as Dots. This forces a duplicate-overlay + several legend keys.

ADVISOR BANNER (Shape tab):
3. Go to the Shape tab. CONFIRM a quiet amber banner appears at the top: "N layout issues in this figure" with a one-line summary (e.g. "Column MIC is shown as 3 overlays (redundant)" / legend overlap). It must NOT appear on a clean single-overlay figure.

AUTO-FIX WAND (reversible):
4. Click "Auto-fix layout". CONFIRM the figure declutters live: column spacing widens, the legend moves to a strip below the figure, and/or tip labels tilt. The button flips to "Undo auto-fix".
5. Click "Undo auto-fix". CONFIRM the figure returns exactly to its pre-fix state (gap, legend on the right, labels flat).

REVIEW MENU + PREVIEWS:
6. Click "Review N fixes". CONFIRM each fix row shows a LIVE preview thumbnail of the fixed figure + a title/rationale + an Apply button. Click one fix's "Apply" and confirm only that change lands (e.g. "Move the legend below the figure" -> legend goes to the bottom strip; "Drop the duplicate overlay" -> one MIC overlay removed).

PER-PLOT SILENCE:
7. Click the "x" on the banner. CONFIRM it disappears. RELOAD the page, reopen the same tree, re-crowd if needed -> CONFIRM the banner stays hidden for THIS tree (persisted), but appears again for a DIFFERENT crowded tree.

MANUAL TOGGLES (Shape panel):
8. Independently confirm the 3 controls work: the "Column spacing" slider widens the gaps; the labels-layer "Tilt" range rotates tip labels; the "Legend right|bottom" buttons move the legend.

Report a PASS/FAIL table per step with screenshots, plus any red console errors.
