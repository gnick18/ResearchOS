# Phylogenetics arc handoff (2026-06-12)

Full briefing on the new Phylogenetics tab. Everything below is on LOCAL main, gate-verified (tsc 0 + targeted vitest + icon-guard), NONE pushed to origin, NONE orchestrator-browser-verified (Grant runs his own :3000). Design + memory: `[[project_phylogenetics_page]]`, scope/spec docs under `docs/proposals/2026-06-12-phylo-*` and `docs/proposals/2026-06-12-beakerbot-phylo-contract.md`.

## What it is

A `/phylo` tab (sibling to Chemistry + Data Hub), flag-gated `NEXT_PUBLIC_PHYLO_ENABLED` (default off, demo-visible via `?wikiCapture=1`). Client-side only, NO server compute (Grant's hard rule). Two halves:
- **Tree Builder**: a wizard that GENERATES tree-building scripts (never runs them). Pure generator `generateRecipe(BuilderOptions)` in `lib/phylo/recipe.ts` filling a VERIFIED catalog `lib/phylo/catalog.ts`.
- **Tree Studio**: the iTOL alternative. Native-SVG tree rendering (NOT webR), ggtree code is export-only. Renderer `lib/phylo/render.ts` `renderTreeSvg`.

## What is BUILT + MERGED on local main

1. **Phase 0 + Tree Builder** (full vetted wizard). Files: `lib/phylo/{config,types,phylo-store,api,newick,catalog,recipe,parse,layout,render,ggtree-code,figure-to-render,rf}.ts` + `components/phylo/{PhyloHub,PhyloBuilder,PhyloStudio}.tsx` + `app/phylo/page.tsx`. Nav entry + AppShell gate + `/phylo` in wiki-coverage EXCLUDED_PREFIXES (wiki page still TODO).
2. **Vetted wizard** (frozen spec `docs/proposals/2026-06-12-phylo-wizard-build-spec.md`): nucleotide/protein only, MAFFT `--auto`, searchable model picker, THREE pipelines (single locus / concatenated supermatrix via AMAS then ALWAYS IQ-TREE / coalescent gene-trees then ASTRAL), advanced section (bnni/reps/+ASC/restrict-models/threads), trimAl `-automated1`, standard bootstrap 1000, scaffolded MrBayes NEXUS block, merged Install+environment.yml output. All flags doc-verified (AMAS `--part-format raxml` + `--codons 123`; `astral -i -o` unrooted, NO rooting flag).
3. **Tree Studio**: Newick/Nexus parse, rectangular + circular layouts, reroot/ladderize/collapse/color, metadata CSV link, annotation tracks (labels/points/strip/bars/heatmap/clade/support), SVG+PNG export (reuses Data Hub exporter), ggtree code export with the honest "close not pixel-identical" caveat.
4. **Demo seed**: `/phylo?wikiCapture=1` opens 3 REAL trees (verbatim sources committed under `lib/phylo/__seed__/sources/` + SOURCES.md): C.auris (305 tips, circular, clade strip + resistance heatmap), HMP microbiome (333 tips, the ggtreeExtra figure), HPV58 (90 tips, rectangular + support). Seed test `lib/phylo/__seed__/seed-phylo-demo.test.ts`.
5. **Transparency vs ggtree**: domain proving our native layout matches ggtree on the 3 trees. Grant RAN `frontend/scripts/gen-phylo-ggtree-golden.R` (ggtree 3.6.2), committed real goldens + PNGs; gate `phylo-plots.gate.test.ts` is LIVE + green. Result: tip-order corr 0.994/0.999/0.997, depth 1.000. Page section `components/transparency/PhyloFigures.tsx`. LESSON: ggtree default ladderizes; we ladderize-descending before comparing (`figure-to-render`/`phylo-ggtree.ts`).
6. **Embeds + deep-link**: `phylo` ObjectRefType, `/phylo?doc=<id>` opens a tree in the Studio, `components/embeds/PhyloEmbed.tsx` renders a tree CARD via `renderTreeSvg`. Frozen embed markdown: card = `[name](/phylo?doc=<id>#ros=studio)`, chip = `[name](/phylo?doc=<id>)`. `render.ts` baselined in icon-svg-baseline.json (Grant signed off, it is a data figure like the datahub plots).
7. **Robust tip-metadata join**: `matchMetadataToTips` now does exact -> normalized -> token pass for composite labels (e.g. `SC144|FJ385264` joins a row keyed `SC144`, unique-guarded), auto-detects the join column (`bestTipColumn`), shows a live "matched X of Y tips" indicator.

## Published-tree reproduction (IN PROGRESS, the "next phylo piece")

Scope LOCKED (`docs/proposals/2026-06-12-phylo-published-validation.md`): allow small RF + show differing branches, 2-3 cases, headline normalized RF + percent clades recovered. Architecture mirrors the ggtree goldens (source verbatim alignment+tree -> Grant runs the recipe offline once -> commit `ours.treefile` -> pure-JS RF gate -> /transparency side-by-side).
- **DONE**: Phase 1 RF scorer `lib/phylo/rf.ts` `compareTrees(ours, published)` merged (prune to shared taxa, canonical bipartitions, normalized RF + percent recovered + differing clades, unrooted-safe, 7 tests). NOTE: `missingFromOurs`/`extraInOurs` report the lexicographically-SMALLER side, not necessarily the in-group.
- **CASES SOURCED + cited**: (1) HPV58 nucleotide single-locus, 90 GenBank accessions (NCBI efetch works, I fetch); (2) Turtle supermatrix, Chiari 2012 BMC Biol 10.1186/1741-7007-10-65, `turtle.fa`+`turtle.nex` from iqtree.github.io/workshop/data/ (I fetch); (3) Firefly UV opsin protein single-gene, Sander & Hall 2015 Mol Ecol 10.1111/mec.13346, Dryad doi:10.5061/dryad.q878c, files `UV_38aa_formatted.fasta` + `BEAST_SL2015_plus32tax.tre`. GOTCHA: Dryad BLOCKS scripted download (curl gets a 4336b HTML interstitial); Grant downloads the 2 opsin files in a browser.
- **NOT BUILT YET**: the case framework = `lib/transparency/datasets/phylo-published/<case>/` (alignment + published tree + SOURCES.md + the BuilderOptions used + `ours.treefile` after the run) + `scripts/run-phylo-published-case.sh` + `phylo-published.gate.test.ts` (consumes `rf.ts`, skip until results present) + a /transparency section. Then Grant downloads opsin + runs all 3 recipes offline + commits each `ours.treefile` to activate.

## GOTCHAS / known issues

- **`-T AUTO` is pathological on tiny/quick alignments.** Grant's smoke test (6 seqs, 204bp) spent 38 MINUTES because IQ-TREE re-runs its ~30s AUTO threadcount measurement for every one of 484 ModelFinder models. Real recipe consideration: for small data `-T AUTO` is a footgun. OPTIONS to weigh: default the advanced threads to a fixed small number (e.g. `-T 2`), or only use AUTO above a size threshold, or add a note. NOT yet changed in the catalog/recipe. Flag for Grant.
- **The smoke-test FASTA is too conserved** (198/204 constant sites, 3 parsimony-informative) so it has weak signal. Consider making `docs/testing/phylo-smoke-test.fasta` more variable for a meaningful test tree.
- Shared `main` checkout is contended across sessions: build in isolated worktrees, guarded `git merge --no-commit --no-ff` then inspect the staged set for foreign bleed before committing. Symlink node_modules for the tsc/vitest gate, never pnpm-install into a shared worktree.
- NOTHING is pushed to origin. Grant has not pushed any phylo work.

## BeakerAI coordination

Separate lane. Contract relayed via `docs/proposals/2026-06-12-beakerbot-phylo-contract.md` (FROZEN). BeakerAI has SHIPPED on main: `lib/ai/tools/phylo-tools.ts` (`list_phylo_trees`/`read_phylo_tree`, consume-only via `phyloApi`), the card-embed guidance, and `phyloToBrief` (trees in search + summaries). STILL GATED on us: the frozen `BuilderOptions` is relayed so their `generate_tree` (fill BuilderOptions from catalog -> `generateRecipe`) is a clean drop-in; and the sequence-ids -> FASTA "build a tree from these sequences" input binding (NOT built, co-design when Grant sequences it, BeakerAI owns the sequence side).
- **Grant's forward idea (2026-06-12): coordinate with BeakerAI soon, they have lots of updates and this could synergize, e.g. AUTOMATIC PDF EXTRACTION of a phylo methods section** to pre-fill the Builder wizard / recipe from a paper. A strong future synergy (BeakerAI extracts the methods text, fills BuilderOptions, the deterministic generator emits the verified recipe). Capture as the next coordination topic.

## Key commits (local main)
Builder/Studio/embeds/seed/transparency/wizard all merged earlier in the session (see git log for `feat(phylo)` / `Merge ... phylo`). Latest relevant: vetted-wizard merge `09e8679b5`, frozen-BuilderOptions relay `d1dbbd712`, RF scorer merge `7dcc0531d`, published-validation scope `f188fa86f`, smoke FASTA in `docs/testing/`.

## Next steps
1. Decide the `-T AUTO` default (and improve the smoke FASTA).
2. Build the published-reproduction framework (datasets + run helper + gate + page); I fetch HPV58 + turtle, Grant downloads opsin + runs the 3 recipes offline.
3. Write the `/phylo` wiki page (then drop it from EXCLUDED_PREFIXES).
4. Coordinate with BeakerAI on the PDF-method-extraction synergy + the sequence->FASTA binding.
5. Grant verifies the full page on :3000, then a push decision.
