# Method catalog recipe review (2026-05-30)

Total: 88 templates across 10 categories. Check each vendor recipe against its cited source before pushing to origin.

## Analytical chemistry (1)

| Title | type | source |
|---|---|---|
| Reverse-phase peptide LC gradient | lc_gradient | C18 5-to-95% acetonitrile gradient with 0.1% formic acid for LC-MS peptide separation. |

## Cell biology (2)

| Title | type | source |
|---|---|---|
| 96-well dose-response layout | plate | Pre-labeled 96-well plate: column 1 blanks, column 2 vehicle controls, columns 3-12 samples. |
| HEK293 passaging schedule | cell_culture | Adherent HEK293 maintenance in DMEM + 10% FBS with a 1:6 split every 3 days. |

## Cell culture (11)

| Title | type | source |
|---|---|---|
| A549 maintenance (ATCC) | cell_culture | Adherent A549 (ATCC CCL-185) in F-12K + 10% FBS, split 1:3 to 1:8, feed 2 to 3x per week. Source: ATCC https://www.atcc.org/products/ccl-185 |
| CHO-K1 maintenance (ATCC) | cell_culture | Adherent CHO-K1 (ATCC CCL-61) in F-12K + 10% FBS, split 1:4 to 1:8. Source: ATCC https://www.atcc.org/products/ccl-61 |
| Cell counting + viability (trypan blue) | cell_culture | Universal routine: 1:1 with 0.4% trypan blue, hemocytometer count, viability %. Source: Gibco Cell Culture Basics. |
| Cryopreservation / freezing | cell_culture | Universal routine: complete medium + 5 to 10% DMSO, cool about 1 C/min, store in LN2 vapor. Sources: ATCC + Gibco. |
| HEK293 maintenance (ATCC) | cell_culture | Adherent HEK293 (ATCC CRL-1573) in EMEM + 10% FBS, split 1:6 to 1:10. Source: ATCC https://www.atcc.org/products/crl-1573 |
| HeLa maintenance (ATCC) | cell_culture | Adherent HeLa (ATCC CCL-2) in EMEM + 10% FBS, split 1:2 to 1:6. Source: ATCC https://www.atcc.org/products/ccl-2 |
| Human iPSC maintenance (Gibco Essential 8) | cell_culture | Feeder-free human iPSC/PSC in Gibco Essential 8 on vitronectin, daily feed, EDTA clump-passage every 4 to 5 days. Source: Gibco MAN0007035. |
| Jurkat maintenance (ATCC) | cell_culture | Suspension Jurkat E6-1 (ATCC TIB-152) in RPMI-1640 + 10% FBS; reseed 2 to 4 x 10^5 cells/mL, do not exceed 3 x 10^6. Source: ATCC https://www.atcc.org/products/ |
| Mycoplasma testing | cell_culture | Universal QC routine: antibiotic-free culture to 50 to 70%, then PCR / Hoechst / luminescence test. Source: ATCC kit 30-1012K. |
| NIH/3T3 maintenance (ATCC) | cell_culture | Adherent NIH/3T3 (ATCC CRL-1658) in DMEM + 10% CALF bovine serum (not FBS); subculture at 80% confluence or less. Source: ATCC https://www.atcc.org/products/crl |
| Thaw cryopreserved cells | cell_culture | Universal routine: rapid 37 C thaw, dilute into prewarmed medium, recover. Sources: Gibco + ATCC. |

## General (1)

| Title | type | source |
|---|---|---|
| General protocol skeleton | markdown | Blank lab-protocol scaffold: materials, steps, notes, and safety sections ready to fill in. |

## Kits (4)

| Title | type | source |
|---|---|---|
| Gibson Assembly Master Mix | markdown | NEB Gibson Assembly Master Mix (#E2611): kit components plus the 20 uL 50 C isothermal reaction for joining 2-6 overlapping fragments. |
| NEBuilder HiFi DNA Assembly | markdown | NEB NEBuilder HiFi DNA Assembly Master Mix (#E2621): kit components plus the 20 uL isothermal assembly reaction for joining 2-6 overlapping fragments. |
| QIAprep Spin Miniprep (plasmid DNA) | markdown | QIAGEN QIAprep Spin Miniprep Kit (#27104): kit buffers and spin columns plus the microcentrifuge protocol for purifying plasmid DNA from E. coli. |
| Qubit dsDNA HS assay | markdown | Thermo Fisher Qubit dsDNA HS Assay Kit (#Q32851): kit components plus the fluorometric working-solution protocol for quantifying double-stranded DNA. |

## LC-MS (6)

| Title | type | source |
|---|---|---|
| Thermo EASY-nLC + Q Exactive: peptide LC-MS/MS (LC gradient) | lc_gradient | Thermo nano-LC reversed-phase gradient for bottom-up peptide LC-MS/MS on EASY-Spray PepMap C18 at 200 nL/min (Thermo app note 21550). |
| Thermo EASY-nLC + Q Exactive: peptide LC-MS/MS (MS setup) | mass_spec | Thermo Q Exactive data-dependent MS/MS for bottom-up peptides: nanoESI positive, MS1 R 60k / MS2 R 15k, 350 to 1200 m/z (Thermo app note 21550). |
| Thermo UltiMate + Q Exactive: HILIC metabolomics LC-MS (LC gradient) | lc_gradient | Thermo HILIC metabolomics gradient (0 to 100% B) on Atlantis HILIC, 300 uL/min, 10 mM ammonium formate eluents (Thermo app note 656). |
| Thermo UltiMate + Q Exactive: HILIC metabolomics LC-MS (MS setup) | mass_spec | Thermo Q Exactive metabolomics setup: HESI positive, R 70k, 80 to 900 m/z, Full MS + ddMS2 (Thermo app note 656). |
| Thermo Vanquish + Orbitrap Exploris: intact-protein LC-MS (LC gradient) | lc_gradient | Thermo reversed-phase gradient (25 to 80% B) for denaturing intact-protein / intact-mass LC-MS on MAbPac RP at 80 C (Thermo app note 73885). |
| Thermo Vanquish + Orbitrap Exploris: intact-protein LC-MS (MS setup) | mass_spec | Thermo Orbitrap Exploris (BioPharma) Full MS intact-protein setup: HESI positive, R 30k, 1800 to 4000 m/z, in-source CID 110 V (Thermo app note 73885). |

## Molecular biology (36)

| Title | type | source |
|---|---|---|
| Agarose gel electrophoresis (DNA) | markdown | Cast, load, run, and image a DNA agarose gel, with the Thermo Fisher agarose-vs-size table and Addgene bench steps. |
| Bacterial heat-shock transformation (NEB) | markdown | Chemical heat-shock transformation of competent E. coli (42 C / 30 sec) per the NEB high-efficiency protocol, with an electroporation note. |
| Bio-Rad iProof High-Fidelity PCR | pcr | https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10002298B.pdf |
| Bio-Rad iTaq PCR | pcr | https://www.bio-rad.com/webroot/web/pdf/lsr/literature/4106202B.pdf |
| Colony PCR screen | pcr | Taq-based 20 uL colony-screen reaction with an extended initial denaturation to lyse cells. |
| Glycerol stock preparation + storage | markdown | Make and store a long-term bacterial glycerol stock at -80 C, following the Addgene protocol. |
| Invitrogen Platinum II Taq Hot-Start PCR | pcr | https://documents.thermofisher.com/TFS-Assets/BID/manuals/MAN0017534_Platinum_II_Taq_HS_DNA_Pol_UG.pdf |
| Invitrogen Platinum SuperFi II PCR | pcr | https://documents.thermofisher.com/TFS-Assets/LSG/manuals/MAN0018859_Platinum_SuperFi_II_DNA_Pol_UG.pdf |
| Invitrogen Platinum Taq PCR | pcr | https://documents.thermofisher.com/TFS-Assets/LSG/manuals/100004289_PlatinumTaqDNApolymerase_man.pdf |
| KAPA HiFi HotStart PCR | pcr | https://rochesequencingstore.com/wp-content/uploads/2023/02/KAPA-HiFi-HotStart-ReadyMix-PCR-Kit-Technical-Data-Sheet_v14-22.pdf |
| KAPA Taq PCR | pcr | Roche/KAPA KAPA Taq PCR Kit Technical Data Sheet (KR0352). |
| KAPA2G Fast PCR | pcr | Roche / KAPA Biosystems KAPA2G Fast ReadyMix PCR Kit (cat |
| KAPA2G Robust PCR | pcr | Roche/KAPA KAPA2G Robust PCR Kit Technical Data Sheet (KR0379). |
| Ligation with T4 DNA ligase (NEB) | markdown | T4 DNA ligase reaction setup and incubation (sticky vs blunt) per the NEB M0202 protocol. |
| NEB OneTaq 2X Master Mix PCR | pcr | https://www.neb.com/en-us/protocols/protocol-for-onetaq-2x-master-mix-with-standard-buffer-m0482 |
| NEB OneTaq PCR | pcr | https://www.neb.com/en-us/protocols/onetaqdnapolymerasem0480 |
| NEB Phusion High-Fidelity PCR | pcr | https://www.neb.com/en-us/protocols/pcr-protocol-m0530 |
| NEB Q5 High-Fidelity 2X Master Mix PCR | pcr | https://www.neb.com/en-us/protocols/protocol-for-q5-high-fidelity-2x-master-mix-m0492 |
| NEB Taq DNA Polymerase PCR | pcr | https://www.neb.com/en-us/protocols/taq-dna-polymerase-with-standard-taq-buffer-m0273 |
| Promega GoTaq G2 Flexi PCR | pcr | https://www.promega.com/-/media/files/resources/protocols/product-information-sheets/g/gotaq-g2-flexi-dna-polymerase-protocol.pdf |
| Promega GoTaq Green Master Mix PCR | pcr | https://www.promega.com/-/media/files/resources/protocols/product-information-sheets/g/gotaq-green-master-mix-protocol.pdf |
| Promega Pfu High-Fidelity PCR | pcr | https://www.promega.com/-/media/files/resources/protocols/product-information-sheets/g/pfu-dna-polymerase-protocol.pdf |
| Q5 high-fidelity PCR setup | pcr | 25 uL Q5 reaction recipe plus a 3-step cycling program with a 60 C anneal. |
| QIAGEN HotStarTaq PCR | pcr | QIAGEN HotStarTaq DNA Polymerase Quick-Start Protocol and HotStarTaq PCR Handbook (https://www.qiagen.com/HB-0452) |
| QIAGEN HotStarTaq Plus Master Mix PCR | pcr | QIAGEN HotStarTaq Plus PCR Master Mix Kit Quick-Start Protocol and HotStarTaq Plus PCR Handbook (https://www.qiagen.com/HB-0450) |
| QIAGEN Taq PCR | pcr | QIAGEN Taq PCR Handbook (https://www.qiagen.com/en-US/resources/download/KitHandbook/en-taq-pcr-handbook) |
| QIAGEN TopTaq PCR | pcr | QIAGEN TopTaq PCR Handbook 06/2010 (reaction Table 1 + cycling Table 2, read directly from the handbook PDF). |
| Restriction enzyme digest (single + double) | markdown | Single and double restriction digests in 50 uL, with NEB unit and glycerol rules and Double Digest Finder buffer selection. |
| Roche FastStart Taq PCR | pcr | Roche / Sigma-Aldrich FastStart Taq DNA Polymerase pack insert (ftaq-ro.pdf), transcribed directly from the PDF. |
| Takara Ex Taq PCR | pcr | https://www.takarabio.com/documents/User%20Manual/RR001A/RR001A_DS.v1902Da.pdf |
| Takara LA Taq Long PCR | pcr | https://www.takarabio.com/documents/User%20Manual/RR002M/RR002M_DS.v1312Da.pdf |
| Takara PrimeSTAR GXL PCR | pcr | https://www.takarabio.com/documents/User%20Manual/R050A/R050A_e.v1906Da-a_117055.pdf |
| Takara PrimeSTAR HS PCR | pcr | https://www.takarabio.com/documents/User%20Manual/R010A_e.v1905Da.pdf |
| Takara PrimeSTAR Max PCR | pcr | https://www.takarabio.com/documents/User%20Manual/R045Q/R045Q_e.v1108Da.pdf |
| Thermo DreamTaq Green Master Mix PCR | pcr | https://documents.thermofisher.com/TFS-Assets/LSG/manuals/MAN0012704_DreamTaq_Green_PCR_MasterMix_K1081_UG.pdf |
| Total RNA extraction (TRIzol) | markdown | Single-step TRIzol total RNA extraction with chloroform phase separation, per the Thermo Fisher TRIzol Reagent user guide. |

## Plate layouts (8)

| Title | type | source |
|---|---|---|
| 8-point IC50 dose-response (96-well) | plate | Biochemical / enzyme-inhibition IC50 layout: background blank, vehicle (0% inhibition anchor), reference inhibitor (100% inhibition anchor), and an 8-point test |
| BCA protein standard curve (384-well) | plate | 384-well Thermo Pierce BCA layout: the 9-point BSA standard set (2000-0 ug/mL, vials A-I) in 6 replicates across the top rows, unknown protein samples below. Al |
| BCA protein standard curve (96-well) | plate | Thermo Pierce BCA microplate layout: the 9-point BSA standard set (2000-0 ug/mL, vials A-I) in triplicate across the top rows, unknown protein samples below. Al |
| IC50 dose-response (384-well) | plate | 384-well biochemical / enzyme-inhibition IC50 layout: background blank, vehicle (0% inhibition anchor), reference inhibitor (100% inhibition anchor), and a 20-p |
| MTT / CellTiter cell-viability plate (384-well) | plate | 384-well cell-viability dose-response layout (MTT / MTS / CellTiter): no-cell blanks, untreated vehicle (100% viability), max-kill positive control (0% viabilit |
| MTT / CellTiter cell-viability plate (96-well) | plate | Cell-viability dose-response layout (MTT / MTS / CellTiter): no-cell blanks, untreated vehicle (100% viability), max-kill positive control (0% viability), and a |
| Sandwich ELISA plate map (384-well) | plate | 384-well sandwich ELISA layout scaled from the R&D Systems DuoSet protocol: a 7-point standard curve in quadruplicate (columns 1-4), a zero standard, and the re |
| Sandwich ELISA plate map (96-well) | plate | Sandwich ELISA layout per the R&D Systems DuoSet protocol: 7-point standard curve in duplicate (columns 1-2), samples in duplicate (columns 3-6), remaining well |

## Protein biochemistry (2)

| Title | type | source |
|---|---|---|
| SDS-PAGE protein gel + Coomassie stain | markdown | Run an SDS-PAGE protein gel and Coomassie stain it, following Bio-Rad Mini-PROTEAN and Bio-Safe Coomassie protocols. |
| Western blot (SDS-PAGE + transfer) | markdown | SDS-PAGE separation, wet transfer, blocking, and ECL detection steps as editable markdown. |

## qPCR (17)

| Title | type | source |
|---|---|---|
| GoTaq Probe qPCR (Promega) | pcr | Promega GoTaq Probe qPCR Master Mix Technical Manual TM378, https://www.promega.com/-/media/files/resources/protocols/technical-manuals/101/gotaq-probe-qpcr-mas |
| GoTaq qPCR (Promega) | pcr | Promega GoTaq qPCR Master Mix Technical Manual TM318, https://www.promega.com/-/media/files/resources/protocols/technical-manuals/101/gotaq-qpcr-master-mix-prot |
| LightCycler 480 Probes qPCR | pcr | Roche LightCycler 480 Probes Master pack insert, https://lifescience.roche.com/global/en/products/others/lightcycler-480-probes-master-358111.html |
| LightCycler 480 SYBR Green I qPCR | pcr | Roche LightCycler 480 SYBR Green I Master pack insert (Cat |
| Luna Universal Probe qPCR (NEB) | pcr | NEB Luna Universal Probe qPCR Master Mix manual (M3004), https://www.neb.com/en/-/media/nebus/files/manuals/manualm3004.pdf |
| Luna Universal qPCR (NEB) | pcr | NEB Luna Universal qPCR Master Mix manual (M3003), https://www.neb.com/en/-/media/nebus/files/manuals/manualm3003.pdf |
| PowerUp SYBR Green qPCR | pcr | PowerUp SYBR Green Master Mix Quick Reference (MAN0028468), https://documents.thermofisher.com/TFS-Assets/LSG/manuals/MAN0028468-PowerUpSYBRGreenMM-QR.pdf |
| QuantiNova Probe qPCR | pcr | QIAGEN QuantiNova Probe PCR Kit Quick-Start Protocol (HB-1581), https://www.qiagen.com/us/resources/download/Protocols/quantinova-probe-pcr-quick-start-protocol |
| QuantiNova SYBR Green qPCR | pcr | QIAGEN QuantiNova SYBR Green PCR Kit Handbook (04/2024), https://www.qiagen.com/us/resources/download/KitHandbook/quantinova-sybr-green-pcr-handbook |
| Rotor-Gene SYBR Green qPCR | pcr | QIAGEN Rotor-Gene SYBR Green PCR Kit Handbook (01/2014), https://www.qiagen.com/us/resources/download/KitHandbook/en-rotor-gene-sybr-green-handbook |
| SsoAdvanced Universal Probes qPCR | pcr | SsoAdvanced Universal Probes Supermix instruction manual (Bio-Rad 10031340), https://www.bio-rad.com/webroot/web/pdf/lsr/literature/bulletin-10031340.pdf |
| SsoAdvanced Universal SYBR Green qPCR | pcr | SsoAdvanced Universal SYBR Green Supermix instruction manual (Bio-Rad 10031339), https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10031339.pdf |
| SsoFast EvaGreen qPCR | pcr | SsoFast EvaGreen Supermix instruction manual (Bio-Rad 10014647), https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10014647A.pdf |
| TB Green Premix Ex Taq II qPCR | pcr | Takara TB Green Premix Ex Taq II (RR820A) product manual, https://www.takarabio.com/documents/User%20Manual/RR820A/RR820A_UM.pdf |
| Takara Premix Ex Taq Probe qPCR | pcr | Takara Premix Ex Taq (Probe qPCR) (RR390A) product manual, https://www.takarabio.com/documents/User%20Manual/RR390A/RR390A_UM.pdf |
| TaqMan Fast Advanced qPCR | pcr | Applied Biosystems TaqMan Fast Advanced Master Mix User Guide (MAN0025706), https://documents.thermofisher.com/TFS-Assets/LSG/manuals/MAN0025706_TaqManFastAdvMM |
| iTaq Universal SYBR Green qPCR | pcr | iTaq Universal SYBR Green Supermix product insert (Bio-Rad 10000068167), https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10000068167.pdf |
