# Protein Feature Database, Attribution and Licensing

This dataset (frontend/public/feature-db/protein-features.json) powers an offline common-features detector. It was assembled by scripts/build-feature-db.mjs, which fetches real sequences from public APIs and combines them with a small set of cited standard epitope-tag constants. Re-run the script to regenerate or update the data.

Total entries: 45.

- epitope_tag: 10
- fluorescent_protein: 21
- fusion_tag: 3
- resistance_marker: 11

## Sources and licenses

### FPbase (fluorescent proteins)

Fluorescent protein sequences were fetched from the FPbase API (https://www.fpbase.org/api/proteins/). FPbase states that its sequence data is copyright-free; attribution is requested. Please cite FPbase: Lambert TJ (2019), FPbase: a community-editable fluorescent protein database, Nature Methods 16, 277-278. Each entry stores its exact FPbase API request URL and the FPbase UUID accession.

### UniProt (resistance markers and large fusion tags)

Resistance markers and large fusion tags (MBP, GST, SUMO) were fetched from the UniProt REST API (https://rest.uniprot.org/uniprotkb/search), restricted to reviewed Swiss-Prot entries. UniProt data is distributed under the Creative Commons Attribution 4.0 International (CC BY 4.0) license. Please cite: The UniProt Consortium, UniProt: the Universal Protein Knowledgebase, Nucleic Acids Research. Each entry stores its UniProt accession and canonical entry URL.

UniProt accessions used: AmpR/bla (P62593), CmR/cat (P00484), HygR/hph (P00557), KanR/NeoR aph(3')-II nptII (P00552), the divergent NeoR/KanR aph(3')-I aphA1 Tn903 variant (P00551), PuroR/pac (P13249), SpecR/aadA (P0AG06), TmpR/dhfr (P95524), BSD blasticidin-S deaminase (P0C2P0), GentR aac(3)/aacC1 (P23181), ZeoR/BleoR Sh ble (P17493), MBP/MalE (UniProt MalE record), GST (UniProt S. japonicum record), SUMO1 (P63165).

### Standard epitope and purification tags

Short epitope and purification tags (His6, His8, FLAG, 3xFLAG, HA, c-Myc, V5, Strep-II, T7-tag, AviTag) are standard published peptide sequences. They are definitional constants included verbatim from the literature and common molecular-biology references; they are not fetched. They are treated as public standard sequences. See the UniProt tag reference (https://www.uniprot.org/help/tags) and the original publications for each tag.

## No-fabrication guarantee

Every sequence in this dataset comes from either a live HTTP fetch against the named APIs (FPbase, UniProt), with the exact source URL and accession recorded on each entry, or from one of the cited canonical epitope-tag constants. No sequence was invented, completed, or recalled from memory. Every fetched sequence is validated against the amino-acid alphabet and a plausible per-category length band before inclusion.

## Scope and follow-up

This MVP covers PROTEIN features only. DNA elements (replication origins, promoters, multiple cloning sites, terminators) are intentionally excluded and require a separate DNA-reference curation pass with their own licensing review. That DNA pass is a planned follow-up.

<!-- DNA-FEATURE-DB-SECTION:START -->

# DNA Feature Database, Attribution and Licensing

This dataset (frontend/public/feature-db/dna-features.json) powers the DNA path of the offline common-features detector. It was assembled by scripts/build-dna-feature-db.mjs, which fetches real GenBank records from NCBI E-utilities and extracts each element by its annotated feature coordinates within that record. Re-run the script to regenerate or update the data.

Total DNA entries: 30.

- origin: 7
- promoter: 12
- regulatory: 8
- terminator: 3

## Source and licensing (NCBI GenBank)

All DNA element sequences were extracted from public GenBank records fetched from the NCBI E-utilities efetch endpoint (https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi, db=nuccore, rettype=gb). NCBI/GenBank places no copyright restrictions on the sequence data itself; the sequence facts are freely usable and redistributable. See the NCBI policies page (https://www.ncbi.nlm.nih.gov/home/about/policies/). Each entry stores the source accession, the exact 1-based feature coordinates used for extraction, the matched feature /note, and the efetch source URL, so every extraction is independently auditable. Please cite the underlying GenBank accessions when reusing these sequences.

GenBank accessions used: J02400 (SV40 genome: SV40 core and auxiliary origins, late polyA hexamer), J01749 (pBR322: Shine-Dalgarno), X02981 (phage T3: T3 promoter), PZ020853 (CMV promoter and enhancer), PX994934 (T7 promoter, lac promoter, ColE1/pUC origin, lac operator), PP098726 (pET28a: T7-promoter cross-confirmation), LR588434 (SP6 promoter), MT321292 (tac promoter), KX682239 (trc promoter), PZ005984 (p15A origin), PV807101 (pSC101 origin), PV231317 (rrnB T1 terminator), OZ375372 (T7 terminator), OQ295986 (lambda tL3 terminator). v3 mammalian/lentiviral additions: MZ648044 (EF-1alpha core promoter, SV40 late polyA full region, WPRE), LC897330 (BGH polyA), MH325103 (PGK promoter), MN811116 (U6 promoter), DQ465352 (H1 promoter), PP539716 (SV40 enhancer/early promoter, f1 phage origin, EMCV IRES2), U75327 (RK2 oriV).

## Extraction method (verified, not recited)

For each target element the build script pins a specific, well-annotated GenBank accession and a predicate that selects exactly one feature in that record by feature type plus /note or /regulatory_class. The stored sequence is the substring of the fetched record at that feature's coordinates (method A); complement() locations are reverse-complemented; locations with fuzzy bounds (< or >) are refused. Some entries additionally carry a cross-confirmation (the matchedInAccession field): the extracted sequence was located verbatim in a second fetched record that is expected to contain it (for example, the T7 promoter extracted from a SnapGene-style synthetic construct is cross-confirmed present in the canonical pET28a vector record PP098726.1). This cross-confirmation is method-B style provenance and never a source of sequence data; if a cross-confirmation fails, the method-A extraction is kept and the cross-confirmation is simply dropped. The script independently re-fetches and re-extracts a spot-check sample (and re-checks any cross-confirmation) and aborts if any re-extraction does not match the stored sequence.

## No-fabrication guarantee

Every sequence in dna-features.json is the substring of a GenBank record fetched live from NCBI, taken at the coordinates of a matched annotated feature. No DNA sequence was written, completed, or recalled from memory. Every sequence is validated against the DNA alphabet (A, C, G, T, N) and a plausible per-category length band before inclusion. Targets that could not be cleanly sourced from a well-annotated record were omitted, not guessed.

## Omitted, covered-by-family, and skipped targets

The following brief targets are NOT shipped as their own entry. Each is one of: covered by an equivalent shipped entry (the same biological element under a family name), out of scope for this bacterial-cloning pass (deferred to a later mammalian-expression pass), or skipped as too short for exact-match sequence detection. None was fabricated; where a sequence was unavailable from a clean annotated range it was omitted rather than guessed. They are recorded here so a future curation pass can revisit them.

- pBR322 / pMB1 origin (ori_pbr322): COVERED, not omitted. pBR322, pMB1, ColE1 and pUC share one and the same replication origin region; it is shipped as ori_cole1_puc (PX994934.1 rep_origin 8031..8619, /note 'high-copy-number ColE1/pMB1/pBR322/pUC origin of replication'). Storing a separate pBR322 sequence would duplicate the same element. The primary pBR322 record J01749 annotates its origin only as a single base (rep_origin 2535), so no distinct range exists there anyway.
- f1 / M13 origin (ori_f1_m13): COVERED in v3, not omitted. Shipped as ori_f1_phage (PP539716.1 rep_origin complement(3427..3882), /note 'f1 bacteriophage origin of replication'). The v2 note below was the v2-era status; the f1/M13 phage origin is now extracted by coordinates from a SnapGene-style record that annotates it as a clean range.
- araBAD / pBAD promoter (promoter_arabad): Not in the v2 brief target list and not pursued here. Records that annotate a pBAD/araBAD promoter range exist (e.g. PV588693.1), so it is a clean future addition, not a fabrication risk.
- EF-1alpha / PGK / U6 / H1 / SV40 promoters (promoter_ef1a_pgk_u6_h1_sv40): COVERED in v3, not omitted. Shipped as promoter_ef1a_core (MZ648044.1), promoter_pgk (MH325103.1), promoter_u6 (MN811116.1), promoter_h1 (DQ465352.1) and promoter_sv40_early (PP539716.1), each extracted by coordinates from a record that annotates it as a clean range. CAG is NOT shipped: it is a composite (CMV enhancer + chicken beta-actin promoter + rabbit beta-globin intron) whose annotation varies by record, so it was not extracted to avoid mislabeling a partial span; deferred.
- minimal promoter (minP / minimal CMV / TATA minimal promoter) (promoter_minp): OMITTED, not guessed. No surveyed synthetic-construct record annotated a feature whose /note was a clean, unambiguous 'minimal promoter' / 'minP' / 'minimal CMV promoter' range during this pass. minP is a very short synthetic element with many near-identical variants, so a wrong pick would mislabel. Deferred until a record cleanly annotates a specific minP variant as a coordinate range.
- yeast 2-micron origin / CEN / ARS (ori_yeast_2micron_cen_ars): OMITTED, not guessed. Surveyed S. cerevisiae shuttle-vector searches did not surface a record annotating the 2-micron origin, a CEN element, or an ARS as a clean extractable coordinate range during this pass. Not extracted to avoid guessing a span; deferred to a dedicated yeast-vector curation pass.
- SV40-neo DNA coding variant (divergent NeoR) (marker_sv40_neo_dna_variant): Handled in the PROTEIN database, not here. The divergent NeoR/KanR variant requested by the validation pass is shipped as a protein entry (marker_neor_aph3i, aph(3')-I / aphA1, UniProt P00551) in protein-features.json, alongside the existing aph(3')-II. DNA-level neo coding sequences are detected via the protein detector; no separate DNA entry is added.
- Shine-Dalgarno (as a detectable motif) (regulatory_shine_dalgarno_skip): SKIP per brief: too short for sequence detection (a 5-6 bp motif needs a motif-scan, not exact-match detection). Note: a single grounded SD instance is already stored (regulatory_shine_dalgarno, extracted from J01749) for reference, but it is not a reliable detection target on its own.
- Kozak sequence (regulatory_kozak): SKIP per brief: too short for sequence detection and a mammalian motif. The Kozak consensus is a short motif, not a feature annotated at coordinates in a primary record; reciting the consensus from memory is forbidden.
- bare polyA hexamer (AATAAA) as a detectable motif (regulatory_polya_hexamer_skip): SKIP per brief: a 6 bp hexamer is too short for exact-match detection (needs a motif-scan). Note: one grounded instance (regulatory_sv40_polya, extracted from J02400) is stored for reference, not as a standalone detection target.

<!-- DNA-FEATURE-DB-SECTION:END -->
