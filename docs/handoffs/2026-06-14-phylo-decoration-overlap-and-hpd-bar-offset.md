# Handoff — Phylo Tree Studio: decoration overlap + HPD-bar offset (mid-verify)

**Date:** 2026-06-14
**Lane:** phylogenetics / Tree Studio (ggtree-class viz)
**Status:** Two render bugs Grant flagged during the Phase-1/2/3 Chrome-verify pass are **FIXED + BROWSER-VERIFIED** (commit `f49d830f6`, takeover session 2026-06-14) — gate-green (tsc 0 whole-repo, `src/lib/phylo` 275 tests incl 2 new regression locks). **Claude-in-Chrome verify 2026-06-14: ALL 4 sections PASS, console clean.** Bug 1: each HPD bar passes through its node dot, centered (rectangular phylogram). Bug 2: confirmed column separation by on-screen geometry — tip labels begin at x≈1244 while the "Flavi" strip label ends at x≈1186 and the dashed tip-link ends at x≈1193, so the strip/label/link sit in their own column left of the tip names, nothing painting over the labels. Control wiring (node pies at MRCA / star toggle / slice edit / tip-point size+shape from CSV) and the ggtree export (geom_taxalink/geom_strip/nodepie+geom_inset/geom_tippoint/geom_range) all PASS. LANE CLOSED. The diagnosis below is kept for the record.
**File for both bugs:** `frontend/src/lib/phylo/render.ts`. Lock tests: `render-noderange.test.ts` (Bug 1), `render-taxastrip.test.ts` (Bug 2).

---

## Context — how this came up

The previous session ran the headless render verification (the throwaway `__preview_gen.test.ts` that drives the real `renderTreeSvg`) and confirmed all six new geoms emit correct SVG: HPD bars, time-axis ticks, taxalink dashed curve, span strip "Flavi" label, star polygon, pie arcs. Gallery opened at `/tmp/phylo-preview.html`. Looking at that gallery, Grant flagged two visual problems:

> "on the left is this supposed to be off like this? and the right plot the graphics are on top of each other too much. for example tip labels should always be ontop of other visual additions like the dotted lines and the program should attempt to not have things overlap if it can avoid it (idk how ggtree does this)"

- **Left** = the node-age (HPD / `geom_range`) bar floats free of its node.
- **Right** = decorations (strips, tip-links, leaders, labels) collide in the same x-band.

---

## BUG 1 — HPD / node-age range bar floats free of the node

**Where:** `drawRectTree`, the `geom_range` block at `render.ts:833-865`.

**Why it floats:** the bar is positioned by **absolute age** via
```
xForAge(age) = rootX + (maxDepth - age) / upp        // render.ts:852
```
but each node's plotted x (`p.x`) is its **cumulative branch length from the root** (a phylogram layout). Those two coordinates only coincide when the tree is **ultrametric** (node depth == age). The preview tree is not ultrametric, so the bar (drawn across the parsed `{lo,hi}` interval in age-space) lands at a different x than the node point — it floats. It is also vertically fine (centered at `p.y - 3`), so the symptom is purely horizontal drift.

**This is a real bug, not "supposed to be off."** Answer to Grant's "is this supposed to be off like this?" → no.

**FIX APPLIED (option 1 — anchor the bar on the node).** The `geom_range` loop now draws the bar centered on `p.x` with width = `|v[1]-v[0]| / upp` (the age-interval span in px), i.e. `x0 = p.x - w/2`. The uncertainty bar now always passes through its node regardless of ultrametricity. No layout change; the dead `xForAge`/`rootX`/`maxDepth` locals in that block were removed (they are recomputed in the separate time-axis block). Locked by a new test that draws a node point and asserts the node's x falls inside the bar span.

**Faithful alternative NOT taken (future, if Grant wants true time-trees):** ggtree plots trees in *time* (node x = its height) so a node always sits inside its CI; matching that exactly would need a time-coordinate layout mode (`p.x === xForAge(nodeAge)`), a bigger change behind a flag. Option 1 is the correct universal default for our branch-length phylogram.

---

## BUG 2 — decorations overlap the label column (the "on top of each other" problem)

**Z-order is already correct.** `drawLabels` is called **last** (`render.ts:651`, after `drawRectTree` at `:602` and after every aligned panel), so tip labels DO paint on top in paint-order. Grant's "labels should be on top" is satisfied as z-order — **the real defect is spatial overlap/placement**, which is what he also asked for ("attempt to not have things overlap").

**Root cause — two anchoring systems collide in the same x-band:**

- The right-side **in-tree decorations** are drawn inside `drawRectTree`, anchored to `plotRight` (the deepest tip x):
  - clade bracket / `geom_cladelab`: `bx = plotRight + 8` (`render.ts:811`)
  - span strip / `geom_strip`: `bx = plotRight + 10` (`render.ts:969`)
  - tip-link / `geom_taxalink`: bows right from `x0 = max(a.x,b.x)` by `bow = 24 + …` (`render.ts:954-957`)
- The **aligned panels + tip labels** advance via a separate `cursor` that *starts at the same place*: `panelStart = axis.panelStartX` which is `plotRight + 8` (`render.ts:603-604, 611`), and labels paint at `cursor + 4` when aligned (`render.ts:1286-1287`).

So strips/brackets occupy exactly the first panel slot / the label column, and the taxalink curve bows into whatever sits to the right of the tips. They were authored against `plotRight` independently of the panel cursor, so nobody reserved space for anybody. Result: strip bar + "Flavi" label + tip labels + the dotted leaders all stack in one ~30px band.

**How ggtree avoids it (the answer to Grant's "idk how ggtree does this"):** every annotation geom takes an **`offset`** measured from the tip, and ggtree/aplot allocate horizontal track space so geoms sit in *adjacent* columns, with tip labels pushed out past all of them. That's the mechanism ported below.

**FIX APPLIED (the ggtree `offset` model, minimal/guarded version).** `drawRectTree` now tracks `decorRight` — the rightmost x reached by any in-tree right-side decoration (clade bracket, span strip, taxalink bow) *including its label text width* (a `~6px/char` heuristic matching the boxed-label code; taxalink reserves to the quadratic apex `x0 + bow/2`). It returns `{ plotRight, decorRight }` instead of bare `plotRight`. The caller (`renderFromPanels`, rectangular branch) starts the aligned panels / tip labels at `Math.max(axis.panelStartX, decorRight + 10)` — so a strip/bracket/taxalink gets its own column and the panels + labels begin past it. **`Math.max` keeps the no-decoration case byte-identical to the old `plotRight`-based placement** (additive, safe). Z-order was already correct (labels paint last), so no draw calls were reordered. Locked by a new test asserting the aligned tip-label column begins right of the strip's own label.

**Deferred enhancements (NOT done, fine to skip until asked):**
1. A *true* per-decoration `offset` field on `AlignedPanel.options` (default auto) so a user can nudge each geom independently, mirroring ggtree `geom_strip(offset=)` / `geom_cladelab(offset=)`, and emit it in the **ggtree code export**. Today the offset is auto-computed only.
2. Moving strips/brackets to actually *render at the cursor column* (rather than at `plotRight + N` with the cursor merely reserving space past them) — only matters if you want multiple stacked strip columns to interleave with panels.
3. Circular layout (`drawCircularTree`) has the same family of decorations anchored to the radius; it was NOT touched (Grant's report was the rectangular gallery). Re-check circular strips/taxalinks if they overlap the rim labels.
4. Leaders: the dotted tip→label leader + dashed taxalink crossing the label band should be largely resolved now that labels start past `decorRight`; confirm visually in the Chrome pass.

---

## STILL OWED — the Chrome UI-wiring verify (Grant drives, fresh agent)

The render half is already verified headlessly, so Chrome only needs to confirm the **controls wire up** (state commits, no crash) with REAL mouse clicks/typing (native multi-selects + color inputs reject synthetic events). Trimmed prompt the previous agent produced:

```
Verify UI wiring for new phylo features in the running dev app (http://localhost:3000).
The render output is already verified separately — you are ONLY checking that the
controls wire up (state commits, no crash). Use REAL mouse clicks/typing. Read the
console after each section; report any red error. Screenshot each result.

SETUP: go to http://localhost:3000/demo (unlocks the folder gate), then
http://localhost:3000/phylo.

1. IMPORT WIRING (timed tree): click "Paste", paste exactly:
   (((A:0.8,B:0.8)[&height_95%_HPD={0.6,1.0}]:1.2,C:2.0)[&height_95%_HPD={1.6,2.4}]:1.0,D:3.0);
   Click "Load this tree". PASS = tree renders, NO red "Could not read that tree".
   Then click the "Time axis" toolbar toggle, and add a "Node age bars" layer and
   pick interval key height_95%_HPD. PASS = bars appear AND sit THROUGH their nodes
   (BUG 1 fix — the bar is now centered on its node; if a bar floats free of its
   node the fix regressed, flag it).

2. NODE PIES (mouse multiselect): reload /phylo, "Try a sample". Add a "Node pies"
   layer -> "Add pie" -> in Members/MRCA pick "A. flavus" + "A. oryzae" with real
   clicks. PASS = a pie appears at their ancestor. Toggle Star; edit a slice value.

3. TIP LINKS + SPAN STRIP (native selects): add "Tip links", set From="A. fumigatus"
   To="P. chrysogenum" -> dashed curve appears. Add "Span strip", From="A. flavus"
   To="A. oryzae", Label="Flavi" -> bar+label appears. PASS = the strip + its "Flavi"
   label + the dashed tip-link do NOT overlap the tip labels (BUG 2 fix — labels now
   start past the decorations; if they still collide, the fix regressed, flag it).

4. TIP POINT SIZE/SHAPE (metadata bind + selects): click "Sample table" to bind the
   CSV. On the Tip points layer set "Size by"=genome and "Shape by"=section. PASS =
   dots vary in size and shape.

5. ggtree EXPORT TAB: open the Code/Export tab. PASS = code contains geom_taxalink,
   geom_strip, geom_range, nodepie/geom_inset, and geom_tippoint(aes(...size...shape...)).
```

---

## Repro / gallery regen

The throwaway generator was removed (tree was left clean). To regenerate the gallery for eyeballing, recreate a tiny test that calls `renderTreeSvg` with a non-ultrametric timed tree (the Newick in step 1 above is a good HPD repro) + a strip + a taxalink, write the SVG to `/tmp/phylo-preview.html`, run via `npx vitest run`, `open` it, then delete the throwaway. Keep it OUT of the committed suite.

## Gate before merging any fix
`cd frontend && npx tsc --noEmit` (clean) + `npx vitest run src/lib/phylo` (was ~837 phylo tests green) + icon-guard. Shared-main rule: chain `git merge --no-commit` → `--cached` foreign-bleed check → `git commit` in ONE bash call, or use `git merge --no-ff`.
