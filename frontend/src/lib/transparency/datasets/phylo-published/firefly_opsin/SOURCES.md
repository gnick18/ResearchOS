# Firefly UV-opsin single-gene protein reproduction

Reproduces the firefly long-wavelength / UV opsin gene tree of Sander & Hall 2015,
a single-gene PROTEIN case (skip alignment, the published amino-acid alignment is
used as is, infer with IQ-TREE + ModelFinder + UFBoot). This case rounds out the
data types: a nucleotide single locus (hpv58), a nucleotide supermatrix (turtle),
and a protein single gene here.

## Input + published tree — BOTH come from Dryad (human download)

Dryad blocks scripted download (a curl gets a small HTML interstitial, not the
files), so a human downloads the two files in a browser and drops them in:

- `input.fasta`: the published amino-acid alignment `UV_38aa_formatted.fasta`.
- the published comparison tree: `BEAST_SL2015_plus32tax.tre`, the Sander & Hall
  BEAST tree. Commit it and inline it as `OPSIN_PUBLISHED_NWK` in
  `../phylo-published.ts` (parse the `.tre`, it is Newick or NEXUS our parser
  reads).

- Source study: Sander SE, Hall DW. "Variation in opsin genes correlates with
  signalling ecology in North American fireflies." Mol Ecol. 2015;24(18):4679-4696.
  doi:10.1111/mec.13346
- Data: Dryad doi:10.5061/dryad.q878c

Until both files are committed and the published tree is inlined, this case stays
inactive (`publishedNewick` null, input absent, the gate skips it). Do not
reconstruct either file by hand.

## BuilderOptions

See `builder-options.json`: protein / single gene / pre-aligned input, IQ-TREE 2
with ModelFinder (LG family) and 1000 UFBoot replicates.

## To activate

1. Download `UV_38aa_formatted.fasta` and `BEAST_SL2015_plus32tax.tre` from Dryad
   (doi:10.5061/dryad.q878c), commit the FASTA as `input.fasta`, and add the tree
   as `OPSIN_PUBLISHED_NWK` in `phylo-published.ts`.
2. `scripts/run-phylo-published-case.sh firefly_opsin`, then commit the rewritten
   `result.json`.
