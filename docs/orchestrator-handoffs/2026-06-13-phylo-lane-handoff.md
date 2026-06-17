# Phylogenetics lane handoff (2026-06-13)

Full briefing on the phylo lane as of 2026-06-13. Everything below is on LOCAL
main, gate-verified (tsc 0, phylo+transparency vitest green, icon-guard 0), NONE
pushed to origin. Two arcs ran this session: (1) published-tree reproduction
(transparency), and (2) the ggtree-class visualization build-out (Phases 0-3).
Design/context also in `[[project_phylogenetics_page]]`,
`[[project_published_validation]]`.

## Arc 1: Published-tree reproduction (transparency) — LIVE for 2 of 3 cases

Proves the Tree Builder's GENERATED recipe, run offline on a real paper's input,
recovers that paper's published tree. The other half of the phylo transparency
story (the ggtree-layout domain proves our RENDER matches ggtree; this proves the
recipe). Pure-JS gate, skips until an offline run lands, mirrors the ggtree-golden
pattern.

- Framework: `lib/transparency/datasets/phylo-published.ts` + `phylo-published/<case>/`
  (verbatim input + builder-options + result.json + SOURCES.md), the
  `phylo-published` transparency domain in `run.ts` + `published-tree` oracle, the
  `phylo-published` visual + `components/transparency/PhyloPublished.tsx`,
  `phylo-published.gate.test.ts`, and `scripts/run-phylo-published-case.sh` (offline
  run helper; parses builder-options with python3, no jq; `PHYLO_THREADS` env
  override for the -T AUTO footgun).
- TWO VERDICT MODES (a case declares one): SUPPORT (`supportCutoff`, default 70,
  Hillis & Bull 1993) = miss no published clade at/above that bootstrap support;
  RECOVERY (`recoveryFloor`) = recover at least that fraction of published clades,
  for support-less trees (does not penalize resolving the paper's polytomies).
  `rf.ts` `compareTrees` reports `missingFromOursSupport`.
- CASES: **hpv58** (nucleotide single-locus, 90 GenBank genomes, support mode,
  LIVE: recovered every well-supported clade), **craugastor** (nucleotide
  partitioned supermatrix, TreeBASE S10103 = Streicher et al. 2009 frog complex,
  recovery mode floor 0.9, LIVE: 33/34 clades = 97.1%, resolved 11 polytomies).
  **firefly_opsin** = protein single-gene STUB, the only one left: Grant must
  download `UV_38aa_formatted.fasta` + `BEAST_SL2015_plus32tax.tre` from Dryad
  doi:10.5061/dryad.q878c (Dryad blocks scripts), then I wire + he runs the helper.
- Turtle (Chiari 2012) was DROPPED: its published tree is not deposited as a
  verbatim Newick anywhere (figure only); do not hand-author it. Replaced by
  craugastor.
- The `/phylo` WIKI PAGE is built (`wiki/features/phylo`, wired into nav+search); 6
  screenshots pending capture via `?wikiCapture=1`.
- BeakerAI contract PINNED: their `generate_tree` fills the frozen BuilderOptions ->
  `generateRecipe`. Catalog-miss fallback = nearest-catalog + a factual note (models
  pass through `fixedModel` or use ModelFinder, never nearest-mapped). Input binding
  = raw single-locus FASTA; partition input out of v1. Their fixture harness
  regression-locks all 3 builder-options shapes (incl the supermatrix have:alignment
  recipe shape we landed). lib/ai/tools/* is THEIR lane, do not touch.
- The `-T AUTO` footgun: catalog default stays AUTO but the generated recipe now
  warns + suggests `-T 4` on small alignments. The over-conserved smoke FASTA in
  docs/testing is still a minor open item.

## Arc 2: ggtree-class visualization (Tree Studio) — Phases 0-3 ALL MERGED

Vision (Grant): the Tree Studio should do ALL of ggtree + ggtreeExtra + aplot, the
complicated figures where arbitrary data panels align to the tree by tip, not iTOL
"color a tip". Key thesis: **Data Hub is our ggplot2** (a publication-grade pure-SVG
plot engine we reuse READ-ONLY); the unlock is letting the tree drive a panel's row
axis. Proposal: `docs/proposals/2026-06-13-phylo-ggtree-class-viz.md`.

- **Phase 0** (merge `331793664`): continuous color scales (reuse
  `lib/datahub/palettes.ts` Viridis/sequential), value-based heatmaps (not binary),
  per-track legends, heatmap UI + multi-column picker, circular bar/heatmap rings.
  `lib/phylo/color-scale.ts`.
- **Phase 1** (merge `3468fec20` + fix pass `c5fea245a`): the LAYERS control model
  (the figure is an ordered `panels[]` stack; additive, back-compat, old figures
  project to default layers) + the aligned-panel framework (`TipAxis` in layout.ts +
  pure `panel-render.ts`, column/ring aligned tip-for-tip). `PhyloLayers.tsx` =
  reorderable layer list + per-layer inspector + searchable categorized Add menu +
  Start-from templates (REPLACED the toggle wall). Control model decided via the
  approved mockup `docs/mockups/2026-06-13-phylo-control-model.html` (research
  `docs/research/2026-06-13-phylo-control-model-ui.md`). **BROWSER-VERIFIED by Grant**
  (all 4 fix-pass defects resolved + regression sweep, console clean).
- **Phase 2** (merge `0ccaacb91`): Data Hub-class statistical panels aligned to
  tips: violin (kernel density), point+error (lollipop, sd/sem, value+`errorColumn`
  or replicate mean/sd), scatter (jittered replicates). Reuses Data Hub primitives
  (quantileSorted/niceTicks/palettes) READ-ONLY; lib/datahub/ untouched (design
  refinement: render phylo-side against the TipAxis, do NOT inject into the Data Hub
  renderer). Additive optional `AlignedPanel.errorColumn`.
- **Phase 3** (merge `0398c90c7`): msaplot alignment track (`lib/phylo/msa.ts`:
  aligned-FASTA import reusing the tip-label join -> nucleotide/AA residue matrix
  ring/column, column binning for wide alignments, residue legend, `msaplot()`
  export; alignment carried as in-memory `RenderSpec.msaTrack`/`FigureInputs.alignment`,
  no sidecar change) + multi-panel/legend polish (legends columnize at 4+, per-panel
  titles, wider gaps) + the template-apply flicker fix.

Specs: `docs/proposals/2026-06-13-phylo-phase{1,2,3}-build-spec.md`.

### Browser verification status
- Phase 1: fully verified (Grant, Claude-in-Chrome).
- Phase 2: Violin verified PASS (ring+column, value-axis toggle, console clean);
  Point + Scatter pending a CONTINUED Chrome run (first run rate-limited mid-test).
- Phase 3: not browser-verified yet.

### KNOWN POLISH QUEUED (batch into one fix pass after the Point/Scatter results)
1. Circular distribution panels (violin/point/scatter) show only a guide ring with
   NO numeric tick labels or value legend; rectangular shows the value axis. Add a
   value scale key in circular.
2. Responsive single-column collapse + the demo floating buttons ("View as lab head"
   / "Leave demo") overlap/clip the Layers+inspector panel at some widths.
(Plus the InboxBadge `isReady` crash a test saw was a TRANSIENT stale-build artifact,
not a real bug; current source clean.)

## HELD / PARKED (Grant's call, not started)
- **Demo reseed**: rebuild the seeded figures to show off the fancy panels. Edits
  the committed seed, so Grant confirms before this happens.
- **Handbook**: a wiki treedata-book (screenshot-heavy, example data for everything)
  is a parked TODO for a FINAL step (`docs/proposals/2026-06-13-phylo-handbook-plan.md`;
  curated attributed example data, NOT the local dev corpus). Do it LAST.
- **opsin** Dryad files (Arc 1).

## DEV TEST CORPUS (local only, NEVER commit/push)
`~/Desktop/ggtree-testdata/` holds ggtree/ggtreeExtra/treedata-book example data +
ready-to-import joined CSVs + `TEST-RECIPES.md`. Used to validate the Studio
reproduces the ggtree originals (e.g. `ggtreeExtra_fig1_joined.csv` vs `fig1.png`).
The repo keeps only the small attributed demo seed (candida/HMP/HPV58).

## Key files (phylo lib)
`lib/phylo/`: parse.ts, newick.ts, layout.ts (+TipAxis), render.ts, panel-render.ts
(the aligned-panel renderer), panels.ts (AlignedPanel model + catalog),
color-scale.ts, msa.ts, rf.ts, recipe.ts, catalog.ts, ggtree-code.ts,
figure-to-render.ts, types.ts. Components: `components/phylo/PhyloStudio.tsx`,
`PhyloLayers.tsx`, `PhyloBuilder.tsx`, `PhyloHub.tsx`. Transparency:
`lib/transparency/datasets/phylo-published.ts` + `phylo-ggtree.ts`,
`components/transparency/PhyloPublished.tsx` + `PhyloFigures.tsx`.

## LESSONS (this session, costly)
- Shared main checkout is contended across parallel sessions. NEVER leave a
  turn-length gap between `git merge --no-commit` and `git commit` -- a concurrent
  session's commit resets the index and your commit no-ops ("no changes added"), and
  your staged merge is swept (happened once this session). Chain merge +
  foreign-bleed-check + commit in ONE bash call, or atomic `git merge --no-ff <ref>
  -m`. If swept, the branch's commits survive as objects (re-merge by SHA even after
  branch deletion).
- Sub-bots sometimes HANG after their final commit (no completion notification, no
  live process). Because they commit incrementally, salvage from the committed state:
  gate-verify yourself, atomic-merge, clean up the worktree. (Two bots this session
  finished-then-hung; one actually finished and reported late.)
- Cross-lane: reuse `lib/datahub/*` and `lib/sequences/*` primitives READ-ONLY; do
  not modify them (Data Hub + BeakerAI lanes). The viz arc stayed phylo-side.

## NEXT STEPS
1. Run the Point/Scatter Chrome continuation; batch its findings + the 2 queued
   polish items into one atomic fix pass.
2. Grant: demo reseed (confirm scope), opsin Dryad files, /phylo wiki screenshots.
3. Handbook is the final step.
4. Grant verifies on :3000 + the ggtree-corpus reproduction (fig1.png), then a push
   decision (nothing pushed all session).
