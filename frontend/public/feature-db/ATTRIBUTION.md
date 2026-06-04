# Protein Feature Database, Attribution and Licensing

This dataset (frontend/public/feature-db/protein-features.json) powers an offline common-features detector. It was assembled by scripts/build-feature-db.mjs, which fetches real sequences from public APIs and combines them with a small set of cited standard epitope-tag constants. Re-run the script to regenerate or update the data.

Total entries: 41.

- epitope_tag: 10
- fluorescent_protein: 21
- fusion_tag: 3
- resistance_marker: 7

## Sources and licenses

### FPbase (fluorescent proteins)

Fluorescent protein sequences were fetched from the FPbase API (https://www.fpbase.org/api/proteins/). FPbase states that its sequence data is copyright-free; attribution is requested. Please cite FPbase: Lambert TJ (2019), FPbase: a community-editable fluorescent protein database, Nature Methods 16, 277-278. Each entry stores its exact FPbase API request URL and the FPbase UUID accession.

### UniProt (resistance markers and large fusion tags)

Resistance markers and large fusion tags (MBP, GST, SUMO) were fetched from the UniProt REST API (https://rest.uniprot.org/uniprotkb/search), restricted to reviewed Swiss-Prot entries. UniProt data is distributed under the Creative Commons Attribution 4.0 International (CC BY 4.0) license. Please cite: The UniProt Consortium, UniProt: the Universal Protein Knowledgebase, Nucleic Acids Research. Each entry stores its UniProt accession and canonical entry URL.

### Standard epitope and purification tags

Short epitope and purification tags (His6, His8, FLAG, 3xFLAG, HA, c-Myc, V5, Strep-II, T7-tag, AviTag) are standard published peptide sequences. They are definitional constants included verbatim from the literature and common molecular-biology references; they are not fetched. They are treated as public standard sequences. See the UniProt tag reference (https://www.uniprot.org/help/tags) and the original publications for each tag.

## No-fabrication guarantee

Every sequence in this dataset comes from either a live HTTP fetch against the named APIs (FPbase, UniProt), with the exact source URL and accession recorded on each entry, or from one of the cited canonical epitope-tag constants. No sequence was invented, completed, or recalled from memory. Every fetched sequence is validated against the amino-acid alphabet and a plausible per-category length band before inclusion.

## Scope and follow-up

This MVP covers PROTEIN features only. DNA elements (replication origins, promoters, multiple cloning sites, terminators) are intentionally excluded and require a separate DNA-reference curation pass with their own licensing review. That DNA pass is a planned follow-up.

<!-- DNA-FEATURE-DB-SECTION:START -->

# DNA Feature Database, Attribution and Licensing

This dataset (frontend/public/feature-db/dna-features.json) powers the DNA path of the offline common-features detector. It was assembled by scripts/build-dna-feature-db.mjs, which fetches real GenBank records from NCBI E-utilities and extracts each element by its annotated feature coordinates within that record. Re-run the script to regenerate or update the data.

Total DNA entries: 8.

- origin: 2
- promoter: 2
- regulatory: 3
- terminator: 1

## Source and licensing (NCBI GenBank)

All DNA element sequences were extracted from public GenBank records fetched from the NCBI E-utilities efetch endpoint (https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi, db=nuccore, rettype=gb). NCBI/GenBank places no copyright restrictions on the sequence data itself; the sequence facts are freely usable and redistributable. See the NCBI policies page (https://www.ncbi.nlm.nih.gov/home/about/policies/). Each entry stores the source accession, the exact 1-based feature coordinates used for extraction, the matched feature /note, and the efetch source URL, so every extraction is independently auditable. Please cite the underlying GenBank accessions when reusing these sequences.

## Extraction method (verified, not recited)

For each target element the build script pins a specific, well-annotated GenBank accession and a predicate that selects exactly one feature in that record by feature type plus /note or /regulatory_class. The stored sequence is the substring of the fetched record at that feature's coordinates; complement() locations are reverse-complemented; locations with fuzzy bounds (< or >) are refused. The script independently re-fetches and re-extracts a spot-check sample and aborts if any re-extraction does not match the stored sequence.

## No-fabrication guarantee

Every sequence in dna-features.json is the substring of a GenBank record fetched live from NCBI, taken at the coordinates of a matched annotated feature. No DNA sequence was written, completed, or recalled from memory. Every sequence is validated against the DNA alphabet (A, C, G, T, N) and a plausible per-category length band before inclusion. Targets that could not be cleanly sourced from a well-annotated record were omitted, not guessed.

## Omitted targets (could not cleanly source)

The following targets were intentionally omitted because no fetched record annotated them as an unambiguous coordinate range with a matching note. They are recorded here so a future curation pass can revisit them rather than fabricate a sequence.

- ColE1 / pUC origin (ori_cole1_puc): pUC19 (L09137) carries only a bare source feature; the pBR322 origin in J01749 is annotated as a single base point (rep_origin 2535), not a coordinate range, so no span can be extracted without inventing endpoints.
- pBR322 origin (ori_pbr322): J01749 annotates the pBR322 origin as a single base (rep_origin 2535) with no range; extracting a span would require guessed endpoints.
- p15A origin (ori_p15a): No fetched public-domain primary record annotated a p15A origin as a coordinate range.
- pSC101 origin (ori_psc101): Only an indirect reference exists (pBR322 J01749 misc_feature 1636..1762 noted 'from pSC101'); the fragment is not annotated as an origin feature, so it was not extracted as one.
- f1 / M13 origin (ori_f1_m13): The M13 genome record (V00604) does not annotate the f1 intergenic origin as a feature; it appears only inside a gene II /note, with no extractable coordinates.
- T7 promoter (phi10) (promoter_t7): The T7 RefSeq genome (NC_001604) annotates the phi10 promoter as a single base (regulatory 22904), not a range; the canonical 23-mer cannot be extracted without inventing endpoints around that point.
- SP6 promoter (promoter_sp6): The SP6 RefSeq genome (NC_004831) contains zero regulatory/promoter features.
- lac / lacUV5 promoter (promoter_lac): The lac operon record (J01636) annotates the CAP site and the lac operator as ranges but not the -35/-10 promoter as a single clean range, and mixes wild-type vs UV5 variation features; no unambiguous promoter span.
- tac / trc / araBAD promoters (promoter_tac_trc_arabad): tac and trc are engineered hybrid promoters with no single primary record; no fetched public-domain record annotated them, or araBAD, as a clean extractable range.
- EF-1alpha / CAG / hPGK / U6 promoters (promoter_ef1a_cag_pgk_u6): No fetched well-annotated public record exposed these as a single coordinate range with a matching note; not extracted to avoid mislabeling.
- T7 terminator (Tphi) (terminator_t7): The T7 RefSeq genome (NC_001604) annotates the Tphi terminator as a single base (regulatory 24210), not a range.
- lambda tL3 terminator (terminator_lambda_tl3): The lambda RefSeq genome (NC_001416) annotates operators but no tL3 terminator feature with extractable coordinates.
- BGH polyA (terminator_bgh_polya): No fetched well-annotated public record exposed the BGH polyadenylation signal as a single coordinate range with a matching note.
- Kozak sequence (regulatory_kozak): The Kozak consensus is a short motif, not a feature annotated at coordinates in a primary record; extracting a specific instance was out of scope and reciting the consensus is forbidden.

<!-- DNA-FEATURE-DB-SECTION:END -->
