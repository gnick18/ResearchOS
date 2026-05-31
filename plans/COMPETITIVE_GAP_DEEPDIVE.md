# Competitive Gap Deep-Dive: Field-Level Structured Types + Template Backlog

Author: gap-deepdive sub-bot of HR
Date: 2026-05-31
Scope: turns the NON-inventory recommendations in `plans/COMPETITIVE_GAP_ANALYSIS.md` from "we should add X" into "here is exactly what X contains." Inventory / freezer / biological-registry design is OUT of scope here (a separate inventory bot owns that); this doc covers structured method TYPES, the template BACKLOG, broader competitor verification, and a refined first wave for those two areas only.

This is research plus a build-ready spec. It does not change app code. Anything I could not directly confirm is marked "unverified."

---

## How ResearchOS structured types are built (the pattern I am modeling against)

Confirmed from `frontend/src/lib/types.ts`, `frontend/src/lib/methods/method-type-registry.ts`, and `frontend/src/lib/methods/method-catalog.ts`. Every structured method type is four pieces:

1. **A discriminator** added to the `Method.method_type` union (`types.ts` ~L865) AND to `MethodTypeId` in `method-type-registry.ts` (the two "widen in lockstep" per the file's own comment). Plus a cosmetic registry entry (label, short label, Tailwind color pair, inline-SVG icon, picker category `"structured"`, `hasStructuredProtocol: true`).
2. **A source-template record** (the reusable protocol) - its own interface + `*Create` + `*Update` types, mirroring `PCRProtocol` / `PlateProtocol` / `QPCRAnalysisProtocol` / `MassSpecProtocol`. Stored as a sidecar; the `Method` row references it (`source_path: "<type>://protocol/{id}"`, the convention `CellCultureSchedule` uses).
3. **An OPTIONAL per-task snapshot field** on `TaskMethodAttachment` (`types.ts` L458), a JSON string, only meaningful for that `method_type`. This carries what VARIES per experiment run. Some types have none (mass_spec, coding_workflow are static templates with "no per-task snapshot" by design). The snapshot keys per-row data by the source row's stable `id` so renaming a row on the source template never breaks experiment data (the `QPCRAnalysisSnapshot.cqs` keyed-by-`QPCRReference.id` pattern - copy it).
4. **A catalog payload type** in `method-catalog.ts` mirroring the `*Create` shape (minus name/folder/is_public, supplied at instantiation), so a template instantiates through the same `methodsApi.create` + per-type `*Api.create` path the `CreateMethodModal` uses. Optionally a bundled `source_pdf` block (`{ bundled, filename, source_url, sha256 }`, confirmed in `bca-protein-standard-curve.json`).

Two reuse notes that shape the specs below:
- **Antibody-application is a recurring sub-shape.** Western blot, ELISA, IHC/IF, and flow cytometry all capture `{ target, host_species, clone, vendor, catalog_number, lot, dilution, incubation_time, incubation_temp, diluent }`. Define ONE `AntibodyApplication` interface and reuse it across all four types (the brief's "reuses the antibody-dilution pattern from Western blot" made concrete). This also forward-links cleanly to the inventory bot's antibody registry (an `antibody_id` foreign key can be added later as an additive field).
- **Smart-per-mode rendering already exists.** `MassSpecProtocol` hides source-param fields irrelevant to the selected `ionization_mode` unless "Show all fields" is checked (`types.ts` L1474, `MassSpecEditor.tsx`). ELISA (direct vs indirect vs sandwich) and IHC/IF (chromogenic vs fluorescent) want the same discriminator-driven field-hiding. Reuse the pattern, do not reinvent it.

Effort scale (mirrors the analysis): Small = one editor + viewer, no snapshot or a trivial one. Medium = editor + viewer + a non-trivial per-task snapshot (qpcr_analysis size). Large = needs new rendering primitives (sequence viewer, image annotation).

---

## PART 1 - STRUCTURED METHOD TYPES: FIELD-LEVEL SPECS

For each type: the **source-template fields** (the reusable protocol, like `PCRProtocol`) and the **per-experiment snapshot fields** (what varies per run, like `QPCRAnalysisSnapshot`). Field names are proposals in the house TypeScript style.

### Shared sub-shape: `AntibodyApplication` (define once, reuse in WB / ELISA / IHC / flow)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable key (snapshots reference this, never the name). |
| `role` | "primary" \| "secondary" \| "capture" \| "detection" \| "conjugate" | Which slot. Drives editor labels per type. |
| `target` | string | Antigen / gene the antibody is against ("GAPDH", "CD3"). |
| `host_species` | string \| null | "rabbit", "mouse" - needed to avoid secondary clashes. |
| `clone` | string \| null | Clone id (flow + IHC reproducibility need this). |
| `conjugate` | string \| null | "HRP", "AF488", "PE", "biotin", null for unconjugated. |
| `vendor` | string \| null | |
| `catalog_number` | string \| null | |
| `lot` | string \| null | Reproducibility / antibody-registry link later. |
| `dilution` | string | Free-text "1:1000" (ratios vary; keep as string like LC `concentration`). |
| `incubation_time` | string \| null | "overnight", "1 h". |
| `incubation_temp_c` | number \| null | 4, 25, 37. |
| `diluent` | string \| null | "5% milk/TBST", "1% BSA/PBS". |

Sources for the field set: protocols.io / Abcam / Bio-Rad Western blot protocols list primary + secondary + dilution + blocking buffer + incubation as the variable fields ([protocols.io Western blotting](https://www.protocols.io/view/western-blotting-dukq6uvw.pdf), [Abcam Western blot](https://www.abcam.com/en-us/technical-resources/protocols/western-blot), [Bio-Rad general WB protocol](https://www.bio-rad.com/webroot/web/pdf/lsr/literature/Bulletin_6376.pdf)); openBIS preconfigures a dedicated "Antibodies" object type with these properties ([openBIS ELN-LIMS, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4743625/)).

---

### 1A. Western blot (structured) - Priority High, Effort Medium

**Source template** `WesternBlotProtocol`:

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `name`, `description`, `is_public`, `created_by`, timestamps | (standard preamble, copy `PlateProtocol`) | |
| `lysate_loading_ug` | number \| null | Protein loaded per lane (e.g. 20-30 ug). |
| `gel_percent` | string | "4-12% Bis-Tris", "10%". String: gradient gels are not a single number ([protocols.io](https://www.protocols.io/view/western-blotting-dukq6uvw.pdf)). |
| `gel_type` | "bis_tris" \| "tris_glycine" \| "tris_acetate" \| "other" | Drives running-buffer hint. |
| `running_buffer` | string \| null | "MOPS", "MES", "Tris-glycine". |
| `run_voltage_v` | number \| null | Typically 100-150 V ([Abcam](https://www.abcam.com/en-us/technical-resources/protocols/western-blot)). |
| `run_time_min` | number \| null | |
| `transfer_method` | "wet" \| "semi_dry" \| "dry" | The single biggest WB variant. |
| `transfer_membrane` | "pvdf" \| "nitrocellulose" | |
| `transfer_voltage_v` | number \| null | e.g. 100 V / 60 min, or 30 V overnight ([protocols.io](https://www.protocols.io/view/detailed-western-blotting-immunoblotting-protocol-b5i4q4gw.pdf)). |
| `transfer_time_min` | number \| null | |
| `blocking_buffer` | string | "5% milk/TBST", "5% BSA/TBST". |
| `blocking_time_min` | number \| null | |
| `antibodies` | `AntibodyApplication[]` | Primary + secondary (+ loading-control primary). |
| `detection` | "ecl_chemilum" \| "fluorescent" \| "colorimetric" | |
| `expected_bands` | `{ target: string; mw_kda: number }[]` | Predicted MW per target + loading control. |
| `loading_control` | string \| null | "GAPDH 37 kDa", "beta-actin". |

**Per-task snapshot** `WesternBlotSnapshot` (on `TaskMethodAttachment.western_blot`):

| Field | Type | Notes |
| --- | --- | --- |
| `lane_assignments` | `{ lane: number; sample_label: string; amount_ug?: number }[]` | The actual gel this run. |
| `observed_bands` | `Record<string, { mw_kda?: number; intensity?: string; notes?: string }>` | Keyed by `expected_bands` target. What was actually seen. |
| `exposure_settings` | string \| null | "ECL, 30 s exposure". Varies per run. |
| `blot_image_path` | string \| null | Attachment (reuse `cell_culture` `photo_attachment_path` pattern). |
| `notes` | string \| null | |

*Why structured beats the markdown we ship today:* the transfer method, antibody dilutions, and expected MW become searchable + reusable, and `observed_bands` makes the result auditable. Competitors with WB as a structured/executable protocol: Labguru, SciNote, Labstep, protocols.io; openBIS ships an explicit "Western blotting protocols" object type ([openBIS, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4743625/)).

---

### 1B. ELISA (structured) - Priority High, Effort Medium

Composes with the existing `plate` type the way `qpcr_analysis` composes with `pcr`: build a "ELISA full kit" compound = `plate` (the well map) + `elisa` (assay metadata + standard curve + readouts). The `elisa` type carries everything the plate map does not.

**Source template** `ELISAProtocol`:

| Field | Type | Notes |
| --- | --- | --- |
| (standard preamble) | | |
| `format` | "sandwich" \| "direct" \| "indirect" \| "competitive" | Discriminator -> smart field hiding (sandwich shows capture AND detection; direct hides capture). ([Abcam sandwich ELISA](https://www.abcam.com/en-us/technical-resources/protocols/sandwich-elisa), [Proteintech build guide](https://www.ptglab.com/news/blog/a-guide-to-building-a-direct-sandwich-elisa/)) |
| `coating_buffer` | string \| null | Carbonate / PBS. |
| `coating_time_temp` | string \| null | "overnight 4 C" - capture coat ([Fortis sandwich ELISA](https://www.fortislife.com/protocols/elisa-protocols/sandwich-elisa-protocol)). |
| `blocking_buffer` | string \| null | |
| `antibodies` | `AntibodyApplication[]` | role = capture / detection / conjugate. |
| `antigen_incubation` | string \| null | "90 min 37 C" ([NCBI StatPearls ELISA](https://www.ncbi.nlm.nih.gov/books/NBK555922/)). |
| `substrate` | "tmb" \| "opd" \| "abts" \| "pnpp" \| "other" | |
| `stop_solution` | string \| null | "0.18 M H2SO4 for TMB". |
| `read_wavelength_nm` | number | 450 (TMB) / 490 (OPD) / 405 (ABTS) ([Sigma ELISA procedures](https://www.sigmaaldrich.com/US/en/technical-documents/protocol/protein-biology/elisa/elisa-procedures)). |
| `reference_wavelength_nm` | number \| null | Often 570/620 nm reference subtraction. |
| `standard_curve` | `{ label: string; concentration: number; units: string }[]` | The standard set (mirrors `QPCRStandardCurvePoint` shape). |
| `curve_fit` | "linear" \| "4pl" \| "5pl" | 4-PL is the ELISA default ([Abcam](https://www.abcam.com/en-us/technical-resources/protocols/sandwich-elisa)). |

**Per-task snapshot** `ELISASnapshot` (on `TaskMethodAttachment.elisa`):

| Field | Type | Notes |
| --- | --- | --- |
| `standard_readouts` | `Record<string, number>` | Keyed by standard `label` -> measured OD. |
| `sample_readouts` | `{ sample: string; od: number; dilution_factor?: number; interpolated_conc?: number }[]` | Per-sample OD + back-calculated concentration. |
| `blank_od` | number \| null | Subtracted from all wells. |
| `notes` | string \| null | |

*Mirrors `qpcr_analysis` almost exactly:* template holds the standard curve + assay config; per-task holds the measured ODs and interpolated values. The plate-map sibling already exists (`bca-protein-standard-curve`, `sandwich-elisa` plate templates).

---

### 1C. Spectrophotometry / Nanodrop / Qubit reading - Priority High, Effort Small

The cheapest high-value type. Nearly every wet lab does this daily. A tiny structured record beats a sticky note and feeds the dilution calculator.

**Source template** `SpecReadingProtocol` (mostly a thin config; the data is per-task):

| Field | Type | Notes |
| --- | --- | --- |
| (standard preamble) | | |
| `instrument` | string \| null | "NanoDrop One", "Qubit 4", "plate reader". |
| `measurement_kind` | "nucleic_acid_a260" \| "protein_a280" \| "qubit_fluor" \| "od600" \| "custom_wavelength" | Discriminator -> which purity ratios / fields to show. ([NEB microvolume tech note](https://www.neb.com/en/-/media/nebus/files/application-notes/technote_mvs_analysis_of_nucleic_acid_concentration_and_purity.pdf)) |
| `analyte_type` | "dsDNA" \| "ssDNA" \| "RNA" \| "protein" \| "oligo" \| "other" | Sets expected purity targets (dsDNA 260/280 ~1.8, RNA ~2.0). |
| `expected_260_280` | number \| null | Reference for the viewer to flag deviation. |
| `expected_260_230` | number \| null | ~2.0 reference ([UGA 260/280 note](https://dna.uga.edu/wp-content/uploads/sites/51/2019/02/Note-on-the-260_280-and-260_230-Ratios.pdf)). |

**Per-task snapshot** `SpecReadingSnapshot` (on `TaskMethodAttachment.spec_reading`) - this is where the action is:

| Field | Type | Notes |
| --- | --- | --- |
| `readings` | `SpecReadingRow[]` | One row per sample. |
| `notes` | string \| null | |

`SpecReadingRow`:

| Field | Type | Notes |
| --- | --- | --- |
| `sample_label` | string | |
| `concentration` | number | ng/uL (or ug/mL for protein). |
| `units` | string | "ng/uL". |
| `a260` | number \| null | Raw absorbance (nucleic acid kinds). |
| `a280` | number \| null | |
| `ratio_260_280` | number \| null | Auto-computable from a260/a280 if both present. |
| `ratio_260_230` | number \| null | |
| `dilution_factor` | number \| null | Feeds the dilution calculator widget. |
| `qubit_reading` | number \| null | When `measurement_kind === "qubit_fluor"`. |
| `od600` | number \| null | When `measurement_kind === "od600"` (also the micro template below). |
| `flagged_impure` | boolean | Viewer computes: true if ratio falls outside expected band. |

Field set sourced from NanoDrop result documentation ([NEB tech note](https://www.neb.com/en/-/media/nebus/files/application-notes/technote_mvs_analysis_of_nucleic_acid_concentration_and_purity.pdf), [Addgene measuring DNA](https://blog.addgene.org/whats-in-your-tube-a-quick-guide-to-measuring-dna-by-spectrophotometry), [URMC NanoDrop guide](https://www.urmc.rochester.edu/MediaLibraries/URMCMedia/labs/kielkopf-lab/documents/nanodrop2022update.pdf)). eLabJournal "data elements" is the competitor analog ([cited in analysis]).

---

### 1D. Flow cytometry panel + gating record - Priority Medium, Effort Medium

Capture the PANEL DESIGN (the documentation labs actually want in an ELN) and per-experiment population counts. NOT a gating engine (that is FlowJo territory, out of scope per the analysis).

**Source template** `FlowPanelProtocol`:

| Field | Type | Notes |
| --- | --- | --- |
| (standard preamble) | | |
| `cytometer` | string \| null | "BD LSRFortessa", "Cytek Aurora". |
| `instrument_type` | "conventional" \| "spectral" | Conventional = filter/detector per fluor; spectral = full-spectrum unmixing ([Thermo panel design](https://www.thermofisher.com/us/en/home/references/newsletters-and-journals/bioprobes-journal-of-cell-biology-applications/bioprobes-71/bioprobes-71-flow-cytometry-panel-design.html)). |
| `lasers` | `{ wavelength_nm: number; label?: string }[]` | Common 3-laser: 405 violet / 488 blue / 640 red ([UChicago panel design](https://voices.uchicago.edu/ucflow/project/traditional-panel-design/), [Proteintech panel building](https://www.ptglab.com/news/blog/guide-to-flow-cytometry-panel-building/)). |
| `markers` | `FlowMarkerRow[]` | The core of the panel - one row per fluorophore/marker. |
| `staining_type` | "surface" \| "intracellular" \| "both" | Drives the fix/perm note. |
| `viability_dye` | string \| null | "Live/Dead Fixable", "7-AAD". |
| `compensation_notes` | string \| null | Single-stain controls / spillover ([Abcam multicolor](https://www.abcam.com/en-us/technical-resources/guides/flow-cytometry-guide/designing-a-multicolor-protocol)). |
| `gating_strategy` | string \| null | Free-text ordered gate list ("FSC/SSC -> singlets -> live -> CD3+ -> ..."). |

`FlowMarkerRow`:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable key for the snapshot. |
| `marker` | string | "CD3", "CD8". |
| `fluorophore` | string | "FITC", "PE", "APC-Cy7", "BV421". |
| `laser_nm` | number \| null | Excitation laser this fluor sits on. |
| `detector` | string \| null | "B530", "V450" - conventional only. |
| `antibody` | `AntibodyApplication` | clone + vendor + catalog + dilution (reuse the shared shape). |

**Per-task snapshot** `FlowExperimentSnapshot` (on `TaskMethodAttachment.flow_cytometry`):

| Field | Type | Notes |
| --- | --- | --- |
| `sample_label` | string | |
| `events_acquired` | number \| null | |
| `populations` | `{ name: string; parent?: string; percent_of_parent?: number; count?: number; mfi?: number }[]` | The gated population summary - what you read off after analysis. |
| `fcs_file_ref` | string \| null | Filename pointer (we do not parse FCS; just reference it). |
| `notes` | string \| null | |

*Out of scope (documented, not built):* live gating, FCS parsing, spectral unmixing. Panel design captured; analysis links out to FlowJo. Competitors: Labguru, SciNote (as protocols); FluoroFinder/Cytek for the design-tool analog ([FluoroFinder](https://fluorofinder.com/flow-cytometry-panel-design/)).

---

### 1E. Immunostaining (IHC / IF) - Priority Medium, Effort Medium

Reuses `AntibodyApplication` heavily. Discriminator `detection_mode` drives chromogenic-vs-fluorescent field hiding (same smart-render pattern as mass_spec).

**Source template** `ImmunostainProtocol`:

| Field | Type | Notes |
| --- | --- | --- |
| (standard preamble) | | |
| `detection_mode` | "chromogenic_ihc" \| "fluorescent_if" | Discriminator. Chromogenic shows DAB/chromogen; IF shows fluorophore + DAPI ([Antibodies.com IHC guide](https://www.antibodies.com/applications/immunohistochemistry/ihc-protocol)). |
| `sample_type` | "ffpe" \| "frozen" \| "cells_coverslip" \| "whole_mount" | FFPE forces antigen retrieval ([Bio-Techne IF frozen](https://www.bio-techne.com/resources/protocols-troubleshooting/immunohistochemistry-frozen)). |
| `fixation` | string \| null | "4% PFA 15 min", "10% NBF overnight" ([Abcam antigen retrieval](https://www.abcam.com/en-us/technical-resources/protocols/ihc-antigen-retrieval)). |
| `antigen_retrieval` | "none" \| "heat_citrate_ph6" \| "heat_edta_ph9" \| "enzymatic" \| "other" | The make-or-break IHC step ([Boster antigen retrieval](https://www.bosterbio.com/protocol-and-troubleshooting/ihc-optimization/antigen-retrieval)). |
| `permeabilization` | string \| null | "0.1% Triton X-100" (intracellular targets). |
| `blocking_buffer` | string \| null | "5% serum in PBS-T" ([Sigma IF tips](https://www.sigmaaldrich.com/US/en/technical-documents/technical-article/protein-biology/flow-cytometry/antibody-immunofluorescent-tips-best-practices)). |
| `antibodies` | `AntibodyApplication[]` | primary + secondary (+ conjugate for direct). |
| `chromogen` | string \| null | "DAB", "AEC" - chromogenic only. |
| `counterstain` | string \| null | "hematoxylin" (IHC) / "DAPI" (IF). |
| `mounting_medium` | string \| null | "ProLong Gold", "DPX". |

**Per-task snapshot** `ImmunostainSnapshot` (on `TaskMethodAttachment.immunostain`):

| Field | Type | Notes |
| --- | --- | --- |
| `slides` | `{ slide_label: string; tissue: string; observation?: string; image_path?: string }[]` | Per-slide result + image attachment. |
| `notes` | string \| null | |

---

### 1F. Gel electrophoresis (structured) - Priority Medium, Effort Small

Upgrades the markdown agarose template we ship. SnapGene-style band *simulation* stays out of scope; structured documentation is in.

**Source template** `GelProtocol`:

| Field | Type | Notes |
| --- | --- | --- |
| (standard preamble) | | |
| `gel_kind` | "agarose" \| "sds_page" \| "native_page" | |
| `percent` | string | "1%", "0.75%", "4-12%". String (gradient gels) - matches WB `gel_percent`. ([miniPCR agarose %](https://www.minipcr.com/choosing-the-right-agarose-percentage/), [Addgene run a gel](https://www.addgene.org/protocols/gel-electrophoresis/)) |
| `running_buffer` | string \| null | "TAE", "TBE", "MOPS". |
| `ladder` | string \| null | "1 kb Plus", "PageRuler". |
| `run_voltage_v` | number \| null | ~120 V / 35 min typical; or volts/cm ([protocol-online voltage thread](https://www.protocol-online.org/biology-forums/posts/12121.html)). |
| `run_time_min` | number \| null | |
| `stain` | string \| null | "SYBR Safe", "EtBr", "Coomassie". |
| `expected_bands` | `{ label: string; size: string }[]` | Predicted fragment sizes (bp or kDa). |

**Per-task snapshot** `GelSnapshot` (on `TaskMethodAttachment.gel`):

| Field | Type | Notes |
| --- | --- | --- |
| `lanes` | `{ lane: number; sample_label: string; expected_size?: string; result?: "expected" \| "wrong_size" \| "absent" \| "smear" }[]` | The actual lane plan + call. |
| `gel_image_path` | string \| null | Attachment. |
| `notes` | string \| null | |

---

### 1G. Buffer / solution (recipe) record - Priority Medium, Effort Small

A "make this solution" record that doubles as the recipe calculator's data source and (later) links to inventory consumption. openBIS ships an explicit "Solutions and Buffers" object type ([openBIS, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4743625/)); Quartzy models lab-made materials; Chemotion models chemical samples.

**Source template** `BufferRecipeProtocol`:

| Field | Type | Notes |
| --- | --- | --- |
| (standard preamble) | | |
| `final_volume` | number \| null | The batch this recipe makes. |
| `final_volume_units` | "mL" \| "L" | |
| `stock_concentration` | string \| null | "1X", "10X", "50X" - many buffers are made as stock. |
| `target_ph` | number \| null | |
| `components` | `BufferComponent[]` | The recipe rows. |
| `storage` | string \| null | "RT", "4 C", "filter-sterilize". |

`BufferComponent` (mirrors `PCRIngredient` deliberately - the recipe calculator can reuse the editor):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `name` | string | "NaCl", "Tris base". |
| `final_concentration` | string | "137 mM", "0.1%". |
| `amount` | string \| null | "8 g", "57.1 mL" - per the final volume. |
| `stock` | string \| null | Source stock concentration when made from a stock. |
| `notes` | string \| null | |

**Per-task snapshot:** NONE. Like mass_spec and coding_workflow, a buffer recipe is a static template (you make the same PBS every time). The recipe-calculator widget (separate work) scales it; the record itself does not vary per task. Recipe data verified against AAT Bioquest / GoldBio formulations ([AAT PBS](https://www.aatbio.com/resources/buffer-preparations-and-recipes/pbs-phosphate-buffered-saline), [GoldBio buffers](https://goldbio.com/articles/article/how-to-prepare-your-most-frequently-used-buffers)).

---

### 1H. Primer / oligo record + Tm - Priority Medium, Effort Medium

A structured oligo record + client-side Tm/resuspension math. Genome-aware in-silico design stays out of scope (Benchling/SnapGene territory). openBIS ships an "Oligos" object type ([openBIS, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4743625/)).

NOTE: this OVERLAPS the inventory bot's oligo registry. Recommendation: the oligo record is a structured METHOD type ONLY if a separate registry is not built; otherwise it is a registry item the inventory bot owns. FLAG for HR to deconflict so we do not ship two oligo stores. Spec given here for completeness; build decision deferred.

**Source template** `OligoProtocol` (one record can hold a primer pair):

| Field | Type | Notes |
| --- | --- | --- |
| (standard preamble) | | |
| `oligos` | `OligoRow[]` | One row per primer (a pair = 2 rows). |
| `vendor` | string \| null | "IDT", "Sigma". |
| `application` | string \| null | "qPCR", "Sanger seq", "cloning". |

`OligoRow`:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `name` | string | "flbA_F". |
| `sequence` | string | 5'->3'. |
| `direction` | "forward" \| "reverse" \| "probe" \| "na" | |
| `length` | number | Auto-derived from sequence. |
| `gc_percent` | number | Auto-computed. |
| `tm_c` | number \| null | Nearest-neighbor (SantaLucia 1998), client-side ([IDT OligoAnalyzer](https://www.idtdna.com/pages/tools/oligoanalyzer), [oligopool nearest-neighbor](https://oligopool.com/tm-calculator)). |
| `synthesis_scale_nmol` | number \| null | 25/100/250 nmol vendor scale - feeds resuspension. |
| `resuspension_volume_ul` | number \| null | Computed: nmol / target uM x 1000 ([oligopool resuspension](https://oligopool.com/resources/user-guide)). |
| `stock_concentration_um` | number \| null | Usually 100 uM. |

**Per-task snapshot:** NONE (a primer is a static reagent record). Links TO a PCR method via the existing compound primitive rather than carrying per-task data.

---

### Structured-type summary table

| Type | Source-template fields | Per-task snapshot? | Priority | Effort | Reuses |
| --- | --- | --- | --- | --- | --- |
| Western blot | gel/transfer/blocking + `AntibodyApplication[]` + expected bands | Yes (lanes, observed bands, image) | High | Medium | AntibodyApplication, image attachment |
| ELISA | format + standard curve + `AntibodyApplication[]` + substrate/wavelength | Yes (standard + sample ODs) | High | Medium | qpcr_analysis snapshot pattern, plate sibling |
| Spectrophotometry / Nanodrop | instrument + measurement kind + expected ratios | Yes (per-sample readings) | High | Small | dilution calculator |
| Flow cytometry panel | cytometer + lasers + `FlowMarkerRow[]` + gating strategy | Yes (population counts) | Medium | Medium | AntibodyApplication, smart-render |
| Immunostaining IHC/IF | fixation + retrieval + `AntibodyApplication[]` + counterstain | Yes (per-slide + image) | Medium | Medium | AntibodyApplication, smart-render (mode) |
| Gel electrophoresis | gel kind + % + ladder + expected bands | Yes (lanes + image) | Medium | Small | WB gel fields, image attachment |
| Buffer / solution recipe | components + final vol + pH + storage | No (static) | Medium | Small | PCRIngredient editor, recipe calculator |
| Primer / oligo | oligo rows + Tm/GC/resuspension math | No (static) | Medium | Medium | compound link to PCR. FLAG: dedupe vs inventory registry |

---

## PART 2 - CONCRETE TEMPLATE BACKLOG (named, build-ready)

40 named templates grouped by the thin categories the analysis flagged. Each row: the `method_type` it instantiates as (using EXISTING types where possible so most ship before the new structured types land), and whether a bundleable vendor PDF exists (our differentiator). "markdown" = ship today with zero new code; "(new type)" = waits on Part 1.

Vendor-PDF reminder per MEMORY: transcribe instrument/recipe params verbatim from the actual fetched PDF; do not let a summarizer hallucinate numbers; confirm the cited source exists and capture its sha256 like `bca-protein-standard-curve.json` does.

### Immunology / antibody assays (8)

| Template | method_type | Bundleable vendor PDF? |
| --- | --- | --- |
| Western blot - wet transfer (fluorescent detection) | western_blot (new) or markdown now | Bio-Rad / LI-COR app notes |
| Western blot - semi-dry transfer | western_blot (new) or markdown | Bio-Rad Trans-Blot Turbo manual |
| Direct ELISA | elisa (new) + plate | Vendor kit insert (e.g. R&D DuoSet) |
| Indirect ELISA | elisa (new) + plate | Abcam protocol PDF |
| Co-IP / pulldown | markdown | Thermo Pierce Co-IP kit insert (PDF exists) |
| Flow - surface staining panel (T-cell: CD3/CD4/CD8) | flow_cytometry (new) or markdown | BioLegend panel PDF |
| Flow - intracellular cytokine staining | flow_cytometry (new) or markdown | BD Cytofix/Cytoperm insert (PDF) |
| Dot blot | markdown | - |

### Microbiology (8)

| Template | method_type | Bundleable vendor PDF? |
| --- | --- | --- |
| OD600 bacterial growth curve | plate (96-well kinetic) + spec_reading (new) | - (general method) |
| Antibiotic MIC (broth microdilution) | plate (96-well dilution map) | CLSI ref (not freely bundleable) |
| CFU plating / serial-dilution counting | markdown | - |
| Chemically-competent cell prep (CaCl2) | markdown | - |
| Electrocompetent cell prep | markdown | Bio-Rad electroporation guide (PDF) |
| Gram stain | markdown | - |
| LB / LB-agar media recipe | buffer_recipe (new) or markdown | - (recipe; see Part 2 general) |
| Glycerol stock (freeze bacteria) | markdown | (we ship glycerol-stock already - keep) |

### Protein biochemistry beyond BCA (6)

| Template | method_type | Bundleable vendor PDF? |
| --- | --- | --- |
| Bradford assay (standard curve) | plate (96-well, like BCA) | Bio-Rad Bradford insert (PDF) |
| Lowry assay | plate | - |
| His-tag affinity purification (Ni-NTA / IMAC) | markdown | QIAGEN Ni-NTA handbook (PDF, bundleable) ([QIAGEN tagged-protein guide](https://www.qiagen.com/us/resources/download.aspx?id=d44d1a88-b775-4c2d-9ec6-bb8e6c91db99&lang=en)) |
| GST-tag affinity purification | markdown | Cytiva GST handbook (PDF) |
| Dialysis / buffer exchange | markdown | Thermo Slide-A-Lyzer insert (PDF) |
| Coomassie / silver stain | markdown | Thermo SilverQuest insert (PDF) |

### Nucleic-acid prep beyond miniprep (6)

| Template | method_type | Bundleable vendor PDF? |
| --- | --- | --- |
| Plasmid maxiprep | markdown (kit) | QIAGEN Plasmid Maxi handbook (PDF) |
| Gel extraction | markdown (kit) | QIAGEN QIAquick Gel Extraction (PDF) |
| PCR cleanup | markdown (kit) | QIAGEN QIAquick PCR Purification (PDF) |
| Column RNA extraction | markdown (kit) | QIAGEN RNeasy handbook (PDF) |
| cDNA synthesis / reverse transcription | pcr (cycling) + markdown | Thermo SuperScript IV insert (PDF) |
| DNase I treatment | markdown | NEB / Thermo insert (PDF) |

### Staining / histology (5)

| Template | method_type | Bundleable vendor PDF? |
| --- | --- | --- |
| H and E staining | markdown | - |
| IHC (FFPE, DAB) | immunostain (new) or markdown | Abcam IHC protocol (PDF) |
| Immunofluorescence (cells on coverslip) | immunostain (new) or markdown | Cell Signaling IF protocol (PDF) |
| Cryosectioning | markdown | - |
| DAPI / phalloidin counterstain | markdown | Thermo phalloidin insert (PDF) |

### General buffer / media recipes (7)

All instantiate as buffer_recipe (new) - or markdown today. Recipes verified against AAT Bioquest / GoldBio ([AAT PBS](https://www.aatbio.com/resources/buffer-preparations-and-recipes/pbs-phosphate-buffered-saline), [GoldBio buffers](https://goldbio.com/articles/article/how-to-prepare-your-most-frequently-used-buffers)). No bundleable PDF (recipes are not vendor docs) - the recipe IS the content.

| Template | Verified composition (1 L unless noted) |
| --- | --- |
| 1X PBS pH 7.4 | 8 g NaCl, 0.2 g KCl, 1.44 g Na2HPO4, 0.24 g KH2PO4 (137 mM NaCl / 2.7 mM KCl / 10 mM phosphate) |
| 50X TAE | 242 g Tris, 57.1 mL glacial acetic acid, 18.6 g EDTA disodium (pH ~8.6 at 1X) |
| 10X TBS pH 7.4 | Tris + NaCl, pH to 7.4 with HCl (dilute to 1X for use) |
| TBS-T | 1X TBS + 0.05-0.1% Tween-20 |
| LB broth | 10 g tryptone, 5 g yeast extract, 10 g NaCl |
| LB-agar | LB broth + 15 g agar |
| SOC medium | LB base + 20 mM glucose + Mg salts (recipe to transcribe from a cited source at build) |

### Cloning kit inserts (expand the strong suit) (5)

These play directly to the bundled-vendor-PDF differentiator; lower lift because the kit model already exists (`gibson-assembly-master-mix` etc.).

| Template | method_type | Bundleable vendor PDF? |
| --- | --- | --- |
| Golden Gate assembly | markdown (kit) | NEB Golden Gate protocol (PDF) |
| In-Fusion cloning | markdown (kit) | Takara In-Fusion HD insert (PDF) |
| TOPO TA cloning | markdown (kit) | Thermo TOPO TA insert (PDF) |
| Gateway BP/LR cloning | markdown (kit) | Thermo Gateway manual (PDF) |
| Q5 site-directed mutagenesis | pcr + markdown (kit) | NEB Q5 SDM insert (PDF) |

**Backlog count: 45 named templates** (8 immunology + 8 microbiology + 6 protein + 6 nucleic-acid + 5 histology + 7 buffer/media + 5 cloning). Roughly 28 of the 45 ship as `markdown` / `plate` / `pcr` with ZERO new code (only content + an optionally-bundled PDF); 17 are nicer as a new structured type but degrade gracefully to `markdown` until that type lands.

---

## PART 3 - BROADER COMPETITOR VERIFICATION

### New competitors not in the first pass

| Tool | What it is | Relevance to this scope | Confidence |
| --- | --- | --- | --- |
| **openBIS ELN-LIMS** (ETH Zurich, open source) | Academic ELN-LIMS. Ships PRECONFIGURED object types: Antibodies, Chemicals, Enzymes, Media, Solutions and Buffers, Plasmids, Oligos, RNAs, Bacteria, Cell lines, Flies, Yeasts, General protocols, PCR protocols, **Western blotting protocols** ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4743625/), [Oxford Bioinformatics](https://academic.oup.com/bioinformatics/article/32/4/638/1743839)). | STRONGEST external validation of this doc: openBIS independently arrived at the same structured-type list I recommend (buffer/solution, WB protocol, oligo, antibody). It is server-hosted (not local-first), so we still win on architecture, but its type taxonomy is a proven academic blueprint. | High (peer-reviewed) |
| **SENAITE / Bika LIMS** (open source) | Analytical-lab LIMS (sample intake -> analysis -> report), originated in environmental/water testing ([senaite.com](https://www.senaite.com/), [bikalims.org templates](https://www.bikalims.org/manual/8-analysis-templates)). | Analysis-profile/worksheet model, not wet-lab protocols. Low overlap with our method-types; more an inventory/LIMS comparator. Confirms "analysis templates" as a concept but its audience (QC testing labs) is not our solo-academic target. | Medium |
| **Colabra** | ELN with Git-like version control, inventory + SDS + expiration alerts, mobile ([SaaSworthy](https://www.saasworthy.com/product/colabra-lims), [colabra.ai](https://www.colabra.ai/mobile)). | Their "Git-like version control" is a marketing framing of what we ALREADY ship (version history + trash on every record). Inventory/SDS is the inventory bot's lane. No new structured-type ideas. | Medium |
| **FluoroFinder / Cytek panel builders** | Flow panel design tools (instrument configs + antibody DB) ([FluoroFinder](https://fluorofinder.com/flow-cytometry-panel-design/)). | Confirms the flow-PANEL-design field set (laser config, fluor-to-marker, spillover) is the documented artifact - validates type 1D's scope (design captured, gating excluded). | High |

### Pinning down previously-"unverified" specifics

| Claim from first pass | Now verified? | Detail + source |
| --- | --- | --- |
| LabArchives "20+ widgets" incl. named calculators | VERIFIED (and higher) | LabArchives states **"over 24 built-in widgets"**; calculator set named: **Acid and Base Molarity, DNA-RNA, Molarity, Dilution** ([LabArchives widget manager](https://www.labarchives.com/blog/discover-the-labarchives-widget-manager-and-library-a-new-era-of-eln), [LabArchives intro to widgets](https://help.labarchives.com/hc/en-us/articles/11732040270484-Introduction-to-Widgets)). Confirms the calculator-pack parity target exactly. |
| LabArchives named widgets (Core Facility, SOP, To Do) | VERIFIED | Core Facility Request Form, Standard Operating Procedure, and To Do List widgets all named in the library ([same source](https://www.labarchives.com/blog/discover-the-labarchives-widget-manager-and-library-a-new-era-of-eln)). |
| Benchling free academic tier EXCLUDES inventory + registry | VERIFIED | Benchling: the free academic plan "intentionally excludes the Registry and Inventory products" ([Scispot guide](https://www.scispot.com/blog/the-complete-guide-to-benchling-pricing-plans-costs-and-alternatives-for-biotech-research), [benchling.com/academic](https://www.benchling.com/academic)). Free tier = 10 GB storage, sequences/oligos exempt, 128 MB upload cap, 4 invites/day. Strengthens our "free local-first inventory beats what academics get free" line. |
| SciNote free-tier limits | NEWLY VERIFIED | Free plan = 1 GB storage (earn +1 GB per invited user, cap +10 GB), **1 Inventory**, 50 MB file columns ([SciNote free plan](https://support.scinote.net/hc/en-us/articles/115001787651-What-does-the-SciNote-Free-plan-include-)). |
| ELISA read wavelengths | VERIFIED | 450 nm (TMB) / 490 nm (OPD) / 405 nm (ABTS) ([Sigma ELISA procedures](https://www.sigmaaldrich.com/US/en/technical-documents/protocol/protein-biology/elisa/elisa-procedures)). |
| Nucleic-acid purity targets | VERIFIED | dsDNA 260/280 ~1.8, RNA ~2.0; 260/230 ~2.0 ([NEB tech note](https://www.neb.com/en/-/media/nebus/files/application-notes/technote_mvs_analysis_of_nucleic_acid_concentration_and_purity.pdf), [UGA note](https://dna.uga.edu/wp-content/uploads/sites/51/2019/02/Note-on-the-260_280-and-260_230-Ratios.pdf)). |
| Genemod exact item-type list (Cell Line/Enzyme/Plasmid/Antibody/Strain/Primer) | STILL PARTIALLY UNVERIFIED | First-pass cited it; my live fetch of genemod.net was truncated and did not re-confirm verbatim. openBIS's near-identical list corroborates the SHAPE, but treat the exact Genemod enumeration as inventory-bot territory + unverified here. |
| Competitors' full per-template library counts | STILL UNVERIFIED | Behind login. Category gaps are well-evidenced (standard techniques + advertised areas); exact counts remain inferred. |

---

## PART 4 - REFINED FIRST WAVE (structured types + templates only)

The analysis's overall first wave correctly leads with inventory + calculators + registries (other bots). Refining ONLY the structured-types + templates portion with the field-level detail now in hand:

### Build FIRST (one batch): the three Small/Medium types that share the most plumbing

1. **Spectrophotometry / Nanodrop reading (Small).** Highest daily frequency of any type here, smallest surface (a thin template + a per-sample snapshot table), and it directly feeds the dilution calculator other bots are building. Best effort-to-value ratio of the structured types. Ship it first to validate the new-type pipeline cheaply.
2. **Western blot (Medium).** Establishes the shared `AntibodyApplication` sub-shape that ELISA, IHC/IF, and flow all then reuse - so building WB second front-loads the reuse for everything after it. It also upgrades an assay we already half-ship as markdown, and openBIS independently shipping "Western blotting protocols" as a first-class type confirms the demand.
3. **Buffer / solution recipe (Small, NO snapshot).** Pairs with the recipe-calculator widget, reuses the `PCRIngredient` editor, and unlocks the 7 buffer/media templates as structured records rather than markdown. Static template (no snapshot) makes it low-risk.

Rationale: do `AntibodyApplication` ONCE inside Western blot, then ELISA / IHC / flow are mostly editor-shape work on a proven sub-component. Spec + recipe are independent small wins that de-risk the new-type pipeline and feed the calculators. Defer ELISA, flow, IHC, gel, and oligo to a second wave (ELISA next, since it reuses both the qpcr_analysis snapshot pattern AND the antibody shape). FLAG the oligo type for HR to deconflict against the inventory bot before building.

### Template batch to ship ALONGSIDE (no new code needed)

Ship the **markdown + plate + pcr** subset of the Part 2 backlog in parallel - they need only content + optionally-bundled PDFs:

- **Microbiology batch** (highest-traffic, most under-served): competent-cell prep, CFU counting, Gram stain, OD600 growth curve, LB/LB-agar media. Currently we have only transformation + glycerol stock.
- **Buffer/media recipes** (PBS, TAE, TBS-T, LB, SOC): trivial content, pairs with the buffer type + recipe calculator, verified compositions in Part 2.
- **Nucleic-acid kit inserts** (maxiprep, gel extraction, PCR cleanup, RNeasy): pure play to the bundled-vendor-PDF differentiator, lowest lift because the kit model exists.

Why this batch first: microbiology + buffers are the most glaring CATEGORY holes (we are near-zero), they need zero new structured-type code, and the kit inserts reinforce the one differentiator (bundled vendor PDFs) no competitor matches. Immunology and histology templates wait for the WB / ELISA / IHC structured types so they instantiate as rich records rather than flat markdown.

---

## Sources

Structured-type field evidence:
- Western blot: [protocols.io Western blotting](https://www.protocols.io/view/western-blotting-dukq6uvw.pdf), [protocols.io detailed immunoblot](https://www.protocols.io/view/detailed-western-blotting-immunoblotting-protocol-b5i4q4gw.pdf), [Abcam Western blot](https://www.abcam.com/en-us/technical-resources/protocols/western-blot), [Bio-Rad general WB protocol](https://www.bio-rad.com/webroot/web/pdf/lsr/literature/Bulletin_6376.pdf).
- ELISA: [Abcam sandwich ELISA](https://www.abcam.com/en-us/technical-resources/protocols/sandwich-elisa), [Fortis sandwich ELISA](https://www.fortislife.com/protocols/elisa-protocols/sandwich-elisa-protocol), [Proteintech build guide](https://www.ptglab.com/news/blog/a-guide-to-building-a-direct-sandwich-elisa/), [Sigma ELISA procedures](https://www.sigmaaldrich.com/US/en/technical-documents/protocol/protein-biology/elisa/elisa-procedures), [NCBI StatPearls ELISA](https://www.ncbi.nlm.nih.gov/books/NBK555922/).
- Spectrophotometry/Nanodrop: [NEB microvolume tech note](https://www.neb.com/en/-/media/nebus/files/application-notes/technote_mvs_analysis_of_nucleic_acid_concentration_and_purity.pdf), [Addgene measuring DNA](https://blog.addgene.org/whats-in-your-tube-a-quick-guide-to-measuring-dna-by-spectrophotometry), [URMC NanoDrop guide](https://www.urmc.rochester.edu/MediaLibraries/URMCMedia/labs/kielkopf-lab/documents/nanodrop2022update.pdf), [UGA 260/280 note](https://dna.uga.edu/wp-content/uploads/sites/51/2019/02/Note-on-the-260_280-and-260_230-Ratios.pdf).
- Flow cytometry panel: [Thermo panel design](https://www.thermofisher.com/us/en/home/references/newsletters-and-journals/bioprobes-journal-of-cell-biology-applications/bioprobes-71/bioprobes-71-flow-cytometry-panel-design.html), [UChicago traditional panel design](https://voices.uchicago.edu/ucflow/project/traditional-panel-design/), [Proteintech panel building](https://www.ptglab.com/news/blog/guide-to-flow-cytometry-panel-building/), [Abcam multicolor protocol](https://www.abcam.com/en-us/technical-resources/guides/flow-cytometry-guide/designing-a-multicolor-protocol), [FluoroFinder panel design](https://fluorofinder.com/flow-cytometry-panel-design/).
- IHC/IF: [Antibodies.com IHC protocol](https://www.antibodies.com/applications/immunohistochemistry/ihc-protocol), [Abcam antigen retrieval](https://www.abcam.com/en-us/technical-resources/protocols/ihc-antigen-retrieval), [Boster antigen retrieval](https://www.bosterbio.com/protocol-and-troubleshooting/ihc-optimization/antigen-retrieval), [Bio-Techne IF frozen](https://www.bio-techne.com/resources/protocols-troubleshooting/immunohistochemistry-frozen), [Sigma IF tips](https://www.sigmaaldrich.com/US/en/technical-documents/technical-article/protein-biology/flow-cytometry/antibody-immunofluorescent-tips-best-practices).
- Gel electrophoresis: [miniPCR agarose %](https://www.minipcr.com/choosing-the-right-agarose-percentage/), [Addgene run a gel](https://www.addgene.org/protocols/gel-electrophoresis/), [protocol-online voltage thread](https://www.protocol-online.org/biology-forums/posts/12121.html).
- Buffers/recipes: [AAT Bioquest PBS](https://www.aatbio.com/resources/buffer-preparations-and-recipes/pbs-phosphate-buffered-saline), [AAT Bioquest TBS](https://www.aatbio.com/resources/buffer-preparations-and-recipes/tbs-ph-7-4), [GoldBio buffers](https://goldbio.com/articles/article/how-to-prepare-your-most-frequently-used-buffers).
- Oligo/primer: [IDT OligoAnalyzer](https://www.idtdna.com/pages/tools/oligoanalyzer), [oligopool Tm calculator](https://oligopool.com/tm-calculator), [oligopool user guide](https://oligopool.com/resources/user-guide).
- Protein purification (template content): [QIAGEN tagged-protein guide](https://www.qiagen.com/us/resources/download.aspx?id=d44d1a88-b775-4c2d-9ec6-bb8e6c91db99&lang=en), [Thermo His-tag purification](https://www.thermofisher.com/us/en/home/life-science/protein-biology/protein-biology-learning-center/protein-biology-resource-library/pierce-protein-methods/his-tagged-proteins-production-purification.html).

Competitor verification:
- openBIS: [openBIS ELN-LIMS, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4743625/), [Oxford Bioinformatics](https://academic.oup.com/bioinformatics/article/32/4/638/1743839), [LIMSWiki openBIS](https://www.limswiki.org/index.php/OpenBIS).
- SENAITE/Bika: [senaite.com](https://www.senaite.com/), [Bika analysis templates](https://www.bikalims.org/manual/8-analysis-templates).
- Colabra: [SaaSworthy Colabra](https://www.saasworthy.com/product/colabra-lims), [colabra.ai mobile](https://www.colabra.ai/mobile).
- LabArchives widgets: [Widget Manager & Library](https://www.labarchives.com/blog/discover-the-labarchives-widget-manager-and-library-a-new-era-of-eln), [Introduction to Widgets](https://help.labarchives.com/hc/en-us/articles/11732040270484-Introduction-to-Widgets).
- Benchling academic: [Scispot pricing guide](https://www.scispot.com/blog/the-complete-guide-to-benchling-pricing-plans-costs-and-alternatives-for-biotech-research), [benchling.com/academic](https://www.benchling.com/academic), [Benchling storage help](https://help.benchling.com/hc/en-us/articles/9684272903821-Learn-about-storage-space-Academics).
- SciNote free plan: [SciNote free plan support article](https://support.scinote.net/hc/en-us/articles/115001787651-What-does-the-SciNote-Free-plan-include-).

Confidence: structured-type field sets are well sourced from vendor + protocols.io + peer-reviewed openBIS. Benchling/SciNote/LabArchives free-tier and widget specifics are now verified against vendor/help pages. Genemod's exact item-type enumeration and competitors' full per-template library counts remain unverified (login-gated / fetch-truncated) and are flagged as such inline.

-- gap-deepdive sub-bot of HR
