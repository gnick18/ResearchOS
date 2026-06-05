# NCBI Datasets import (download a gene / genome into your collection)

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT for Grant's
sign-off. Grant's idea: a user fills in a small form ("download this gene from
this isolate"), we make the NCBI Datasets API calls for them, and the result
lands in their sequence collection automatically. Single gene / single genome at
a time, with caps; bulk downloads are explicitly not what this is for.

## Goal

From the Sequences library, let a user pull a gene, a genome, or a protein from
NCBI by filling in a form (gene symbol + organism, or an accession), preview what
they will get, and import it straight into their collection. No leaving the app,
no command line, no manual FASTA wrangling.

## Why it fits

- One more reason a scientist never has to leave ResearchOS, the same thesis as
  the sequence editor itself.
- It reuses almost everything we already have: the FASTA / GenBank parser
  (bio-parsers), `sequencesApi.create`, the collection model, and the same
  browser-direct external-API pattern as the NCBI BLAST handoff, InterProScan,
  and the Zenodo deposit. The only genuinely new pieces are a form, a client-side
  ZIP unpack, and an optional GFF3-to-features step.

## Gating fact (verified 2026-06-05): browser-direct works

- The NCBI Datasets v2 API is CORS-open for browser-direct calls. The OPTIONS
  preflight reflects our origin (`access-control-allow-origin: https://research-os.app`),
  allows GET / POST, exposes the rate-limit headers, and permits an `api-key`
  header. So we call it straight from the browser, no proxy, fully in the
  no-backend model.
- The OLDER E-utilities `efetch` returned no CORS header, so we do NOT build on
  the classic eutils path. Build on the modern Datasets v2 API.
- Verified the report endpoints return exactly the metadata we need:
  - `GET /datasets/v2/gene/symbol/BRCA1/taxon/9606/dataset_report` -> gene id,
    symbol, description, organism, type, chromosomes, SwissProt xref, synonyms.
  - `GET /datasets/v2/genome/accession/GCF_000005845.2/dataset_report` -> organism
    "Escherichia coli str. K-12 substr. MG1655", total_sequence_length 4,641,652,
    number_of_contigs 1, assembly_level "Complete Genome".

## The API surface we use

Base: `https://api.ncbi.nlm.nih.gov/datasets/v2`.

- PREVIEW (cheap JSON, drives the confirm + caps step):
  - gene by symbol + taxon: `/gene/symbol/{symbol}/taxon/{taxon}/dataset_report`
  - gene by accession / id: `/gene/accession/{acc}/dataset_report`, `/gene/id/{id}/...`
  - genome by accession: `/genome/accession/{acc}/dataset_report`
  - genome by taxon (lists assemblies to choose from):
    `/genome/taxon/{taxon}/dataset_report`
  - taxonomy resolve (organism name -> tax id): `/taxonomy/taxon/{query}/...`
- DOWNLOAD (returns a ZIP data package):
  - the matching `/download` endpoint, with `include_annotation_type` to pick the
    payload (GENOME_FASTA, GENE_FASTA, PROT_FASTA, GFF3, ...).
- The ZIP unpacks to `ncbi_dataset/data/...` holding the FASTA file(s) plus a
  `data_report.jsonl` (and GFF3 when requested).

## The pipeline (preview -> confirm -> download -> import)

1. The user fills the form and we hit the `dataset_report` endpoint. We show a
   PREVIEW card: organism, gene / assembly name + accession, sequence length,
   number of contigs, assembly level.
2. CAPS are enforced here, on the cheap metadata, before any large transfer (see
   Caps). If over a cap, we refuse with a clear message instead of downloading.
3. On confirm, we fetch the `/download` ZIP, unzip it client-side with a small lib
   (fflate, ~tiny, MIT), and pull the FASTA (and GFF3 if present) out of
   `ncbi_dataset/data/`.
4. Parse the FASTA with the existing bio-parsers and create sequence records via
   `sequencesApi.create`, filing them in the active collection, carrying NCBI
   provenance metadata (accession, organism, tax id, source = "NCBI Datasets").
5. The new sequence opens in the editor. For an unannotated FASTA, the user can
   run Detect Features; mapping GFF3 -> features is a follow-up (see Format).

## UX / entry point

- A "Download from NCBI" action in the Sequences library header, alongside New /
  Import / Assemble.
- A small typed form: pick GENE / GENOME / PROTEIN / ACCESSION, with the fields
  each needs (gene symbol + organism for a gene; an accession for a genome; a free
  accession box for the catch-all). Organism can be a name we resolve to a tax id
  via the taxonomy endpoint, with an autocomplete later.
- The preview card with a clear Download button (disabled + explained when a cap
  is exceeded).
- Calm progress during download + unpack; the imported sequence(s) appear in the
  collection on success.

## Caps and guardrails (Grant: single sequence at a time, not bulk)

- ONE genome at a time. No batch / list downloads in this feature; if a user wants
  many genomes, point them at the NCBI Datasets CLI, this is not that tool.
- SIZE cap on `total_sequence_length` from the preview (e.g. refuse over a few tens
  of Mb): bacterial genomes (a few Mb) import fine; eukaryotic genomes (Gb-scale)
  would choke the editor and are refused with a clear message.
- CONTIG-COUNT cap: a draft assembly with thousands of contigs becomes thousands
  of sequence records, which is noise. Cap the contig count, or import a
  many-contig assembly as a single grouped record (open question).
- These caps live on the preview metadata, so they cost nothing and trigger before
  any big transfer.

## Rate limits + optional API key

- The Datasets API rate-limits anonymous use (it exposes X-RateLimit headers).
  Occasional single fetches are fine anonymously.
- Offer an OPTIONAL user-supplied NCBI API key in settings for power users who hit
  limits (the API accepts an `api-key` header, confirmed in the preflight). Never
  required; never ours to ship a shared key that could get rate-limited for
  everyone.

## Format (FASTA + GFF3, not annotated GenBank)

- Datasets returns FASTA plus optional GFF3, not annotated GenBank (unlike the
  classic efetch, which is not CORS-open anyway). So:
  - V1 imports the FASTA and lets the user run Detect Features to annotate.
  - FOLLOW-UP: request GFF3 in the download and map its features onto the imported
    sequence so a gene / genome arrives pre-annotated. This is a clean additive
    step once the FASTA path works.

## Phased plan

1. SINGLE FETCH. The form + preview + download + unzip + FASTA import for a single
   gene (by symbol + organism) and a single accession (gene / genome / protein),
   with the size + count caps. Reuses bio-parsers + sequencesApi.create.
2. GENOME + ANNOTATIONS. Genome-by-taxon assembly picker, GFF3 -> features so the
   import arrives annotated, provenance metadata on the record.
3. BROWSE. Taxonomy search / autocomplete (organism name -> assemblies / genes),
   so the user does not need an exact accession.

## Open questions for Grant

1. Exact caps: the size limit (a few tens of Mb?) and the contig-count limit, and
   whether a many-contig assembly imports as N records or one grouped record.
2. Annotated import: is GFF3 -> features wanted in v1, or is FASTA + Detect
   Features fine to start?
3. Protein downloads: do protein sequences belong in the same sequence collection
   (we store DNA / RNA / protein already), or is this DNA-first for v1?

## Risks

- Large genomes straining the editor; mitigated by the size cap on preview.
- API shape drift / rate limits; mitigated by the preview step, clear errors, and
  the optional API key.
- Scope creep toward a full NCBI browser. V1 is single gene / genome / accession
  with caps, not a bulk or discovery tool.

## Sources / verification

- NCBI Datasets v2 API (CORS-open, verified): https://www.ncbi.nlm.nih.gov/datasets/docs/v2/
- Preflight reflected our origin + allowed GET/POST + api-key header (verified live 2026-06-05).
- Report shapes verified live for BRCA1 (gene) and GCF_000005845.2 (E. coli genome: 4.64 Mb, 1 contig).
- fflate (client-side unzip, MIT): https://github.com/101arrowz/fflate
