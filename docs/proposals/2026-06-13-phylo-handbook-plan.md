# Tree Studio handbook (wiki): plan + structure

2026-06-13. Grant's call: the complicated figures need a "super good" wiki
handbook, screenshot-heavy, with example data for everything, modeled on ggtree's
treedata-book. This is how we prove the Studio is a real ggtree alternative, not a
claim. It ships ALONGSIDE the features (each feature lands with its handbook page +
screenshot), the same discipline as "every stat ships with its transparency pin".

## The data + screenshot policy (the knot to untie first)

Two distinct data sets, do not confuse them:

- The ggtree TESTING corpus (`~/Desktop/ggtree-testdata/`) stays LOCAL, never
  committed, never pushed. It is for our dev validation (does our render match
  ggtree's original). Decided earlier, unchanged.
- The HANDBOOK needs COMMITTED example data, because a handbook figure must be
  reproducible by a reader ("open this, you get that") and its screenshot is a
  committed PNG. So the handbook cannot be built on the local-only corpus.

Screenshots follow the standing rule: captured in fixture mode (`?wikiCapture=1`),
fixture data only, never real user data. They are committed PNGs under
`frontend/public/wiki/screenshots/phylo-handbook/`, captured the same way the Data
Hub stats screenshots were.

DECIDED (Grant, 2026-06-13): Option B, curate a small, attributed
handbook-fixtures set, each dataset with a SOURCES note, sized to cover every
feature with a natural example. Consistent with how we committed the 3 seed trees.

### Curated set (candidates, all small + attributable)
The committed handbook fixtures live separate from the demo seed (e.g.
`frontend/public/wiki/example-data/phylo/`), each with a SOURCES file. Final
location/format is locked to Phase 1's import path before committing.
- Candida auris (already seeded) — circular epidemiology: clade strip + continuous
  resistance/abundance heatmap. The multi-ring chapter.
- HMP (already seeded) — gheatmap matrix (tip x body-site abundance), continuous.
- HPV58 (already seeded) — phylogram + support + clade highlight. The basics.
- ggtreeExtra geom_fruit example (HCMC, 230 tips: discrete ring + continuous ring
  + bar + tippoint). The canonical geom_fruit multi-ring. Attribution: ggtreeExtra
  (Xu et al. 2021), example data redistributed by YuLab-SMU.
- anole + svl (continuous body-size trait) — rectangular aligned panel
  (geom_facet). Attribution: treedata-book / the Anolis dataset.
- a small per-tip replicate dataset (synthesized on a small tree, documented as
  synthetic) — the Data Hub boxplot/distribution linkage chapter (Phase 2).
All are MIT/Artistic-licensed redistributions (ggtree/ggtreeExtra/treedata-book)
or clearly-labeled synthetic, attributed per dataset, same standard as the seed.

## Information architecture (mirrors the treedata-book, for our Studio)

Lives at `/wiki/features/phylo/handbook/` (a handbook section under the existing
`/wiki/features/phylo` page), concept-first then a worked recipe + a screenshot
per page. Proposed chapters:

1. Concepts: trees as data, the tip axis, the layers model (read first).
2. Importing + parsing: Newick / Nexus, the tip-id metadata join, long vs wide.
3. Tree styling: rectangular vs circular, phylogram vs cladogram, reroot,
   ladderize, collapse, branch color, support values.
4. Tip decorations: labels, tip points, the color strip (categorical).
5. Color + scales: categorical palettes vs continuous (Viridis/sequential),
   legends, when to use which.
6. Aligned data panels (the geom_fruit chapter, the heart): heatmap (single +
   matrix/gheatmap), bars, dots, boxplot. Continuous + categorical, circular rings
   vs rectangular columns, stacking multiple panels.
7. Linking Data Hub plots to the tree (Phase 2): a real boxplot / scatter /
   distribution sharing the tip axis.
8. Alignment track (msaplot, Phase 3).
9. Composing a publication figure: multi-panel layout, legends, captions, the
   gallery of worked examples (rebuild recognizable figures end to end).
10. Exporting: SVG / PNG, and the ggtree R-code export (honest "close not
    pixel-identical").
11. Reproducing a published tree: ties to the /transparency published-tree
    reproduction work (HPV58, Craugastor), "we recover the published figure".

## Per-page contract

Every handbook page carries: a concept-first explanation (house voice, no
em-dashes/emojis/mid-sentence-colons), a worked recipe (which example dataset, the
layers to add, the bindings), and at least one annotated screenshot from fixture
mode. A page is not done until its feature exists AND its screenshot is captured.

## Sequencing (ships with the features)

- NOW (parallel to Phase 1 build): scaffold the handbook section + the IA + the
  concept/styling/tip-decoration/scales pages whose features already exist
  (Phase 0 shipped continuous scales + legends + value heatmaps). Capture those
  screenshots.
- As Phase 1 lands: the layers-model + aligned-data-panels chapters (the big one),
  with screenshots of the multi-panel figures.
- As Phase 2/3 land: the Data Hub linkage + msaplot + gallery chapters.
- Each phase's merge includes its handbook page + screenshot, not a separate
  later docs pass.

## Gallery (the show-off)

A gallery page that rebuilds recognizable, genuinely complicated figures end to
end from committed example data, each with the recipe and the final screenshot, so
a reader sees the ceiling at a glance. Targets: a multi-ring epidemiology figure
(clade strip + continuous resistance/abundance heatmap + outer bar), a gheatmap
genotype matrix, an aligned-distribution figure (Data Hub boxplots by tip), and a
reproduced published tree.
