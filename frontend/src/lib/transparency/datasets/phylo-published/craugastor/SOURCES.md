# Craugastor concatenated-supermatrix reproduction

Reproduces the multilocus phylogeny of the montane Craugastor podiciferus frog
species complex from Streicher, Crawford & Edwards 2009, a concatenated
supermatrix case (skip alignment, the published matrix is already aligned,
partition by gene, infer one ML tree with IQ-TREE + ModelFinder + UFBoot). This
is the nucleotide-supermatrix data type in the published-reproduction set, next to
the nucleotide single-locus (hpv58) and protein single-gene (firefly_opsin) cases.

## Input (`input.fasta` + `partitions.nex`)

The published 4-gene concatenated alignment, fetched 2026-06-13 verbatim from the
study's TreeBASE submission (study S10103, matrix "Total_Alignment"), 47 taxa x
1658 aligned columns across 4 partitions defined in `partitions.nex` exactly as
the submission's NEXUS SETS block gives them: 12S (1-380), 16S (381-737), CO1
(738-1244), c-myc (1245-1658). Two faithful format conversions only, no change to
the data: the NEXUS character matrix was written out as FASTA (taxon labels become
headers), and NEXUS polymorphism/uncertainty braces (e.g. `{AG}`, one alignment
column with two states) were collapsed to their single IUPAC ambiguity code (`R`,
`Y`, `M`, `K`, `S`, `W`). Every sequence is 1658 columns after that, matching
NCHAR.

- Source study: Streicher JW, Crawford AJ, Edwards CW. "Multilocus molecular
  phylogenetic analysis of the montane Craugastor podiciferus species complex
  (Anura: Craugastoridae) in Isthmian Central America." Mol Phylogenet Evol.
  2009;53(3):620-630.
- Data: TreeBASE study S10103
  (https://purl.org/phylo/treebase/phylows/study/TB2:S10103).

## Published tree (the comparison target)

The study's published tree (TreeBASE tree "Fig._2", the figure-2 topology), pulled
from the SAME TreeBASE submission so its 47 tips carry the exact same taxon labels
as the matrix (no relabeling needed). It is committed inline as
`CRAUGASTOR_PUBLISHED_NWK` in `../phylo-published.ts`. The tree carries the
topology only, no branch support values, so this case is scored by a normalized
Robinson-Foulds tolerance rather than the support-aware criterion (see the case's
`rfTolerance` in `phylo-published.ts`). The numeric tip ids in the TreeBASE tree
were substituted with their labels using the submission's own TRANSLATE table, a
mechanical lookup, never a hand-drawn topology.

## BuilderOptions

See `builder-options.json`: nucleotide / concatenated supermatrix / pre-aligned
input, partition by gene with proportional branch lengths, IQ-TREE 2 with
ModelFinder and 1000 UFBoot replicates.

## To activate

```
scripts/run-phylo-published-case.sh craugastor
```

(set `PHYLO_THREADS` to a fixed number, the alignment is small so -T AUTO is
slow.) Then commit the rewritten `result.json`, and set this case's `rfTolerance`
in `phylo-published.ts` to match the honest reproduction.
