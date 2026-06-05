# Annotated gene + accession import via efetch

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT. Grant: get
ANNOTATED gene imports (not bare FASTA), design doc first, scope = genes plus any
accession. Extends the NCBI Datasets integration
(`docs/proposals/ncbi-datasets-import.md`).

## The problem this solves

NCBI genome/assembly imports already arrive fully annotated, because the Datasets
genome endpoint serves GBFF (committed, live). Gene imports do NOT. Verified live
2026-06-05:

- The Datasets GENE endpoint is FASTA only. `include_annotation_type=GENOME_GBFF`
  returns HTTP 400 on the gene path; the valid types are all `FASTA_*`
  (FASTA_GENE / FASTA_RNA / FASTA_PROTEIN / FASTA_CDS / FASTA_5P_UTR /
  FASTA_3P_UTR). So a gene download is sequence with no features.
- The gene `data_report.jsonl` carries gene-level metadata (genomic location, GO
  terms, transcript COUNTS, the RefSeqGene accession) but NO exon or CDS
  coordinates, so there is nothing to synthesize internal features from there.
- Pointing the Datasets genome endpoint at a transcript or RefSeqGene accession
  (NM_ / NG_) returns HTTP 200 but a hollow 847-byte package with no GBFF. Datasets
  GBFF is assembly-scoped only.

So via Datasets, a gene is sequence-only. The annotation has to come from elsewhere.

## The fix: efetch is browser-direct (corrects an earlier note)

An earlier reference note of mine said efetch / E-utilities is not CORS-open. That
is WRONG, verified live 2026-06-05. A real cross-origin GET to efetch returns
`access-control-allow-origin: *` and fully annotated GenBank:

- `GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=<acc>&rettype=gbwithparts&retmode=text`
  with `Origin: https://research-os.app` responds `HTTP/2 200`,
  `content-type: text/plain`, `access-control-allow-origin: *`. A browser `fetch`
  is a simple GET, no preflight, so this works browser-direct with no proxy.
- `NM_000546.6` (TP53 MANE transcript) came back as 38 KB of annotated GenBank, 1
  CDS, 11 exons, a gene feature, 54 misc_features, full organism + lineage,
  references.
- `NG_017013.2` (TP53 RefSeqGene) came back as 148 KB, 2 genes, 12 mRNAs, 12 CDS,
  16 exons. The whole annotated gene region.

efetch returns GenBank TEXT, which our existing `importSequenceFile` ->
`genbankToJson` path already parses into a fully annotated record. No new parser.

This is broader than genes. efetch imports ANY nuccore accession as annotated
GenBank (transcripts NM_, RefSeqGene NG_, single chromosomes NC_, plasmids, custom
accessions), which is the scope Grant chose.

## The overall strategy: Datasets for assemblies, efetch for accessions

- WHOLE ASSEMBLY (GCF_ / GCA_) -> Datasets GBFF package. Its packaging handles huge
  multi-file genomes (chromosome + plasmids + many contigs) as one ZIP. KEEP.
- INDIVIDUAL ACCESSION (NG_ / NM_ / NP_ / a single NC_ / a plasmid / any nuccore id)
  -> efetch GenBank. NEW.
- GENE BY SYMBOL -> resolve to its RefSeqGene accession, then efetch. NEW.

efetch is not a good fit for a whole multi-gigabase assembly (one giant text
stream, and the assembly may be many sequences); that stays on Datasets GBFF.

## Gene to accession resolution

We already preview a gene by symbol (`previewGeneBySymbol` in
`ncbi-datasets.ts`) and can fetch its `data_report.jsonl`. That report carries
`referenceStandards[].geneRange.accessionVersion`, the RefSeqGene `NG_` accession
(e.g. `NG_017013.2` for TP53). So:

1. Gene symbol or id -> Datasets gene report -> the RefSeqGene `NG_` accession.
2. efetch that `NG_` as `gbwithparts` -> the whole annotated gene region (all the
   gene's transcripts, exons, CDS, plus organism + lineage).

The RefSeqGene record is the natural primary, it is the curated "this gene as an
annotated GenBank record." The MANE Select transcript (`NM_`) is a secondary
option (just the canonical mRNA + its CDS); the gene report does not list the
`NM_` directly, so that needs an extra resolve (esearch / elink or the gene FASTA
RNA report), which is why it is a follow-up, not v1.

## Import flow (reuses the whole pipeline)

efetch GenBank text -> `importSequenceFile(name, bytes)` -> `genbankToJson` ->
annotated `ImportedSequence`(s). The same path the file-import and the GBFF genome
import already use. Provenance: set `source = "ncbi-datasets"` (or a sibling tag,
see open questions) + `ncbi_accession`. Taxonomy auto-fills: the GenBank carries
the ORGANISM + lineage, and the Phase 2 enrichment can resolve the named lineage
onto the sidecar, so an efetch import lands with organism + taxonomy like a GBFF
genome does.

## Rate limits + NCBI etiquette

- efetch unauthenticated allows 3 requests per second per IP. We will NOT ship an
  API key (a no-backend app cannot hold a secret, and entering credentials is a
  prohibited action). For interactive single-record imports, 3/sec is plenty.
- Sequence requests, small backoff on HTTP 429, never fire a burst. One import is
  one or two calls (resolve + efetch).
- NCBI asks callers to identify with `tool` and `email` URL params. Set
  `tool=research-os`. Do NOT put the user's email in the URL (privacy rule, no
  personal data in query strings). See open questions for whether to send any
  contact at all.

## rettype + error handling

- Use `rettype=gbwithparts&retmode=text` so records that use CONTIG joins still
  carry the full sequence (a plain `gb` can omit it).
- efetch returns a plain-text error body or an empty response for a bad id rather
  than a non-200, so the client must detect "this is not GenBank" (no `LOCUS`
  line) and surface a calm error, not feed garbage to the parser.
- A record can hold multiple features and even multiple genes (NG_017013.2 has
  TP53 + a neighbor); it imports as one annotated LOCUS, which is correct.

## UI

Slot into `NcbiDownloadDialog.tsx`:

- An ACCESSION input: paste any accession (NG_ / NM_ / NP_ / NC_ / plasmid) ->
  efetch -> annotated import. This is the general path Grant chose.
- The GENE-by-symbol path returns annotated by default (resolve -> efetch) instead
  of FASTA. Keep a sequence-only option for the bulk gene/rna/protein/cds FASTA
  case (see open questions).
- Preview before download (organism, length, feature count if cheap) consistent
  with the existing dialog. Escape closes, Tooltip on icon-only controls, inline
  SVG, semantic type tokens, no em-dash / emoji / mid-sentence colon.

## Files (anticipated)

- ADD `lib/sequences/ncbi-efetch.ts`: `efetchGenbank(accession, {signal})` ->
  GenBank text (with the not-GenBank guard), and `resolveGeneToAccession(symbol or
  id, taxon)` -> the RefSeqGene `NG_` (reusing the gene report). Pure-ish, tested
  against saved real responses.
- EDIT `ncbi-datasets.ts` or the dialog glue: route individual accessions + genes
  through efetch, assemblies through the existing Datasets GBFF.
- EDIT `NcbiDownloadDialog.tsx`: the accession input + annotated-by-default gene
  path + preview.
- ADD fixtures under `__fixtures__/efetch/` (a saved NM_ and NG_ GenBank, a saved
  gene report) + tests: parse yields the expected features (CDS / exon / gene),
  the not-GenBank error body is rejected, gene -> NG_ resolution.

## Tests

- Parse a saved efetch `NM_000546.6` GenBank -> assert 1 CDS, 11 exons, a gene
  feature, organism present.
- Parse a saved efetch `NG_017013.2` -> assert multiple CDS + exons.
- `resolveGeneToAccession` against a saved TP53 gene report -> `NG_017013.2`.
- An efetch error body (no LOCUS) -> the client returns a typed error, not a parse.

## Open questions for Grant

1. Gene default: the RefSeqGene `NG_` (whole gene region, all transcripts + exons,
   sometimes a neighboring gene) vs the MANE Select transcript `NM_` (just the
   canonical mRNA + CDS). Recommend `NG_` primary in v1, `NM_` as a follow-up
   option once we add the transcript resolve.
2. Keep the sequence-only gene FASTA path alongside annotated, or replace it?
   Recommend keep both, annotated by default, a "sequence only" toggle for the bulk
   FASTA case.
3. NCBI identification params: send `tool=research-os` with no email, or include a
   generic project contact email (not the user's)? Recommend `tool` only, no email,
   to keep zero PII in the request.
4. Provenance tag: reuse `source = "ncbi-datasets"` for efetch imports too, or add a
   sibling like `"ncbi-efetch"` so the origin endpoint is distinguishable?
   Recommend a sibling tag for honesty about where the record came from.

## Risks

- efetch rate limit (3/sec unauthenticated): mitigated by sequential calls + a
  small backoff; interactive imports never burst.
- efetch error-as-200-text: handled by the not-GenBank guard.
- Very large records over efetch (a whole chromosome): steer those to Datasets GBFF
  via the assembly path; efetch is for individual gene / transcript / plasmid-scale
  records.
