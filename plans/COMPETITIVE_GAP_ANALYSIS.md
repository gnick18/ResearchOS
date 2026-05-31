# Competitive Gap Analysis: Method Types, Templates, and Dashboard Widgets

Author: competitive-gap-analysis sub-bot of HR
Date: 2026-05-31
Scope: what competing research tools offer that ResearchOS lacks, weighed by value to solo and small academic labs (up to ~30 people) and by feasibility under a local-first, no-server architecture.

This document is research plus analysis. It does not change app code. Confidence is called out inline; anything I could not directly confirm is marked "unverified."

---

## Executive summary (highest-value, most-feasible additions)

1. **Sample / reagent inventory is the universal gap.** Every ELN and lab tool surveyed (Benchling, SciNote, Labguru, eLabNext, RSpace, Quartzy, Genemod, LabArchives) ships a sample and reagent inventory with storage locations. ResearchOS has purchases and grant budgets but no standing stock-on-hand record. This is the single biggest hole and it is fully feasible local-first (it is just structured JSON in the data folder). Build this first.
2. **A freezer / box (-80) storage map is the inventory feature labs talk about most.** Quartzy, Genemod, eLabNext, and Labguru all render a graphical box / rack / shelf hierarchy so you can find a tube. It is a natural extension of inventory and maps cleanly onto our plate-grid component we already own.
3. **Biological registries (plasmid, antibody, cell line, strain, oligo) are structured method-type-shaped records every life-science ELN has.** Benchling, Labguru, Genemod, and eLabNext all ship these. They fit our existing "structured method type" pattern (PCR, plate, mass_spec). Start with the two highest-traffic ones: plasmid/construct and antibody.
4. **Built-in calculators are a cheap, high-delight win and a direct LabArchives parity gap.** LabArchives advertises 20+ widgets including Molarity, Dilution, DNA-RNA, and Acid/Base Molarity calculators (labarchives.com). These are pure client-side math, zero storage, perfect for local-first, and they remove a daily reason researchers leave the app.
5. **A handful of structured wet-lab method types we are missing are easy template-model extensions.** Western blot, ELISA (as a structured type, not just a plate map), flow cytometry panel, and a generic spectrophotometry / Nanodrop reading all fit the same source-template-plus-per-task-snapshot model our plate and qPCR types already use. We already ship Western blot and ELISA as *markdown/plate* templates, so the structured upgrade is incremental.

The throughline: our purchases-and-funding system covers the *buying* half of lab supplies but not the *having* half. Closing the inventory gap (items 1-3) is where we are most exposed against every competitor at once, and it is squarely feasible local-first.

---

## Our current inventory (confirmed from the codebase)

### Method types (the `method_type` union, `frontend/src/lib/types.ts`)

| Type | What it models |
| --- | --- |
| `markdown` | Free-form rich protocol body (the general-purpose protocol). |
| `pdf` | An attached source PDF rendered in-app (vendor inserts, papers). |
| `pcr` | Thermocycler gradient (initial / cycles / final / hold) plus a reaction-mix ingredient table. |
| `lc_gradient` | LC solvent-gradient table, column spec, detection wavelength, mobile-phase ingredients. |
| `plate` | Generic 12/24/48/96/384-well annotation grid with pre-labeled regions; per-task well painting. |
| `cell_culture` | Passaging schedule: cell-line + media metadata, planned events (feed/split/observe/harvest), per-task actual-events log. |
| `mass_spec` | Ionization mode, source params, scan params, calibration; smart per-mode field rendering. |
| `compound` | Composition primitive: a parent method that bundles ordered child methods (e.g. LC + MS = LC-MS kit). |
| `coding_workflow` | Reusable script / Jupyter notebook with read-only syntax-highlight or ipynb preview. |
| `qpcr_analysis` | Per-target Cq, melt-curve config, standard curve, delta-delta-Cq; per-task measured readouts. Composes with `pcr` via `compound`. |

Method records also support a **bundled source PDF** (`source_pdf_path`) attached alongside structured kit templates.

### Template library (`frontend/public/method-catalog/manifest.json`, 91 templates)

By category: Molecular biology 36 (mostly vendor PCR enzyme presets plus gel, transformation, digest, ligation, RNA extraction, glycerol stock), qPCR 17 (vendor master-mix presets), Cell culture 11 (ATCC line maintenance, cryopreservation, counting, mycoplasma), LC-MS 9 (3 instrument triplets), Plate layouts 8 (BCA, IC50, MTT, sandwich ELISA maps in 96 and 384), Kits 4 (Gibson, NEBuilder, QIAprep miniprep, Qubit), Protein biochemistry 2 (Western blot, SDS-PAGE), Cell biology 2, Analytical chemistry 1, General 1.

By method type: pcr 47, markdown 13, cell_culture 12, plate 9, lc_gradient 4, mass_spec 3, compound 3.

### Dashboard tools / widgets (`frontend/src/lib/lab-overview/tool-registry.tsx`)

Announcements, Lab comments, Lab notes, Lab experiments, Lab purchases, Lab metrics, Trainee notes and goals, Weekly goals, Today's tasks, Lab activity, Recent activity, Pending PI actions, Member workload, Today's announcements, Calendar, Projects overview, Single project. Widget variants add funding burn-rate, pending-count, activity-by-type, ready-for-writeup, and sidebar task tiles.

### Adjacent features we already ship (so they are NOT flagged below)

Gantt timeline with dependencies, version history, trash / restore, lab inbox + notifications, sharing and PI mode, **Purchases and Funding** (ordering workflow with vendor / CAS / price / shipping, funding accounts with `total_budget` and structured grant metadata, requester-to-orderer handoff, PI approval), calendar with external feed subscriptions, saved external Links, ELN import, search.

**Important boundary:** our Purchases system is an *order ledger* (one-time line items, approval, "ordered/received" status). It is NOT a standing inventory: there is no on-hand quantity, location, lot number, expiry, or "deduct on use." `grep` confirms no freezer / reagent-inventory / equipment-booking / antibody-registry / plasmid-registry / cell-line-registry code exists in `frontend/src`.

---

## Competitors surveyed

15 tools researched with direct evidence (ELNs, protocol repositories, inventory / lab-management tools, and domain tools):

ELNs: **Benchling**, **LabArchives**, **SciNote**, **Labguru**, **eLabNext / eLabJournal** (now SciSure), **RSpace**, **Labfolder**, **Labstep**, **Chemotion**, **Genemod**. Protocol repositories: **Protocols.io**. Inventory / lab management: **Quartzy**, **Genemod** (also above). Domain tools (method-type ideas): **SnapGene / Geneious**, **FlowJo**. Research-adapted productivity: **Notion / Airtable** lab templates. (OpenBIS noted but has no vendor-fixed feature set; Bio-protocol, Geneious, ImageJ/OMERO, GraphPad Prism, Quartzy Shop noted at lower confidence.)

Confidence note: feature *existence* below is well sourced. I did not have paid-tier access, so per-plan limits and exact template-library counts are "unverified" where stated.

---

## 1. MISSING METHOD TYPES

Structured protocol kinds we lack that fit the source-template-plus-per-task-snapshot model we already use for `plate`, `pcr`, and `qpcr_analysis`. Effort assumes the same pattern (a new union member, an editor, a viewer, an optional per-task snapshot field on `TaskMethodAttachment`).

| Gap (method type) | Competitor(s) with it | Why it matters for small academic labs | Priority | Effort | Local-first feasibility |
| --- | --- | --- | --- | --- | --- |
| **Western blot (structured)** | Labguru, SciNote, Labstep, protocols.io (as structured/executable protocols) | One of the most-run protein assays in academic labs; structured fields (gel %, transfer time/voltage, primary/secondary antibody + dilution, blocking buffer, exposure) make it reusable and auditable. We ship it only as a markdown/protein template today. | High | Medium | Full. Pure structured JSON. No server. |
| **ELISA (structured type, not just a plate map)** | Labguru, SciNote, LabArchives protocols | We have an ELISA *plate map* but not the assay metadata (capture/detection antibody, standard curve concentrations, substrate, read wavelength, incubation steps). A structured type would carry the per-plate standard curve and readouts the way `qpcr_analysis` does. | High | Medium | Full. Mirrors `qpcr_analysis`. |
| **Spectrophotometry / Nanodrop / Qubit reading** | LabArchives (DNA-RNA calculator + inventory linkage), eLabJournal data elements | Nearly every wet lab measures nucleic-acid / protein concentration daily. A tiny structured type capturing A260/A280, ng/uL, 260/230, dilution, instrument would beat a sticky note and feed the dilution calculator. | High | Small | Full. Trivial structured record. |
| **Flow cytometry panel + gating record** | FlowJo (analysis), Labguru, SciNote (as protocols) | Immunology / cell-bio labs run panels constantly. We cannot replicate FlowJo's gating engine local-first, but we CAN capture the *panel design* (fluorophore-to-marker-to-antibody table, laser/detector, compensation notes) and per-experiment population counts. That is the documentation labs actually want in an ELN. | Medium | Medium | Panel design: full. Live gating: out of scope (needs FCS parsing / heavy viz). |
| **Primer / oligo design + Tm record** | Benchling (Primer3-based primer wizard), SnapGene, IDT/NEB calculators | Benchling's free academic tier centers on this. We will not match in-silico design local-first, but a structured oligo record (sequence, Tm via nearest-neighbor, GC%, length, vendor, resuspension volume) plus a Tm/resuspension calculator covers the daily need and links to our PCR methods. | Medium | Medium | Record + Tm math: full (client-side). Genome-aware design: out of scope. |
| **Plasmid / construct map** | Benchling, SnapGene, Geneious, Labguru, Genemod registry | The signature molecular-biology artifact. A full annotated sequence editor is large; a *registry record* (name, backbone, insert, resistance, source, sequence file attachment, simple linear/circular feature list) is feasible and is what most academic cataloging actually needs. See also the registry widget below. | Medium | Large (full map) / Medium (registry record) | Registry record: full. Interactive sequence editor with enzyme/ORF detection: very large, likely out of scope for v1. |
| **Gel electrophoresis (structured)** | SnapGene (gel simulation), Labguru, SciNote | We ship agarose-gel as a markdown template. A light structured type (percent agarose, ladder, lane assignments, run V/time, expected band sizes, gel image attachment) makes results searchable and reusable. | Medium | Small | Full. SnapGene-style band *simulation* is out of scope; documentation is not. |
| **Immunostaining / IHC / IF** | Labguru, SciNote, protocols.io, vendor protocol libraries | Common in histology / neuro / cancer labs. Structured fields: fixation, antigen retrieval, primary/secondary antibody + dilution, counterstain, mounting. Reuses the antibody-dilution pattern from Western blot. | Medium | Medium | Full. |
| **Buffer / recipe (solution) record** | LabArchives (recipe via widgets), Quartzy (lab-made materials), Chemotion (chemical samples) | A "make this solution" record (components, final concentrations, total volume, pH) that doubles as a calculator and can link to inventory consumption. Extremely common and currently only expressible as markdown. | Medium | Small | Full. Pairs with the recipe calculator. |
| **NGS / sequencing run sheet** | Benchling, Genemod, Labguru | Sample-to-index-to-lane sheet plus run metadata (platform, read length, loading conc). Valuable for genomics labs but narrower audience than the above. | Low | Medium | Sheet capture: full. Demultiplexing / analysis: out of scope. |
| **Animal / in-vivo protocol** | Labguru (mouse colony), LabArchives (Mouse Colony Genotyping Report widget) | Cohort, strain, treatment-group, dosing-schedule, IACUC reference. Relevant to in-vivo labs; some overlap with a strain registry. | Low | Medium | Full, but audience-specific. |
| **Histology processing** | Labguru, protocols.io | Embedding / sectioning / staining sequence. Narrow audience; covers via markdown today. | Low | Small | Full. |

Note on candidates from the brief we judged already-covered or low-value as a *new type*: **qPCR plate setup** is covered by `plate` + `qpcr_analysis`; **serial-dilution / dilution calculator** and **buffer/recipe calculator** are better as widgets (see section 3) than method types; **microscopy acquisition** as a structured type is thin without image handling (treat as a markdown template plus image attachment for now).

---

## 2. MISSING TEMPLATES

Specific protocols and whole categories competitors offer that our 91 templates do not cover. Our library is deep in PCR/qPCR vendor presets and cell-line maintenance but thin everywhere else. Grouped by category.

| Category | Example missing templates | Who offers comparable | Priority | Notes / feasibility |
| --- | --- | --- | --- | --- |
| **Immunology / antibody assays** | Western blot variants (wet vs semi-dry transfer, fluorescent), direct/indirect ELISA, co-IP / pulldown, flow cytometry surface + intracellular staining, FACS panel | Labguru, SciNote, protocols.io, Bio-Rad/CST/Abcam protocol libraries | High | We have ONE Western blot and ELISA plate maps. Whole assay category is under-served. Pure content; pairs with the new structured types above. |
| **Microbiology** | Bacterial culture / OD600 growth curve, antibiotic MIC, plating / CFU counting, competent-cell prep, Gram stain, media recipes (LB/agar) | SciNote, Labguru, protocols.io, Protocol Online | High | High-traffic for any micro / mol-bio lab; currently only transformation + glycerol stock exist. |
| **Protein biochemistry** | Bradford / Lowry (we have BCA), affinity purification (His/GST), dialysis, concentration/buffer exchange, Coomassie/silver stain variants, IP | Labguru, SciNote, protocols.io | Medium | Extends our 2-template protein category. |
| **Nucleic-acid prep (beyond TRIzol/miniprep)** | Maxiprep, gel extraction, PCR cleanup, column RNA kits, cDNA / reverse transcription, DNase treatment, phenol-chloroform | Vendor kit inserts (QIAGEN, NEB, Zymo), SciNote, Labguru | Medium | Fits our existing bundled-source-PDF kit model perfectly. |
| **Staining / fixation / histology** | H and E, IHC, IF, cryosectioning, paraffin embedding, antigen retrieval, DAPI/phalloidin | Labguru, protocols.io | Medium | Pairs with the IHC/IF structured type. |
| **Plant biology** | Agrobacterium transformation, leaf disc assay, seed sterilization, chlorophyll extraction, plant DNA CTAB extraction | protocols.io, Bio-protocol | Low | Audience-specific; we are zero here. |
| **Neuroscience / electrophysiology** | Brain slice prep, patch-clamp setup, perfusion, immunolabeling of slices | protocols.io, Bio-protocol | Low | Niche; markdown-template territory for now. |
| **General lab calculations as templates** | Buffer / solution recipes (PBS, TAE, TBS-T, lysis buffers), competent-cell media | LabArchives recipe widgets, Quartzy lab-made materials | Medium | Cheap content wins; pairs with recipe calculator and buffer record type. |
| **Specific kit inserts (expand the strong suit)** | More qPCR/PCR are saturated; add cloning kits (Golden Gate, In-Fusion, TOPO, Gateway), extraction kits, assay kits (Bradford, Griess, LDH, caspase) | NEB, QIAGEN, Thermo, Bio-Rad inserts | Medium | Plays directly to our differentiator (bundled vendor-PDF kits). Lower lift than new categories because the model exists. |

Confidence: I could not enumerate competitors' exact template lists (their libraries sit behind login), so the *category* gaps are well-evidenced (techniques are standard and competitors advertise these areas) but specific per-template counts are unverified.

---

## 3. MISSING WIDGETS / DASHBOARD TOOLS

Ranked roughly by value-times-feasibility. Feasibility is the critical column for a local-first app.

| Gap (widget / tool) | Competitor(s) with it | Value for small labs | Priority | Effort | Local-first feasibility |
| --- | --- | --- | --- | --- | --- |
| **Reagent / consumable inventory** | Benchling*, SciNote, Labguru, eLabNext, RSpace, Quartzy, Genemod, LabArchives | THE table-stakes feature we lack. Stock-on-hand, location, lot, expiry, low-stock alert, "used in experiment X." Solo and small labs waste real time re-ordering things they already have. | High | Large | Full. Structured JSON in the data folder; low-stock "alerts" are computed at load. *Benchling excludes inventory from its free academic tier, so a free local-first inventory genuinely beats what academics get from Benchling. |
| **Freezer / box / -80 storage map** | Quartzy (graphical box finder), Genemod (virtual freezer), eLabNext, Labguru | "Which box is my tube in" is the daily inventory pain. A grid box view reuses our plate-grid rendering. | High | Medium | Full. Reuses the plate component; pure local data. |
| **Built-in calculators (molarity, dilution, serial dilution, Tm, DNA-RNA, buffer recipe)** | LabArchives (Molarity, Dilution, DNA-RNA, Acid/Base Molarity calculators among 20+ widgets), NEB/IDT/Promega web tools | Cheap, delightful, removes a daily reason to leave the app. Direct LabArchives parity gap. | High | Small | Full. Pure client-side math, zero storage. Best effort-to-value ratio in this table. |
| **Biological registry: plasmid / antibody / cell line / strain / oligo** | Benchling, Labguru, Genemod (Cell Line, Enzyme, Plasmid, Antibody, Strain, Primer item types), eLabNext | Catalog of the lab's reusable biological materials, linkable to experiments. Antibody + plasmid are the two highest-traffic. Overlaps with the method-type registries above; could be one feature. | High | Medium-Large | Full as structured records. Sequence-aware features (plasmid maps) are the heavy part; the registry itself is light. |
| **Equipment booking / scheduling** | LabArchives Scheduler, Labguru, Genemod, eLabNext | Shared microscope / qPCR machine / centrifuge sign-up. Real friction for multi-person labs. | Medium | Medium | Partial. Single-machine local data is easy; true multi-user real-time booking needs the shared data folder to be the coordination layer. Works for our file-sync model but with last-write-wins caveats (no real-time lock). Mark as medium-feasibility. |
| **Instrument run log** | Genemod, Labguru (maintenance/calibration), eLabNext | Log of runs / maintenance / calibration per instrument (pairs with mass_spec calibration we already model). | Medium | Small | Full. Append-only structured log. |
| **Data charts / visualization widget** | SciNote (Project Insights: status, workload, due, bottlenecks), Labfolder data elements, LabArchives | Plot a numeric column (qPCR Cq, OD600, standard curve) inline. We have metrics/Gantt but no user-data charting. | Medium | Medium | Full. Client-side charting (we already render qPCR standard curves). |
| **Citation / reference manager** | RSpace (Mendeley integration), Benchling, eLabNext | Attach papers / DOIs to experiments. Academics live in Zotero/Mendeley. | Medium | Medium | Partial. A local DOI/BibTeX record + manual import is feasible; live Zotero/Mendeley sync needs their cloud APIs (out of scope or optional connector). |
| **Order / shipment tracking** | Quartzy, Genemod, Labguru | We have ordering + "ordered/received" status already; a *tracking-number / ETA* field and a "what's arriving" widget is a small extension. | Medium | Small | Full. Extends existing PurchaseItem. |
| **Lab safety / SDS sheet store** | Quartzy (SDS forms), LabArchives, Chemotion (chemical safety) | Attach SDS to chemicals; useful but lower daily value for small academic labs. | Low | Small | Full. Attach PDFs to inventory chemical records. |
| **Onboarding checklist widget** | LabArchives (To Do List, SOP widgets), Notion templates | New-member checklist (trainings, access, safety). We have weekly goals but not a reusable onboarding list. | Low | Small | Full. |
| **Grant / budget tracking (charts)** | Labguru, SciNote | We ALREADY have funding accounts + total_budget + burn-rate widget. Gap is only deeper budget *reporting* (per-category spend, forecast). | Low | Small | Full. Mostly already built. |
| **Literature feed (new papers in your area)** | scite, some ELN integrations | Auto-surface new relevant papers. | Low | Large | Low. Needs an external API / crawler; conflicts with no-server. Out of scope. |
| **Protocol-of-the-day** | (engagement pattern, not a real competitor feature) | Gentle re-engagement; surfaces an unused catalog template. | Low | Small | Full, but low value. |
| **Core-facility request form** | LabArchives (Core Facility Request Form widget) | For labs that run a shared service. Niche for our solo/small-lab target. | Low | Medium | Full. |
| **Mouse colony management** | Labguru, LabArchives (Mouse Colony Genotyping Report) | Breeding/genotype tracking. Pairs with animal protocol + strain registry. | Low | Large | Full but audience-specific. |

---

## OUR EXISTING DIFFERENTIATORS (do not lose these)

- **Local-first, data-ownership.** Data is a plain folder on the researcher's machine. No vendor lock-in, no cloud account, works offline, survives the company. No competitor surveyed is local-first by default (RSpace and OpenBIS are open-source but server-hosted).
- **Free and open-source for the core.** Benchling's free academic tier *excludes* inventory and registry; SciNote, Labguru, Quartzy, Genemod, LabArchives gate serious features behind paid plans. A free local-first inventory would beat what academics actually get for free elsewhere.
- **Version history + trash on every record.** Built-in, not a paid add-on.
- **Bundled source-PDF templates.** Structured method plus the original vendor PDF travels with it. Distinctive; lean into it for kit-insert templates.
- **By academics, for academics.** Solo-to-30-lab focus, PI mode, sharing, lab inbox tuned for academic group dynamics rather than industry compliance.
- **Composition primitive (`compound`).** LC + MS, PCR + qPCR analysis bundled into one reusable kit. Few ELNs model protocol composition this cleanly.

---

## Recommended first wave (build next)

1. **Reagent / consumable inventory (with location + lot + expiry + low-stock + "used in experiment").** The single most universal gap; closes the one feature every competitor has and we do not. Local-first feasible. It also unlocks linkage from methods/experiments ("this PCR consumed 2 uL of this enzyme stock"), which deepens our existing structured-method strength.
2. **Freezer / box (-80) storage map on top of inventory.** Highest daily-pain inventory feature; reuses our plate-grid component, so the incremental effort is small once inventory exists.
3. **Built-in calculator widget pack (molarity, dilution, serial dilution, Tm, DNA-RNA, buffer recipe).** Best effort-to-value ratio in the whole analysis: pure client-side math, zero storage, direct LabArchives parity, removes a daily reason to leave the app. Ship-able in parallel with inventory by a separate sub-bot.
4. **Two biological registry record types: plasmid/construct and antibody.** The highest-traffic registries, shaped like our existing structured method types, and they pair naturally with the new Western blot / IHC structured types (antibody dilutions) and PCR methods (plasmid templates). Start with registry records, defer the interactive sequence editor.
5. **Structured Western blot + spectrophotometry/Nanodrop method types, plus an immunology and microbiology template batch.** Upgrades two assays we already half-ship, fills the most glaring template-category holes (immunology, micro), and reuses the source-template-plus-snapshot pattern we have proven with `plate` and `qpcr_analysis`.

Rationale for the ordering: items 1-2 attack the one gap shared by *all* competitors and are the strongest local-first story we can tell. Item 3 is a quick parity-and-delight win deliverable in parallel. Items 4-5 deepen our actual strength (structured, reusable, vendor-grounded protocols) rather than chasing features (real-time collaboration, in-silico genome design) that fight our no-server architecture and that we cannot win.

Things to deliberately NOT chase (they fight local-first or our audience): real-time multiplayer editing, in-silico genome-aware sequence design (Benchling/SnapGene territory), heavy flow-cytometry gating engines (FlowJo), automated literature feeds, and cloud reference-manager sync. Document the panel/registry/record versions instead and link out.

---

Sources (primary evidence used):
- Benchling molecular biology, registry, inventory, and free academic plan: benchling.com/academic, benchling.com/primer-design-using-benchlings-molecular-biology-tools, help.benchling.com (Inventory), benchling.com/pricing; scispot.com Benchling pricing guide (academic tier excludes Registry and Inventory).
- SciNote inventory (low-stock alerts, barcodes, equipment), protocols, and Project Insights dashboard widgets: scinote.net/product, scinote.net/product/inventory-management, scinote.net/blog/scinote-new-project-insights-dashboard, knowledgebase.scinote.net.
- Labguru inventory, biocollections (plasmids/antibodies/cell lines/oligos/chemicals), equipment scheduling, protocol templates: labguru.com, labguru.com/inventory, labguru.com/equipment, labguru.com/blog (biocollections), help.labguru.com (protocol templates).
- eLabNext / eLabJournal inventory, sample types (cell lines, strains, antibodies), storage, equipment: elabnext.com/products/elabinventory, elabjournal.com/doc/Samples.html, eppendorf.com eLabJournal.
- RSpace open-source ELN + Inventory (containers/samples/subsamples, IGSN), integrations (Mendeley, etc.): researchspace.com, documentation.researchspace.com, lab-ally.com RSINV.
- Quartzy inventory, freezer-box graphical finder, order-request workflow, SDS, Quartzy Shop: quartzy.com/tour/inventory, quartzy.com/tour/order-requests.
- Genemod virtual freezers (Cell Line/Enzyme/Plasmid/Antibody/Strain/Primer item types), equipment scheduler, order management, ELN: genemod.net/products/virtual-freezers, genemod.net/products/equipments, genemod.net/eln-software.
- LabArchives widgets (20+, including Molarity / Dilution / DNA-RNA / Acid-Base Molarity calculators, inventory tracker), Scheduler, named widgets (Core Facility Request Form, Mouse Colony Genotyping Report, SOP, To Do List): labarchives.com/blog/labarchives-eln-for-research-integrations-and-widgets, labarchives.com/blog/discover-the-labarchives-widget-manager-and-library-a-new-era-of-eln.
- Labfolder material database / inventory, Labstep inventory + protocol library, Chemotion chemical inventory: labfolder.com/introducing-data-elements-material-database, labstep.com/inventory, chemotion.net/docs/eln/ui/inventory.
- SnapGene molecular cloning, plasmid maps, primer design, gel simulation, assembly methods: snapgene.com/features, snapgene.com/plasmids.
- FlowJo gating and panel/population analysis: flowjo.com/docs.
- Lab calculator suites (parity reference for the calculator widget): labcalc.org, benchcalc.com, nebiocalculator.neb.com, promega.com biomath, idtdna.com.
- Notion / Airtable lab-notebook, inventory, protocol templates: notion.com/templates/research-lab-notebook, revoltingscienceresources.com lab ordering & inventory template.

Confidence: feature *existence* per tool is well sourced above. Exact paid-tier limits, and competitors' full per-template library lists, are unverified (behind login); the category-level template gaps are inferred from standard technique coverage and advertised areas.

-- competitive-gap-analysis sub-bot of HR
