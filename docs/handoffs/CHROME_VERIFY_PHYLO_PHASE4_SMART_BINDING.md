# Chrome-verify prompt — Phylo Phase 4 Smart Data Binding (both front doors)

Phase 4 is code-complete (engine `smart-binding.ts` + `SmartDataWizard.tsx` +
BeakerBot `suggest_tree_overlays` tool; tsc 0, 328 tests). This verifies the two
front doors in a real browser. One scratch folder; needs a tree AND a Data Hub
table in the SAME project that shares tip labels.

---

You are verifying Phylo "Smart Data Binding" at http://localhost:3000 on a running local dev server. Connect/create a scratch folder if prompted.

SETUP (do this first):
1. In Data Hub, create a table in a project with a text column of species names matching tip labels and 2+ numeric columns plus 1 categorical column. Example rows (column "Species", "MIC", "Growth", "Resistance"): A/2/0.8/resistant, B/4/0.5/resistant, C/1/0.9/susceptible, D/8/0.3/resistant. Save it to a project.
2. In /phylo, open or import a tree in the SAME project whose tips are A,B,C,D (Newick `((A:0.1,B:0.1):0.2,(C:0.1,D:0.1):0.2);`). Save it.

FRONT DOOR 1 — the GUI wizard:
3. With the tree open, look in the Layers tab for the quiet auto-suggest banner ("N tables can overlay this tree" / "Find data for this tree"). CONFIRM it appears since a joinable table exists. Also confirm the wizard is reachable from the Add ＋ menu.
4. Open the wizard. Step "Find data for this tree": CONFIRM the table is listed with an HONEST join-rate chip ("joins 4 of 4 tips") and a one-line preview of what it enables (numeric → bars/heat/dots/point, categorical → color strip).
5. "Pick a table" → "Pick overlays to add": CONFIRM each column shows its kind and the overlay geoms it can drive; the join column is the locked anchor; pick 2 columns (one numeric, the categorical).
6. Click "Add N overlays". CONFIRM the chosen overlays appear on the tree as individual restyleable layers in the stack (NOT one whole-table panel), bound to the right tips. Then use "Add another table" loop-back: CONFIRM it returns to step 1 without closing.
7. Edge: open the wizard on a tree whose tips match NO table — CONFIRM the explicit empty state ("No table in this collection shares a column..."), not a dead end.

FRONT DOOR 2 — BeakerBot:
8. Open BeakerBot in the same tree context. Ask: "What data can I put on this tree?" CONFIRM the SAME wizard widget renders inline in chat, the model narrates the real join numbers (e.g. "joins 4 of 4 tips"), and driving the inline widget adds the overlays to the tree. The model must NOT invent a join rate or overlay — numbers come from the engine.

Report a PASS/FAIL table per step with screenshots, plus any red console errors.
