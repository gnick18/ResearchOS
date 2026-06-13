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

## Published tree (the comparison target) — NOT PUBLICLY DEPOSITED AS A NEWICK

This case ships its verbatim alignment, but its published comparison tree is NOT in
the repo, and a 2026-06-13 sourcing pass found it is not publicly deposited as a
parseable tree file anywhere:

- Dryad doi:10.5061/dryad.87b01fq0 holds ONLY the alignment matrices
  (`Chiari_amnios248genes_nt.nex` + `_aa.nex`, the 248-gene concatenations). No
  tree file.
- The BMC Biology supplements (PMC3473239) are Table S1 (Bayesian clock results),
  Figure S1 (the ML phylogram, an IMAGE), Figure S2 (pipeline diagram), and Table
  S2 (gene IDs). The published topology exists only as a figure, not a Newick.
- No TreeBASE submission for this study was found.

Transcribing the topology from the figure by hand would violate the verbatim rule
(`feedback_vendor_spec_research_verbatim`), so this case CANNOT be activated as an
RF reproduction with the current public data. `publishedNewick` stays null and the
gate skips it. Two honest paths if a supermatrix reproduction is wanted: (a) leave
this case inactive as a documented sourced-alignment-only stub, or (b) swap it for
a different supermatrix study that deposited BOTH its matrix AND its tree verbatim
(TreeBASE is built for exactly this, the turtle study just is not in it). Do not
author the topology by hand.

## BuilderOptions

See `builder-options.json`: nucleotide / concatenated supermatrix / pre-aligned
input, partition by gene with proportional branch lengths, IQ-TREE 2 with
ModelFinder and 1000 UFBoot replicates, lungfish + frog as the outgroup.

## To activate

1. Source the Chiari 2012 supermatrix tree (TreeBASE / supplement), commit it, and
   add it as `TURTLE_PUBLISHED_NWK` in `phylo-published.ts`.
2. `scripts/run-phylo-published-case.sh turtle`, then commit the rewritten
   `result.json`.
