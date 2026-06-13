# Phylogenetics demo tree sources

These are REAL published phylogenetic trees and their REAL metadata, fetched
verbatim from public sources (never fabricated, never AI-extracted). Each file is
the literal downloaded bytes. They seed the `/phylo` demo so the Tree Studio opens
into populated, recognizable, citable figures, and they are the inputs the
transparency comparison renders against ggtree.

Every tree was validated against our own `parseNewick` before being committed
(tip counts and metadata-id overlap checked).

## candida_auris/

Candida auris global genomic epidemiology, a real fungal pathogen tree.

- `tree.nwk`: 305 tips. `metadata.csv`: 305 rows (304 match tree tips). Columns
  include CLADE (Clade1-4), COUNTRY, year, and antifungal-resistance calls
  (FCZ / AMB / MCF) plus ERG11 / FKS1 resistance-mutation genotypes.
- Fetched from the YuLab-SMU/treedata-book example data (a public Microreact
  project for Candida auris), 2026-06-12:
  https://github.com/YuLab-SMU/treedata-book (data-backup/microreact/Candida_auris/)
- Microreact: Argimon S, et al. "Microreact: visualizing and sharing data for
  genomic epidemiology and phylogeography." Microb Genom. 2016.

## hmp/

The Human Microbiome Project tree, the canonical example figure from the
ggtreeExtra paper. Exercises every annotation track (tip points by phylum, ring
heatmap of abundance by body site, outer bar plot).

- `tree.nwk`: 333 tips. `tippoint.csv` (Phylum, Type, Size), `ringheatmap.csv`
  (Sites, Abundance), `barplot.csv` (Sites, HigherAbundance). Metadata ids match
  all 332 annotated tips.
- Fetched from YuLab-SMU/treedata-book (data-backup/HMP_tree/), 2026-06-12.
- ggtreeExtra: Xu S, et al. "ggtreeExtra: Compact Visualization of Richly
  Annotated Phylogenetic Data." Mol Biol Evol. 2021;38(9):4039-4042.

## hpv58/

A human papillomavirus type 58 phylogeny, a smaller tree (90 tips) with bootstrap
support values on internal nodes, used for the rectangular phylogram + support +
clade-highlight story. Tip labels are strain|GenBank-accession.

- `tree.nwk`: 90 tips.
- Fetched from YuLab-SMU/treedata-book (data-backup/HPV58.tree), 2026-06-12, an
  example dataset distributed with ggtree.
- ggtree: Yu G, et al. "ggtree: an R package for visualization and annotation of
  phylogenetic trees with their covariates and other associated data." Methods
  Ecol Evol. 2017;8(1):28-36.

All redistributed example data above is from the YuLab-SMU/treedata-book
repository (the treeio / ggtree / ggtreeExtra reference book), used here as
demo + transparency fixtures with attribution to the upstream studies.
