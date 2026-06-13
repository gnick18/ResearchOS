# Turtle concatenated-supermatrix reproduction

Reproduces the turtle phylogenomics result of Chiari et al. 2012, a concatenated
supermatrix case (skip alignment, the matrix is already aligned, partition by gene,
infer one ML tree with IQ-TREE + ModelFinder + UFBoot). The headline biological
result is that turtles (Testudines) are the sister group to Archosauria (birds plus
crocodiles).

## Input (`input.fasta` + `partitions.nex`)

The 16-taxon turtle supermatrix used in the official IQ-TREE tutorial, fetched
2026-06-13 verbatim from the IQ-TREE workshop data
(`http://www.iqtree.org/workshop/data/turtle.fa` and `turtle.nex`). The alignment
is 20,820 nucleotide columns across 29 gene partitions defined in
`partitions.nex` (renamed here from `turtle.nex`; the charset definitions are
untouched). The 16 taxa are protopterus, Xenopus, the four turtles
(emys_orbicularis, phrynops, caretta, chelonoidis_nigra), the archosaurs (Gallus,
Taeniopygia, alligator, caiman), plus Anolis, python, podarcis, Homo, Monodelphis,
and Ornithorhynchus.

- Source study: Chiari Y, Cahais V, Galtier N, Delsuc F. "Phylogenomic analyses
  support the position of turtles as the sister group of birds and crocodiles
  (Archosauria)." BMC Biol. 2012;10:65. doi:10.1186/1741-7007-10-65
- Tutorial dataset: the IQ-TREE 2 workshop partitioned-analysis example, a subset
  of the Chiari et al. genes.

## Published tree (the comparison target) — SOURCING TODO

This case ships its verbatim alignment, but its published comparison tree is not in
the repo yet. The honest options are the Chiari et al. 2012 supermatrix tree from
the paper's TreeBASE submission or its supplementary files (verbatim Newick, never
hand-typed). Until that tree is committed and inlined as `TURTLE_PUBLISHED_NWK` in
`../phylo-published.ts`, this case stays inactive (its `publishedNewick` is null and
the gate skips it). Do not author the topology by hand.

## BuilderOptions

See `builder-options.json`: nucleotide / concatenated supermatrix / pre-aligned
input, partition by gene with proportional branch lengths, IQ-TREE 2 with
ModelFinder and 1000 UFBoot replicates, lungfish + frog as the outgroup.

## To activate

1. Source the Chiari 2012 supermatrix tree (TreeBASE / supplement), commit it, and
   add it as `TURTLE_PUBLISHED_NWK` in `phylo-published.ts`.
2. `scripts/run-phylo-published-case.sh turtle`, then commit the rewritten
   `result.json`.
