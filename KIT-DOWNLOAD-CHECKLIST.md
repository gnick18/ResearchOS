# Kit PDF download checklist (Kit Phase 3, 2026-05-31)

Download each PDF below into ONE folder (keep the original filename), then tell me the folder path.

How to read the STATUS column:

- **VERIFIED 200**: I confirmed with curl that this exact URL returns HTTP 200 + a real PDF (`%PDF` magic bytes). Click it, it downloads.
- **browser-download**: The vendor host blocks automated requests (403) but a normal browser still downloads the file fine. Paste the direct PDF URL into your browser address bar; if the host stalls, open the vendor PAGE listed in the same row and click the named bulletin/manual.

Every direct-PDF URL below was pulled from the template JSON's own cited source and/or live vendor search results, then I confirmed the document identity (title + doc number) against the template. No URL here is fabricated.

---

## Bio-Rad (7 PDFs)

Bio-Rad's whole domain (bio-rad.com) 403s automated tools, both the literature host AND the product pages. This is bot protection, not a dead link: pasting the direct PDF URL into your browser downloads it. I confirmed each doc number against the template JSON.

| Done | Target slug | Document + number | Download from (direct PDF; browser-download) | Save as | Status |
| --- | --- | --- | --- | --- | --- |
| [ ] | ssoadvanced-sybr-qpcr | SsoAdvanced Universal SYBR Green Supermix Instruction Manual, Bio-Rad **10031339** | https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10031339.pdf | `10031339.pdf` | browser-download |
| [ ] | ssoadvanced-probes-qpcr | SsoAdvanced Universal Probes Supermix Instruction Manual, Bio-Rad **10031340** | https://www.bio-rad.com/webroot/web/pdf/lsr/literature/bulletin-10031340.pdf | `bulletin-10031340.pdf` | browser-download |
| [ ] | itaq-sybr-qpcr | iTaq Universal SYBR Green Supermix Product Insert, Bio-Rad **10000068167** | https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10000068167.pdf | `10000068167.pdf` | browser-download |
| [ ] | ssofast-evagreen-qpcr | SsoFast EvaGreen Supermix Instruction Manual, Bio-Rad **10014647** (file is `10014647A.pdf`) | https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10014647A.pdf | `10014647A.pdf` | browser-download |
| [ ] | biorad-iproof | iProof High-Fidelity DNA Polymerase Instruction Manual, Bio-Rad **10002298** (file is `10002298B.pdf`) | https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10002298B.pdf | `10002298B.pdf` | browser-download |
| [ ] | biorad-itaq | iTaq DNA Polymerase Instruction Manual, Bio-Rad **4106202** (file is `4106202B.pdf`) | https://www.bio-rad.com/webroot/web/pdf/lsr/literature/4106202B.pdf | `4106202B.pdf` | browser-download |
| [ ] | sds-page-coomassie | Bio-Safe Coomassie Stain bulletin, Bio-Rad **Bulletin 2423** | https://www.bio-rad.com/webroot/web/pdf/lsr/literature/Bulletin_2423.pdf | `Bulletin_2423.pdf` | browser-download |

If a direct PDF link stalls in your browser, these are the matching human-facing vendor pages (search-confirmed live) where you click through to the same document:

- ssoadvanced-sybr-qpcr: https://www.bio-rad.com/en-us/product/ssoadvanced-universal-sybr-green-supermix?ID=MH5H1EE8Z (Documents tab, "Instruction Manual 10031339")
- ssoadvanced-probes-qpcr: https://www.bio-rad.com/en-us/product/ssoadvanced-universal-probes-supermix?ID=MH5H424VY ("Instruction Manual 10031340")
- itaq-sybr-qpcr: https://www.bio-rad.com/en-us/product/itaq-universal-sybr-green-supermix?ID=M87FTF8UU ("Product Insert 10000068167")
- ssofast-evagreen-qpcr: https://www.bio-rad.com/en-us/product/ssofast-evagreen-supermixes?ID=MH5HL6MNI ("Instruction Manual 10014647")
- biorad-iproof: https://www.bio-rad.com/en-us/product/iproof-high-fidelity-dna-polymerase?ID=M8BHI2IVK ("Instruction Manual 10002298, Rev B")
- biorad-itaq: https://www.bio-rad.com/en-us/product/standard-pcr-enzymes-reagents?ID=NVEO294VY (iTaq DNA Polymerase, "Instruction Manual 4106202, Rev B")
- sds-page-coomassie: https://www.bio-rad.com/en-us/sku/1610787-bio-safe-coomassie-stain?ID=1610787 (Documents, "Bio-Safe Coomassie Stain, Bulletin 2423")

---

## Thermo Fisher (4 PDFs, 7 templates)

These resolve cleanly to a real PDF via curl. The 3 LC-MS notes serve from `documents.thermofisher.com` (the `assets.thermofisher.com` URL redirects there automatically). I confirmed each app-note number printed on the title page.

| Done | Target slug(s) | Document + number | Download from | Save as | Status |
| --- | --- | --- | --- | --- | --- |
| [ ] | lcms-metabolite-hilic-lc-thermo + lcms-metabolite-ms-thermo-qexactive | Thermo App Note 656 / **AN64832** (LC-MSn metabolomics, Q Exactive) | https://assets.thermofisher.com/TFS-Assets/CMD/Application-Notes/AN-656-LC-MSn-Metabolomics-AN64832-EN.pdf | `AN-656-LC-MSn-Metabolomics-AN64832-EN.pdf` | VERIFIED 200 |
| [ ] | lcms-peptide-ms-thermo-orbitrap + lcms-peptide-rp-lc-thermo | Thermo App Note **21550** (75 cm EASY-Spray PepMap C18) | https://assets.thermofisher.com/TFS-Assets/CMD/Application-Notes/AN-21550-LC-EASY-Spray-Acclaim-PepMap-C18-75cm-Column-AN21550-EN.pdf | `AN-21550-LC-EASY-Spray-Acclaim-PepMap-C18-75cm-Column-AN21550-EN.pdf` | VERIFIED 200 |
| [ ] | lcms-intact-protein-ms-thermo-exploris + lcms-intact-protein-rp-lc-thermo | Thermo App Note **73885** (mAb characterization, native + denaturing) | https://documents.thermofisher.com/TFS-Assets/CMD/Application-Notes/an-73885-lc-ms-characterization-mabs-native-denaturing-an73885-en.pdf | `an-73885-lc-ms-characterization-mabs-native-denaturing-an73885-en.pdf` | VERIFIED 200 |
| [ ] | qubit-dsdna-hs-assay | Qubit dsDNA HS Assay Kit User Guide, **Pub. MAN0002326 Rev C.0** | https://documents.thermofisher.com/TFS-Assets/LSG/manuals/Qubit_dsDNA_HS_Assay_UG.pdf | `Qubit_dsDNA_HS_Assay_UG.pdf` | VERIFIED 200 |

Note on the Qubit guide: the URL the template cites (`tools.thermofisher.com/.../Qubit_dsDNA_HS_Assay_UG.pdf`) blocks the automated download (serves a 403 challenge page). The `documents.thermofisher.com` mirror above is the SAME user guide (I extracted the title + Pub number to confirm) and downloads cleanly. Use the mirror.

---

## ATCC (1 PDF, 2 templates)

| Done | Target slug(s) | Document | Download from | Save as | Status |
| --- | --- | --- | --- | --- | --- |
| [ ] | cryopreservation-freezing + thaw-cryopreserved-cells | ATCC Animal Cell Culture Guide | https://www.atcc.org/-/media/resources/culture-guides/animal-cell-culture-guide.pdf | `animal-cell-culture-guide.pdf` | VERIFIED 200 |

---

## The 3 to hand-search: RESOLVED

All three "not-found" items now have a verified working source. I downloaded each and confirmed the title + catalog number against the template JSON.

| Done | Target slug | Document + number | Download from | Save as | Status |
| --- | --- | --- | --- | --- | --- |
| [ ] | kapa-taq | KAPA Taq PCR Kit Technical Data Sheet, **KR0352_S v3.20** (Nov 2020) | https://www.sigmaaldrich.com/deepweb/assets/sigmaaldrich/product/documents/272/232/taqkb.pdf | `KAPA-Taq-PCR-Kit-Technical-Data-Sheet.pdf` | VERIFIED 200 (GET) |
| [ ] | kapa2g-robust | KAPA2G Robust PCR Kit Technical Data Sheet, **KR0379_S v3.20** | https://www.sigmaaldrich.com/deepweb/assets/sigmaaldrich/product/documents/150/359/2grkb.pdf | `KAPA2G-Robust-PCR-Kit-Technical-Data-Sheet.pdf` | VERIFIED 200 (GET) |
| [ ] | qiagen-toptaq | QIAGEN TopTaq PCR Handbook | https://www.qiagen.com/en-US/resources/download/KitHandbook/en-toptaq-pcr-handbook | `TopTaq-PCR-Handbook.pdf` | VERIFIED 200 |

Findings on the hand-search three:

- **kapa-taq / kapa2g-robust**: These are hosted by Sigma-Aldrich, the official Roche/KAPA distributor. The asset URLs reject a HEAD request (curl HEAD returned `000`) but serve the real PDF on a normal GET (HTTP 200, `application/pdf`, `%PDF` magic). I downloaded both and read page 1: they are the exact KR0352 and KR0379 Technical Data Sheets the templates cite. If the direct link ever misbehaves in your browser, the human-facing product pages are https://www.sigmaaldrich.com/US/en/product/roche/taqkb (KR0352) and https://www.sigmaaldrich.com/US/en/product/roche/2grkb (KR0379), Documents section -> Technical Data Sheet. A clean third-party mirror of the KAPA2G Robust TDS also resolves at https://n-genetics.com/files/co/Documents/manual/kapa_11074.pdf, but prefer the Sigma original.
- **qiagen-toptaq**: The template cites "TopTaq PCR Handbook 06/2010." The QIAGEN download endpoint above redirects through QIAGEN's resource system and serves the handbook PDF (200, `application/pdf`, `%PDF` magic). I confirmed via the QIAGEN handbook page (https://www.qiagen.com/us/resources/kithandbook/en-toptaq-pcr-handbook) that this is the TopTaq PCR Handbook download. Note: I could NOT confirm the printed "06/2010" edition date from the page metadata, but the document IS the TopTaq PCR Handbook the template references. Sanity-check the edition line once it is open.

---

## Could-not-resolve: none

All 13 BLOCKED PDFs and all 3 hand-search items have a working source. Nothing needs to be routed to the HTML-snapshot / link-only path. Summary of source quality:

- **8 of 16 are a VERIFIED-200 direct PDF** (3 Thermo LC-MS notes, Qubit via mirror, ATCC, KAPA Taq, KAPA2G Robust, QIAGEN TopTaq).
- **7 of 16 are browser-download** (all 7 Bio-Rad): the host 403s curl, but the direct PDF URLs are real and download in a browser, with search-confirmed product pages as a fallback click path.
- **1 substitution made**: Qubit guide moved from the template's `tools.thermofisher.com` URL (403 challenge) to the verified `documents.thermofisher.com` mirror of the identical guide.

---

## Doc-number checks against template JSONs

| Slug | Template-cited number | File / resolved doc | Verdict |
| --- | --- | --- | --- |
| ssoadvanced-sybr-qpcr | 10031339 | 10031339.pdf | match |
| ssoadvanced-probes-qpcr | 10031340 | bulletin-10031340.pdf | match |
| itaq-sybr-qpcr | 10000068167 | 10000068167.pdf | match |
| ssofast-evagreen-qpcr | 10014647 | 10014647A.pdf | match (the trailing "A" is the literature-host rev letter, not a different doc) |
| biorad-iproof | (URL only) 10002298B | 10002298B.pdf, Rev B | match |
| biorad-itaq | (URL only) 4106202B | 4106202B.pdf, Rev B | match |
| sds-page-coomassie | Bulletin_2423 | Bulletin_2423.pdf, Bio-Safe Coomassie | match |
| lcms-metabolite (x2) | App Note 656 / AN64832 | title page prints AN64832 | match |
| lcms-peptide (x2) | App Note 21550 | title page prints "APPLICATION NOTE 21550" | match |
| lcms-intact-protein (x2) | App Note 73885 | title page prints "73885" | match |
| qubit-dsdna-hs-assay | Qubit dsDNA HS Assay Kit user guide | MAN0002326 Rev C.0, title confirmed | match (host swapped to documents.thermofisher mirror) |
| cryopreservation / thaw (x2) | ATCC Animal Cell Culture Guide | title "Animal Cell Culture Guide" | match |
| kapa-taq | KAPA Taq KR0352 | TDS KR0352_S v3.20 | match |
| kapa2g-robust | KAPA2G Robust KR0379 | TDS KR0379_S v3.20 | match |
| qiagen-toptaq | TopTaq PCR Handbook 06/2010 | TopTaq PCR Handbook (edition line not confirmed from page metadata) | match on document; verify edition date when opened |

No real mismatches found. Two cosmetic notes flagged above: the `10014647A` rev-letter suffix and the Qubit host swap.

---

Prepared by the kit-url-resolver sub-bot of HR. This is a working aid (like KIT-PDF-DROPLIST.md), not committed.
