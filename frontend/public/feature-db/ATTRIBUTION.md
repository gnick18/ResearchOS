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
