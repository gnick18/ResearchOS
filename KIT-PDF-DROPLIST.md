# Bulletproof-kit PDF drop-list (Kit Phase 3 recon, 2026-05-30)

88 templates: 1 DONE (FastStart), 7 baseline (skip), 80 PENDING. Host behavior was verified live (which vendor hosts 403 vs serve PDFs). Your shortest path:

1. Hand-download the 13 BLOCKED PDFs below (batched by vendor).
2. Make ONE policy call: for ~32 PAGE-ONLY sources (esp. the 8 NEB protocol pages), accept LINK-ONLY source_url vs require a hand-snapshot PDF. Biggest lever: link-only converts ~32 templates from "capture a PDF" to "store a URL."
3. Find 3 missing URLs (KAPA Taq KR0352, KAPA2G Robust KR0379 on rochesequencingstore/avantor; QIAGEN TopTaq handbook).
4. 32 FETCHABLE go to a future ingest sub-bot, no involvement from you.

## DROP-LIST (13 PDFs to download, by vendor) -> target slug

Bio-Rad (literature host 403s, 7):
- 10031339.pdf -> ssoadvanced-sybr-qpcr  (bio-rad.com/webroot/web/pdf/lsr/literature/10031339.pdf)
- bulletin-10031340.pdf -> ssoadvanced-probes-qpcr
- 10000068167.pdf -> itaq-sybr-qpcr
- 10014647A.pdf -> ssofast-evagreen-qpcr
- 10002298B.pdf -> biorad-iproof
- 4106202B.pdf -> biorad-itaq
- Bulletin_2423.pdf -> sds-page-coomassie

Thermo LC-MS app notes (assets host blocked; 3 PDFs cover 6 templates):
- AN-656-...-AN64832-EN.pdf -> lcms-metabolite-hilic-lc-thermo + lcms-metabolite-ms-thermo-qexactive  (assets.thermofisher.com/TFS-Assets/CMD/Application-Notes/AN-656-LC-MSn-Metabolomics-AN64832-EN.pdf)
- AN-21550-...-EN.pdf -> lcms-peptide-ms-thermo-orbitrap + lcms-peptide-rp-lc-thermo
- an-73885-...-en.pdf -> lcms-intact-protein-ms-thermo-exploris + lcms-intact-protein-rp-lc-thermo  (documents.thermofisher.com/.../an-73885-lc-ms-characterization-mabs-native-denaturing-an73885-en.pdf)
  (You likely already have these 3 from authoring the LC-MS templates.)

Thermo other (1): Qubit_dsDNA_HS_Assay_UG.pdf -> qubit-dsdna-hs-assay  (tools.thermofisher.com blocked; a documents.thermofisher.com mirror may exist)

ATCC culture guide (1 PDF, 2 templates): animal-cell-culture-guide.pdf -> cryopreservation-freezing + thaw-cryopreserved-cells  (atcc.org/-/media/resources/culture-guides/animal-cell-culture-guide.pdf, verify the media host)

## NOT-FOUND (3, need a hand-search; check rochesequencingstore.com/wp-content or digitalassets.avantorsciences.com for KAPA)
- kapa-taq (KAPA Taq KR0352), kapa2g-robust (KAPA2G Robust KR0379), qiagen-toptaq (QIAGEN TopTaq PCR Handbook 06/2010)

## POLICY DECISION (one call) -> ~32 PAGE-ONLY sources
LINK-ONLY (recommended) vs require a hand-snapshot PDF, for: the 8 NEB /protocols/ pages (neb-onetaq, neb-onetaq-master-mix, neb-phusion, neb-q5-master-mix, neb-taq, heat-shock-transformation, restriction-digest, t4-dna-ligation), 7 ATCC cell lines + mycoplasma, 4 NCBI plate assays (ic50/mtt x 96+384), 2 R&D ELISA, 2 Roche LC480, Addgene glycerol-stock, Gibco cell-counting. These have no clean bundleable vendor PDF; link-only source_url is the honest option.

## AUTO-FETCH (32 FETCHABLE, future ingest bot, no involvement)
Thermo documents host: taqman-fast-advanced-qpcr, powerup-sybr-green-qpcr, thermo-dreamtaq, thermo-platinum-ii-taq, thermo-platinum-superfi-ii, thermo-platinum-taq, total-rna-trizol, agarose-gel-electrophoresis, bca-protein-standard-curve(+384), ipsc-maintenance-essential8.
NEB manuals host: luna-universal-qpcr, luna-universal-probe-qpcr, gibson-assembly-master-mix, nebuilder-hifi-dna-assembly.
Promega: gotaq-qpcr, gotaq-probe-qpcr, promega-gotaq-g2-flexi, promega-gotaq-green-master-mix, promega-pfu.
Takara: tb-green-premix-ex-taq-ii-qpcr, premix-ex-taq-probe-qpcr, takara-ex-taq, takara-la-taq, takara-primestar-gxl, takara-primestar-hs, takara-primestar-max.
QIAGEN direct-download: quantinova-sybr-green-qpcr, quantinova-probe-qpcr, rotor-gene-sybr-green-qpcr, qiagen-taq, qiaprep-spin-miniprep (+ hotstartaq/-plus resolvable via download/ path).
Roche/KAPA distributor: kapa-hifi-hotstart, kapa2g-fast.

## URL CORRECTIONS for the ingest bot (notes cite 403 product pages; real PDFs):
- gibson-assembly-master-mix -> neb.com/en/-/media/nebus/files/manuals/manuale2611_e5510.pdf
- nebuilder-hifi-dna-assembly -> neb.com/en/-/media/nebus/files/manuals/manuale2621_e5520.pdf
- qiaprep-spin-miniprep -> qiagen.com/us/resources/download.aspx?id=22df6325-9579-4aa0-819c-788f73d81a09&lang=en
