# Guided NCBI genome import (organism to locus)

Status: design, mockup out for review (`docs/mockups/2026-06-12-ncbi-guided-genome-import.html`).
Owner: demo-video / sequences manager. Date: 2026-06-12.

## The idea

Replace the typed three-tab NCBI download dialog (Gene / Genome / Accession) with
a guided path that mirrors how a scientist actually thinks: type an organism,
pick its reference genome, find a gene, grab a window around that gene, import
only that slice. It is the flagship "no SnapGene, no Benchling" capability, and
it is also the best version of the welcome-page Sequence demo clip.

Worked example used throughout (real data): Aspergillus fumigatus Af293,
assembly GCF_000002655.1, gene cyp51A (AFUA_4G06890, the azole-resistance
target) on chromosome 4 (NC_007197.1), 1,777,375..1,781,822, minus strand.

## What we already have (verified in source)

- Organism autocomplete: `suggestTaxa` (taxonomy/taxon_suggest). DONE.
- Organism to assemblies with the reference flagged: `listTaxonAssemblies` +
  `isReference` (genome/taxon/{id}/dataset_report, refseq_category). DONE.
- Gene lookup call + accession download + zip unpack + import to library:
  `previewGeneBySymbol`, `downloadPackage`, `ncbiPackageToImports`. DONE.

## The gaps (three small backend additions, all endpoints verified live)

1. Contig list. `genome/accession/{acc}/sequence_reports` returns every
   chromosome with its RefSeq accession + length. Verified: GCF_000002655.1 ->
   8 chromosomes (NC_007194.1 .. NC_007201.1). Needs a thin wrapper
   `listAssemblySequences` + pure `parseAssemblySequences`.
2. Gene placement. The gene report carries the placement under
   `gene.annotations[].genomic_locations[]` (genomic_accession_version +
   genomic_range.begin/end + orientation); our `parseGeneReport` currently drops
   it. Add `parseGenePlacement`. E-utilities `esummary` genomicinfo is the
   fallback when Datasets has no placement.
3. Windowed efetch. `efetchUrl` fetches the whole record; add optional
   `seq_start` / `seq_stop`. Verified: NC_007197.1 windowed to ~19 kb returns
   38 KB (vs 7.26 MB for the whole chromosome) and still annotates cyp51A. Plus a
   pure `geneWindow(placement, flankBp, contigLen)` helper for the default.

These three are dispatched as a backend-only sub-bot (ncbi-datasets.ts,
ncbi-efetch.ts, + tests).

## Why a window, not the whole chromosome

Hard numbers pulled from NCBI: the full chromosome 4 efetch is 7.26 MB with
1,267 genes, which parses and renders slowly in the browser even with the
download precached. A gene-plus-flank window is tens of KB and instant, and it
still carries the genome provenance (the chromosome accession, the gene in
context with its real neighbors). Default window = gene span plus a flank on each
side (1,000 bp), editable, so the promoter and terminator context comes along for
cloning.

## Locus extraction (separate, in flight)

After the windowed region is in the library, the user selects the cyp51A feature
and uses "Extract to new sequence" (the `extractRegion` engine already exists and
is tested; the UI is being built now) to pull the gene onto its own sequence,
then Assemble (Gibson) it into pEGFP-N1. That closes the demo story.

## Decisions out for sign-off (in the mockup)

- NB-1 Replace the typed tabs with the guided flow (keep an accession escape hatch).
- NB-2 Window default = gene plus an editable flank. LOCKED (Grant).
- NB-3 Keep the Contigs step as a browsable step with a "search a gene instead" shortcut.
- NB-4 Gene placement from the Datasets report, esummary fallback.
- NB-5 This guided flow becomes the sequences demo clip, NCBI calls precached.

## Build order

1. Backend additions (in flight). 2. Mockup sign-off. 3. Guided wizard GUI.
4. Demo clip + precache around the full walk. The extract-locus UI lands in
parallel.
