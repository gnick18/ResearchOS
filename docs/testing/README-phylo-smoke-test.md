# Phylo Tree Builder smoke test

`phylo-smoke-test.fasta` is a small SYNTHETIC nucleotide set (6 sequences, 200 bp,
two clades A and B) for verifying that the Tree Builder's generated commands
actually run on a real machine. It is not real data, just six alignable sequences
that produce a clean two-clade tree in seconds.

Quickest single-locus run (matches the wizard default: MAFFT, trimAl, IQ-TREE,
UFBoot + SH-aLRT):

```bash
mafft --auto phylo-smoke-test.fasta > alignment.fasta
trimal -in alignment.fasta -out trimmed.fasta -automated1
iqtree2 -s trimmed.fasta -m MFP -T AUTO --prefix tree -B 1000 -alrt 1000 -bnni
```

Then open `tree.treefile` in the Tree Studio (`/phylo`). Expect seqA1/A2/A3 in
one clade and seqB1/B2/B3 in the other.

To exercise the supermatrix or coalescent pipelines, copy this file into a
`genes/` folder a few times under different names (e.g. `gene1.fasta`,
`gene2.fasta`) and run the multi-gene recipe the wizard generates for those modes.
