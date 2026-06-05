# NCBI taxonomy + accession metadata enrichment

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT. Extends the NCBI
Datasets integration (`docs/proposals/ncbi-datasets-import.md`). Grant: look up the
taxonomy of something, look up an accession, and attach NCBI metadata to any
sequence entry on demand.

## Goal

Three related capabilities, all browser-direct (no proxy), reusing the NCBI
Datasets client the import feature adds:
1. TAXONOMY LOOKUP: type an organism name (or tax id) and get its tax id, rank,
   and named lineage (domain / kingdom / phylum / ... / species).
2. ACCESSION METADATA: given an accession, fetch the metadata NCBI exposes
   (organism, tax id, gene / assembly name, length).
3. ENRICH A SEQUENCE (opt-in): for any sequence in the library, look up its
   organism / accession and ATTACH the metadata (organism, tax id, taxonomy
   lineage) to the sequence record, if the user chooses to.

## Verified (2026-06-05): taxonomy is browser-direct

- The Datasets taxonomy endpoint is CORS-open: `OPTIONS
  /datasets/v2/taxonomy/taxon/{name_or_id}` reflects our origin
  (`access-control-allow-origin: https://research-os.app`).
- `GET /datasets/v2/taxonomy/taxon/9606` returns the tax id, scientific name
  ("Homo sapiens"), rank ("SPECIES"), and a `lineage` array of ancestor tax ids
  (31 for human). The lineage comes as IDS; resolve them to NAMES via a batch
  taxonomy call (the endpoint takes comma-separated ids) or use the response's
  ranked classification if present. So named-lineage display is one extra resolve.

## Format note (corrected 2026-06-05)

An earlier draft claimed full GenBank-record metadata needs efetch (not CORS-open).
That is WRONG for assembly/genome accessions: the Datasets API serves the full
annotated GenBank Flat File browser-direct via `include_annotation_type=GENOME_GBFF`
(verified live; see ncbi-datasets-import.md), and the GBFF carries the DEFINITION,
the ORGANISM line with the complete taxonomy lineage, the REFERENCE / author list,
and all features. So for an NCBI-imported genome, the organism + lineage (+
references) are ALREADY on the record, no separate enrichment call needed.

Where enrichment still adds value: (a) sequences NOT imported from NCBI (a
file-imported or hand-built sequence the user wants to tag), and (b) the standalone
taxonomy lookup (organism -> lineage) independent of any sequence. For those, the
taxonomy endpoint (CORS-open) supplies organism + tax id + named lineage. The only
genuinely browser-direct-unavailable case is the prose record for a single
non-assembly accession with no GBFF; that is a narrow edge, not the common path.

## Capabilities in detail

### 1. Taxonomy lookup
`resolveTaxonomy(query)` (organism name or tax id) -> `{ taxId, name, rank,
lineage: { taxId, name, rank }[] }`. Reuses the NCBI client module from the import
(`lib/sequences/ncbi-datasets.ts`); add the taxonomy endpoint + a batch id->name
resolve. Pure parsing tested against a saved real response.

### 2. Accession metadata
For an accession, return `{ accession, organism, taxId, title, lengthBp? }` from the
relevant Datasets `dataset_report` (gene / genome), routed by accession class (the
import already has `previewByAccession`). Reuse it; this is mostly the same call.

### 3. Enrich a sequence (the main ask, opt-in)
An "Enrich from NCBI" action on a sequence. It resolves the organism / accession by,
in order:
- the sequence's own GenBank ACCESSION (from the parsed record), or its
  `ncbi_accession` provenance if it was NCBI-imported, or
- a user-typed organism name or accession when the sequence has none.
Then it PREVIEWS the metadata (organism, tax id, named lineage) and lets the user
APPLY selected fields to the sequence's sidecar. Opt-in, never automatic, with a
preview before write (mirrors the Detect-Features accept pattern).

## Data shape (additive sidecar)

Extend `SequenceMeta` additively (the import already adds `source` /
`ncbi_accession` / `organism` / `tax_id`):
- `tax_lineage?: { taxId: string; name: string; rank: string }[]` (the named
  lineage), and reuse `organism` / `tax_id`.
All optional sidecar fields, no migration, self-hiding when absent. FLAG when built.

## UI

- A "Enrich from NCBI" action on the sequence (the editor header or a small
  metadata panel / the sequence detail), opening a preview-then-apply dialog
  (reuse the `NcbiDownloadDialog` shell pattern + the accept-pattern review).
- DISPLAY the organism + lineage as a calm metadata chip / line on the sequence
  (header or an info section), so enriched sequences show their classification.
  Round-trips: write the organism into the GenBank `source` feature's `/organism`
  + `/db_xref="taxon:<id>"` qualifiers so it survives export, AND the sidecar for
  fast display.
- A standalone TAXONOMY LOOKUP (type an organism -> see the lineage) can be a small
  tool in the workbench launcher; lower priority than the enrich action.

## Reuse + sequencing

- Reuses the NCBI Datasets CLIENT (`ncbi-datasets.ts`), the SequenceMeta provenance
  fields, the preview-then-apply UI shell, and the sequences page, ALL of which the
  NCBI import feature is adding right now.
- So this is PHASE 2 of the NCBI integration and should be built AFTER the import
  lands, to avoid colliding on the same client / metadata / page. The design is
  captured here so it is ready the moment the import is in.

## Open questions for Grant

1. Auto-enrich on NCBI import (set organism + tax id + lineage automatically when a
   sequence is downloaded from NCBI, since we already have the metadata), vs always
   opt-in even there. Recommend: auto-fill on NCBI import (we have it for free), and
   opt-in enrich for everything else.
2. How much lineage to show: the full chain, or the major ranks (superkingdom /
   kingdom / phylum / class / order / family / genus / species)? Recommend major
   ranks, full chain on expand.
3. The standalone taxonomy-lookup tool: build it, or just the enrich-a-sequence
   action for v1? Recommend enrich action first.

## Risks

- The named-lineage resolve is an extra batch call; cache resolved tax ids to keep
  it cheap.
- Honest framing of the efetch limit (no full record metadata browser-direct);
  handled by the copy above.
