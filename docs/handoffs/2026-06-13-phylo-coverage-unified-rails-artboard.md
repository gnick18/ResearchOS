# Handoff 2026-06-13 — Phylo lane: unified rails, ggtree coverage Waves 1+2, artboard wish

Everything below is on **LOCAL main, UNPUSHED**. tsc 0, ~199 phylo tests green at each commit. Grant runs main on :3000, so it is all live for him.

## 1. Tree Studio polish (start of session)
- Point + Scatter panels browser-verified (demo). Circular **numeric scale-key** for distribution panels + **responsive/demo-button clipping** FIXED — commit `156f9e1f0` (the clipping fix was later SUPERSEDED by the shared split shell, below).
- Deferred finding: Point+error with an explicit **errorColumn** makes the SD/SEM selector a no-op (error taken verbatim); the control should collapse to From-column/None in that mode. NOT yet done.

## 2. v3 UNIFIED RAILS (built + browser-verified)
- **Tree Studio**: left = collection rail recycled from Sequence/Chemistry (`PhyloCollectionRail.tsx`, `bad914dcf`); right = tabbed **action rail** reusing `components/sequences/SequenceOperationsRail.tsx` (tabs Layers / Setup / Export / Code — the old Tree/Metadata/Alignment left controls moved into **Setup**); Phylo Hub saved-trees grid RETIRED; `/phylo` studio view full-height (`6c7823e06`). Mockup `docs/mockups/2026-06-13-phylo-v3-unified-rail.html`.
- **Data Hub**: rail on the shared shell + collapse-to-focus + type-to-filter, family-tree nesting kept (`c9ba74bf5`). Mockup `docs/mockups/2026-06-13-datahub-unified-rail.html`.
- **Dedup** (`286cd8e93`): one shared `components/SplitShell.tsx` (`useSplitShell` + `SplitDivider` + `RailReopenButton`) backs ALL FOUR data-page rails (sequences, chemistry, datahub, phylo). CANONICAL: new data-page rails use `useSplitShell(<per-page localStorage key>)` — do NOT re-copy divider/persist plumbing. Persists on drag-end/keyboard (a `[width]` effect has a StrictMode restore bug). Clamp math stays in `lib/sequences/split-layout.ts`.

## 3. ggtree COVERAGE EPIC (the main phylo mission)
Grant's directive: broaden Tree Studio toward the full ggtree/ggtreeExtra/aplot surface — **make every toggle EXIST** (render + figure-spec via the loose `AlignedPanel.options` seam + PhyloLayers inspector + ggtree export); the **settings-UI organization is a deferred separate audit**, not a blocker. Backlog = tasks Wave 1B/3/4 + memory `project_phylo_ggtree_coverage`.
- **Wave 1** `187042fab` — tip-label options: font size, boxed (geom_label), color-by-trait, italic default on.
- **Wave 2 COMPLETE** (all clade-level, built on the MRCA model):
  - branch coloring by trait (`aes(color=)`, paints monophyletic clades) `4304662d8`
  - **MRCA finder + multiple clade highlights** `6537580d7` — `mrca(root, tipNames)` in `layout.ts` (the headline QOL: name the tips, MRCA resolves the clade root; never hunt a node on a big tree). Clades stored on the clade layer's `options.clades`. Both layouts (circular clade highlighting, previously deferred, now works).
  - clade labels / brackets (`geom_cladelab`, `CladeAnnotation.style` highlight|label) `18690c84c`
  - collapse-to-triangle (`geom_collapse`; `applyCollapses` reshapes the tree before layout via the existing `collapseClade`; rect fan + circular wedge) `8fe26b845`
  - rotate/flip (`rotateNode` tree edit + Setup-tab "Rotate a clade by members" using MRCA) `deb5a8448`
  - All clade features share ONE `CladeInspector` (color / label / style / collapse / members-by-tip-name).
  - DATA-SHAPE FLAGGED (additive, back-compat): `PhyloFigureSpec.branchColorColumn?` (branch coloring). Clade stuff lives on `options` (no new on-disk field).

### CHROME VERIFY CHECKLIST (Grant will drive when back)
Add a Clade highlight layer → Add clade → pick 2+ members **with a real mouse** (synthetic select keypress does NOT commit — that is the only thing not self-verified) → confirm MRCA highlights the clade in both layouts; Style→Bracket; Collapse→triangle; Setup-tab branch-color (CLADE, already verified) + rotate-a-clade; check the Code tab reflects each toggle.

## 4. Plot artboard / page frame (NEW WISH, design-stage, NOT built)
Grant wants an Illustrator-style **page artboard** behind any plot so you size the figure inside a real publication page (figure in real units → exact SVG export), shared across Tree Studio + Data Hub + any figure surface. Interactive mockup `docs/mockups/2026-06-13-plot-artboard-page-frame.html` (paper presets incl journal column widths, orientation, rulers, room/overflow feedback, export-dims readout, 5 decisions to approve). Memory `project_plot_artboard`. CRUX decision: figure sized in real units within the page = the export dimension (today RenderSpec is a fixed 620×460). Awaiting Grant's review.

## 5. Cross-lane
BeakerAI shipped PDF-reproduce Output 4 `match_figure_style` against the stable `PhyloFigureSpec` + `phyloApi` + `?doc=` contract; I re-verified the hydration seam clean post-v3-refactor. RELAY NOTE: inter-lane messages now go via the CCD `send_message` tool (Grant's pref), still To:/From: + signed.

## NEXT
1. Grant: Chrome-verify Wave 2 (checklist above) + review the artboard mockup decisions.
2. Then likely BUILD the artboard (serves both pages), or continue ggtree **Wave 3** (layouts: slanted / fan / unrooted / inward circular) or **Wave 1B** (tip-label align leader-lines, node/root points, scale-bar toggle).
3. Small cleanup queued: Point+error SD/SEM-vs-errorColumn UX.
