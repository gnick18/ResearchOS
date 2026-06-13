# HPV58 single-locus nucleotide reproduction

Reproduces a human papillomavirus type 58 (HPV58) whole-genome phylogeny from the
raw GenBank genomes, a single-locus nucleotide case (align with MAFFT, trim with
trimAl, infer with IQ-TREE + ModelFinder + UFBoot).

## Input (`input.fasta`)

90 complete HPV58 genomes, one per tip in the published tree. Each sequence is the
VERBATIM GenBank record, fetched 2026-06-13 from NCBI nuccore via E-utilities
efetch (`rettype=fasta`), no edits to the bases. Lengths range 7781 to 7863 bp
(complete genomes). The FASTA headers were set to the published tree's tip labels
(`strain|accession`) so a recipe run produces tip names that line up with the
published tree for scoring; only the header text was set, the sequence bytes are
untouched.

The 90 accessions are exactly the accessions carried in the published tree's tip
labels (the part after the `|`), for example D90400, FJ385261-FJ385268, KY225918,
KU298920, the AB819275-AB819279 series, and so on. The full list is recoverable
from the tip labels of the published tree.

## Published tree (the comparison target)

The HPV58 example phylogeny distributed with ggtree (90 tips, bootstrap support on
internal nodes, tip labels `strain|GenBank-accession`). It is the SAME tree we
seed the /phylo demo with, committed at
`frontend/src/lib/phylo/__seed__/sources/hpv58/tree.nwk` and inlined as
`HPV58_NWK`. To keep one source of truth, `phylo-published.ts` reuses that constant
as this case's published tree rather than committing a second copy.

- ggtree: Yu G, Smith DK, Zhu H, Guan Y, Lam TT. "ggtree: an R package for
  visualization and annotation of phylogenetic trees with their covariates and
  other associated data." Methods Ecol Evol. 2017;8(1):28-36.
- Redistributed via the YuLab-SMU/treedata-book example data with attribution to
  the upstream HPV58 study.

## BuilderOptions

See `builder-options.json`: nucleotide / single locus / raw input, MAFFT --auto,
trimAl -automated1, IQ-TREE 2 with ModelFinder and 1000 UFBoot replicates.

## To activate

```
scripts/run-phylo-published-case.sh hpv58
```

Then commit the rewritten `result.json` (pending flips to false).
