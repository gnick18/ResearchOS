# Chrome-verify prompt — Phylo ggtree coverage Wave 2 (clade-level controls)

Paste the block below into Claude-in-Chrome. Covers the 5 Wave 2 features:
branch coloring (`4304662d8`), MRCA + multi-clade highlights (`6537580d7`),
clade labels/brackets (`18690c84c`), collapse-to-triangle (`8fe26b845`),
rotate/flip (`deb5a8448`). One scratch folder, one tree.

---

You are verifying the Tree Studio "clade-level" controls at http://localhost:3000/phylo on a running local dev server. Connect/create a scratch folder if prompted, then open any saved tree in the collection rail. If the collection is empty, import a tree first: in the Data tab use the Newick import and paste
`((A:0.1,B:0.1)G1:0.2,((C:0.1,D:0.1)G2:0.15,(E:0.1,F:0.1)G3:0.15):0.1):0.0;`
then name and save it so it appears on the canvas.

Go to the **Setup** tab and find the **Tree** panel. Verify each control. After each action, take a screenshot and confirm the canvas changed as described; if a control is missing, broken, or throws a console error, report it with the screenshot instead of moving on.

1. **Rotate a clade (flip its branches):** in the "Rotate a clade" member picker, type two tips that sit in a subtree (e.g. C and D), click the rotate button. CONFIRM: the order of that subtree's branches flips vertically (the subtree's tips swap top/bottom) while the tip set is unchanged. The picker clears after.
2. **Collapse to triangle:** pick a clade's members (e.g. E, F), apply "Collapse to triangle". CONFIRM: that clade renders as a single triangle; expanding restores it.
3. **Branch color:** use "Branch color by" to color a clade's branches (by members or column). CONFIRM: only the targeted branches recolor, the rest stay default.
4. **Clade highlight (single + multi):** add a "Clade highlight" on one clade (e.g. G2 members), then add a SECOND highlight on a different clade. CONFIRM: both highlights render simultaneously with distinct colors; each can be removed independently via "Remove clade".
5. **Clade label / bracket + MRCA pie/star:** add a clade label/bracket on a clade, and a "pie / star at a clade's MRCA". CONFIRM: the bracket/label draws beside the right clade and the MRCA marker sits at the clade's common ancestor node.

Finally: confirm no red console errors during the whole pass, and that Export → Code (ggtree) reflects the edits where applicable. Report a per-feature PASS/FAIL table with screenshots.
