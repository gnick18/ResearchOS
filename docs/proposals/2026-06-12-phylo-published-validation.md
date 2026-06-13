# Phylo published-tree reproduction (transparency, scope)

2026-06-12, scope draft. Extends the published-data validation initiative
([[project_published_validation]]) and the phylo transparency domain to
tree-BUILDING. The existing phylo transparency proves our Studio rendering matches
ggtree (the figure). This proves the other half: that the Builder's generated
pipeline, run on a real paper's input, recovers that paper's published tree.

## The claim

"Run our generated recipe on a published alignment and you get back the published
tree." Stated honestly, since we never run anything on a server and ML search is
stochastic: a modern best-practice pipeline on the paper's alignment recovers the
published topology, with any differences confined to poorly supported branches.
This is the tree-building analog of "we reproduce peer-reviewed results."

## What is NOT claimed

- Not bit-for-bit identity. Tool versions, the auto-selected model, and search
  stochasticity differ from the original study.
- Not that WE computed it. The user (or Grant, offline) runs the recipe; we
  generate it and we score the result. No server compute, same rule as everywhere.

## Architecture (mirrors the ggtree golden pattern)

The ggtree goldens are produced offline once by a script Grant runs, committed,
and a pure-JS vitest gate compares against them. Same shape here:

1. SOURCE (verbatim, never AI-extracted): pick published studies that publish BOTH
   the input alignment AND the final tree, ideally TreeBASE (it stores the matrix
   + the trees per study) or Dryad. Commit the paper's alignment + its published
   Newick under `frontend/src/lib/transparency/datasets/phylo-published/<case>/`
   with a SOURCES.md citing the DOI + accession, exactly like the demo tree
   sourcing.
2. RUN (offline, once, by Grant, like gen-phylo-ggtree-golden.R): run the Builder's
   generated recipe on the committed alignment, commit the resulting `*.treefile`
   as `<case>/ours.treefile` plus the exact `BuilderOptions` used (so the recipe is
   reproducible and shown on the page). A small helper script
   (`scripts/run-phylo-published-case.sh`) wraps it.
3. SCORE (pure JS, runs in CI): a new `lib/phylo/rf.ts` computes the
   Robinson-Foulds distance between our tree and the published tree on the shared
   taxon set (bipartition symmetric difference), plus normalized RF and the percent
   of published clades recovered. Pure, no dep, unit-tested. A
   `phylo-published.gate.test.ts` asserts each case is within its committed
   tolerance, mirroring `phylo-plots.gate.test.ts` (skips until `ours.treefile`
   exists, so CI never reds before Grant runs it).
4. SHOW: a `/transparency` section per case: citation + the BuilderOptions/recipe
   used + normalized RF + percent clades recovered + a side-by-side of our tree and
   the published tree (reuse `renderTreeSvg`, the renderer already on main), and a
   one-line list of any differing branches with their support values.

## Metric

Robinson-Foulds on unrooted topologies restricted to the shared taxa: RF (count),
normalized RF = RF / (2n - 6), and percent of the published tree's bipartitions we
recover. RF = 0 is identical topology. We also surface, for any non-zero RF, the
specific branches that differ and their support, so a small RF reads as "the two
trees agree except at one weakly supported node," not as a silent miss.

## Phasing

- Phase 1: `rf.ts` + tests (pure, lands immediately, no sourcing needed).
- Phase 2: source 1 to 3 published cases (verbatim alignment + tree + SOURCES.md),
  the run helper script, the gate (skipped until run), the page section.
- Phase 3: Grant runs the recipe per case offline, commits `ours.treefile`, the
  gate activates and the page fills in (same as the ggtree golden activation).

## Decisions (Grant, locked 2026-06-12)

1. Tolerance / framing: ALLOW a small RF and SHOW the differing branches with
   their support (a case passes if differences are confined to weakly supported
   branches). More honest about ML stochasticity, lets more real datasets qualify.
   Each case commits an expected normalized-RF tolerance.
2. Cases for v1: a SMALL SET of 2-3, spanning data types (a nucleotide gene tree,
   a protein tree, and ideally a small supermatrix).
3. Headline metric: BOTH normalized Robinson-Foulds AND percent of published clades
   recovered (RF is the standard, percent-recovered is the intuitive read).

Sourcing requirement reminder: a case needs the paper's ACTUAL input alignment
plus its published tree, both verbatim from TreeBASE / Dryad, validated against our
parser before commit. The demo trees we already seeded are tree-only (outputs), so
they do not by themselves supply the alignment a reproduction needs.
