# Published-result validation candidates for /transparency

DISCOVERY ONLY (calculator manager sign-off). This is a ranked list of peer-reviewed
papers and canonical reference records that state BOTH the inputs AND the reported
numeric result for a calculation our engine performs, so we can later feed the paper's
inputs to our engine and show our output matches the published number.

Every number below is a VERBATIM quote from the cited source. The orchestrator MUST
independently re-fetch each source and re-transcribe the numbers before anything is
pinned. WebFetch mangles numeric tables, so treat each quote as a pointer to the exact
passage, not a trusted value. Where I could not extract a paired number verbatim, the
candidate is marked RESULT-ONLY or flagged with the gap.

Engine module map (for the orchestrator):
- Restriction digest -> `frontend/src/lib/sequences/cut-ligate.ts` (digest golden tests live in `digest.golden.test.ts`)
- Translation / ORF -> `frontend/src/lib/sequences/orf.ts` + `translation.ts` (golden `translation.golden.test.ts`)
- Primer Tm (nearest-neighbor) -> `frontend/src/lib/calculators/tm-nn.ts`
- qPCR efficiency / doubling time / molarity -> `frontend/src/lib/calculators/scientific.ts` + `calculators.ts`

Reproducibility key:
- REPRODUCIBLE = every input AND the reported result are present in the quoted text.
- RESULT-ONLY = the result is stated but at least one required input is missing (do NOT pin; kept as examples of what not to use).

---

## Tier 1 - REPRODUCIBLE (recommended)

### A. Restriction digest (STRONG, canonical reference sequences)

These are the most bulletproof cases. The input sequence is a public accession the
orchestrator can re-fetch verbatim from NCBI, the enzyme is universal, and the fragment
sizes are textbook constants printed on every ladder datasheet.

#### A1. Lambda phage DNA / HindIII complete digest (8 fragments)
- Input sequence: Enterobacteria phage lambda, GenBank **J02459** (= NC_001416).
  - LOCUS quote (re-fetched verbatim, NCBI efetch):
    `"LOCUS       LAMCG                  48502 bp    DNA     linear   PHG 06-JAN-2020"`
    Source: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=J02459&rettype=gb&retmode=text
- Enzyme: HindIII.
- Reported fragment sizes (bp), from the canonical lambda/HindIII ladder. Thermo Fisher
  application note lists them verbatim:
  `"2027 2322 4361 6557 9416 23130"` plus 564 and 125 (8 fragments total: 23130, 9416, 6557, 4361, 2322, 2027, 564, 125).
  Source (re-fetchable PDF): https://documents.thermofisher.com/TFS-Assets/GSD/Application-Notes/dsdna-capillary-electrophoresis-appnote.pdf
  Vendor datasheet corroboration (Thermo SM0101): https://assets.fishersci.com/TFS-Assets/LSG/manuals/MAN0012986_Lambda_DNA_HindIII_Marker2_250ug_UG.pdf
- Maps to: `cut-ladder` digest. NOTE: lambda is linear, so 7 cuts -> 8 fragments. Engine
  must treat the molecule as linear (the GenBank record says `linear`).
- Open access: yes (GenBank + vendor datasheets).
- Flag: **REPRODUCIBLE** (sequence accession + enzyme + all 8 sizes all stated).
- Caveat for orchestrator: confirm whether the engine reports the cos-end fragments
  joined (heating to 65C anneals the 23130+4361 cohesive ends); the "uncut" gel value
  differs from the in-silico cut. Use the in-silico 8-fragment list as the oracle.

#### A2. pUC19 / single-cutter linearization
- Input sequence: pUC19, GenBank **L09137** (synthetic, 2686 bp circular).
  - LOCUS quote (re-fetched verbatim):
    `"LOCUS       SYNPUC19CV              2686 bp    DNA     circular SYN 22-MAY-2002"`
    Source: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=L09137&rettype=gb&retmode=text
- Enzyme: EcoRI (single site in the MCS) -> one linear 2686 bp fragment; or a
  double digest the orchestrator can define from the annotated sites.
- Maps to: `cut-ligate.ts` digest.
- Open access: yes.
- Flag: **REPRODUCIBLE** for the total-length / single-cut case (2686 bp is stated in
  the LOCUS line). For multi-fragment double digests the orchestrator must read the
  enzyme site coordinates from the same GenBank record (they are in the FEATURES table)
  rather than trusting any secondary source.

---

### B. Translation / ORF (STRONG, RefSeq/GenBank state the protein verbatim)

GenBank/RefSeq CDS features carry BOTH the nucleotide coordinates AND the full
`/translation` amino-acid string. The orchestrator feeds the CDS nucleotides to our
ORF/translate engine and checks the output equals the record's `/translation`. These are
about as clean as validation gets because the "published result" is in the same record
as the input.

#### B1. Human insulin (INS) preproprotein
- Record: **NM_000207.3** (RefSeq mRNA), protein **NP_000198.1**.
- Verbatim (re-fetched, NCBI efetch):
  - `"CDS             60..392"`
  - `/product` = `"insulin preproprotein"`
  - `/protein_id` = `"NP_000198.1"`
  - `/translation` =
    `"MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN"`
  - Source: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=NM_000207.3&rettype=gb&retmode=text
- Check: CDS 60..392 = 333 nt = 110 codons + stop -> 110 aa preproprotein. Our translate
  of the CDS slice must equal the `/translation` string exactly.
- Maps to: `orf.ts` / `translation.ts`.
- Open access: yes (RefSeq).
- Flag: **REPRODUCIBLE** (input CDS coordinates + full output protein both in-record).

#### B2. Enhanced GFP (EGFP)
- Record: **U55762** (synthetic plasmid carrying egfp), protein **AAB02574.1**.
- Verbatim (re-fetched):
  - `"LOCUS       CVU55762                4733 bp    DNA     circular SYN 22-AUG-2003"`
  - `"CDS             679..1398"`, `/gene="egfp"`, `/codon_start=1`,
    `/product="enhanced green fluorescent protein"`, `/protein_id="AAB02574.1"`
  - `/translation` =
    `"MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK"`
  - Source: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=U55762&rettype=gb&retmode=text
- Check: CDS 679..1398 = 720 nt = 240 codons (239 aa + stop). Our translate must equal
  the `/translation` (239 aa). NOTE the GenBank `/transl_table` and `/codon_start` -
  honor them.
- Maps to: `orf.ts` / `translation.ts`.
- Open access: yes.
- Flag: **REPRODUCIBLE**.

> Translation strategy note: any RefSeq mRNA with a CDS feature works the same way, so
> the orchestrator can scale this domain to many cases cheaply (e.g. NM_002046 GAPDH,
> NM_001101 ACTB). Two well-known ones (insulin, EGFP) are enough to anchor the page;
> add more only if we want breadth.

---

### C. qPCR amplification efficiency (MODERATE - reproducible ONLY when slope is also stated)

Engine relationship: E% = (10^(-1/slope) - 1) * 100. Reproducible iff the paper states
BOTH the slope and the efficiency. The big finding is that MOST reference-gene papers
report efficiency WITHOUT the slope (see "what not to use" below), so clean cases are
scarce. The wastewater-surveillance literature is the exception because it audits slopes
and efficiencies together.

#### C1. SARS-CoV-2 RT-qPCR (CDC N1 / N2), wastewater meta-analysis
- Citation: "Variability in RT-qPCR assay parameters indicates unreliable SARS-CoV-2 RNA
  quantification for wastewater surveillance." PMC8341816.
  Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8341816/
- Verbatim quotes (RE-FETCH AND RE-TRANSCRIBE - WebFetch read these out of a results
  paragraph and may have paired the wrong %):
  - CDC N1: `"the mean standard curve slope was -3.29"` and `"the mean reported efficiency was 101% (median 95.8%)"`
  - CDC N2: `"a mean slope of -3.46 (95%)"`
  - Range example: `"the reported slopes ranged from -3.60 (90%) to -2.40 (161%)"`
- Maps to: `scientific.ts` qPCR efficiency.
- Open access: yes (PMC, CC-BY).
- Flag: **REPRODUCIBLE but VERIFY** - these are mean/range summary values, not a single
  clean assay row. Best used as: "given the paper's stated slope of -3.46, our engine
  computes ~94.5% efficiency, matching the paper's stated 95%." The orchestrator must
  re-fetch the exact slope/efficiency pairing because the summarizer may have mismatched
  them, and a single -3.60 -> 90% pair is the cleanest single data point.

#### C2. Pfaffl 2001 relative-quantification model (per-gene efficiencies)
- Citation: Pfaffl MW (2001) "A new mathematical model for relative quantification in
  real-time RT-PCR." Nucleic Acids Res 29(9):e45. DOI 10.1093/nar/29.9.e45.
  OA sources: https://academic.oup.com/nar/article/29/9/e45/2384081 ; PMC55695 ;
  https://www.gene-quantification.de/pfaffl-nar-2001.pdf
- Verbatim (from OUP HTML): the paper reports real-time PCR efficiencies of
  `"TyrA, 2.09; PyrB, 2.16; and Gst, 1.99"` derived via `E = 10^[-1/slope]`.
- Flag: **RESULT-ONLY (slope not extracted)**. The E values are reported as the fold per
  cycle (so %E = (E-1)*100, e.g. 2.09 -> 109%), but I could NOT extract the matching
  per-gene SLOPE verbatim. If the orchestrator re-fetches and finds the slopes (likely in
  the same figure/table), this upgrades to REPRODUCIBLE. Until then, do not pin.

---

### D. Doubling time / growth rate (STRONG formula, but published two-point inputs are rare)

Engine relationship: Td = (t2 - t1) * ln(2) / ln(N2/N1), growth rate mu = ln(N2/N1)/(t2-t1).
Reproducible iff the paper gives two timepoints + their OD/counts + the reported Td.
This is the hardest domain: papers report a FITTED rate over many points, not two clean
inputs, and the canonical E. coli result is stated without the raw pair.

#### D1. E. coli MG1655 in LB (canonical doubling time) - RESULT-ONLY
- Citation: Sezonov G, Joseleau-Petit D, D'Ari R (2007) "Escherichia coli Physiology in
  Luria-Bertani Broth." J Bacteriol 189(23):8746-8749. PMC2168924.
  Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC2168924/
- Verbatim: `"The doubling time during steady-state growth in Luria-Bertani broth was 20 min"`
  (E. coli K-12 MG1655, 37C, aeration).
- Flag: **RESULT-ONLY**. The 20 min is a fitted steady-state value; the paper does not
  give a single OD1/t1, OD2/t2 pair we can feed the engine. Excellent as a sanity anchor
  / "matches the textbook 20 min" narrative, NOT as a reproducible input->output case.
  Listed deliberately as the type of case to AVOID pinning.
- Maps to: `scientific.ts` doubling time.

> Honest gap: I did not find a primary OA paper that prints two clean OD timepoints AND
> the derived doubling time in the same passage. If we want a REPRODUCIBLE growth case,
> the realistic path is a worked textbook/JoVE example (e.g. a stated "OD went from X at
> t1 to Y at t2, doubling time = Z") rather than a research article. The orchestrator
> should source one deliberately or present doubling time as a formula demonstration
> rather than a published-result reproduction.

---

## Tier 2 - "What NOT to use" (RESULT-ONLY examples, for calibration)

- Reference-gene qPCR papers that report **efficiency without slope**: e.g.
  - Spinacia oleracea reference genes, PMC7875621
    (https://pmc.ncbi.nlm.nih.gov/articles/PMC7875621/): the table lists
    `"Actin ... 99.36 ... 0.999"`, `"EF1a ... 102.80 ... 0.995"`, `"GAPDH ... 93.56 ... 0.999"`
    but the slope column is absent; text says only `"E = 10 - 1/slope"`. NOT reproducible
    by our slope->efficiency engine.
  - Turbot gonad reference-gene dataset, PMC4133071: Table 7 gives efficiencies per
    method (e.g. `"ACTB LREanalyzer 97.82% LinRegPCR 87.12%"`) but no paired slope.
  - Maize reference genes, PLOS ONE 10.1371/journal.pone.0095445: text says
    `"PCR efficiencies of the primers ranged from 93.1% to 102.6%"` - a range, no slopes.
  These illustrate the dominant failure mode: efficiency reported, slope omitted.

---

## Coverage summary by domain

| Domain | Engine module | Reproducible candidates | Result-only / gaps |
|---|---|---|---|
| Restriction digest | cut-ligate.ts | A1 lambda/HindIII, A2 pUC19 | - |
| Translation / ORF | orf.ts, translation.ts | B1 insulin (NM_000207.3), B2 EGFP (U55762); scalable to any RefSeq CDS | - |
| qPCR efficiency | scientific.ts | C1 SARS-CoV-2 (verify pairing) | C2 Pfaffl (slope not yet extracted) |
| Doubling time | scientific.ts | (none clean) | D1 E. coli LB 20 min (no raw pair) |
| Primer Tm | tm-nn.ts | (none) | - |
| CFU per mL | scientific.ts | (none found with all inputs) | - |
| Molarity / prep | calculators.ts | (none reported in literature) | - |

### Honest assessment of findability
- EASY, rock-solid: **restriction digest** and **translation**. The input is a public
  accession we can re-fetch verbatim and the result is a textbook constant or the
  record's own `/translation`. These should anchor the "validated against published
  results" section.
- MODERATE: **qPCR efficiency**. The math is trivially reproducible, but papers
  overwhelmingly report efficiency without the slope; only audit/meta papers (wastewater)
  reliably print both. Usable with one clean slope->efficiency pair, with a caveat.
- HARD / essentially absent in primary literature:
  - **Doubling time**: papers report a fitted rate, not two feedable timepoints; the
    canonical 20-min E. coli value has no raw pair. Use a worked example or present as a
    formula demo, not a paper reproduction.
  - **Primer Tm**: Tm is method-dependent (SantaLucia/Wallace/etc.) and papers rarely
    state the exact salt + oligo conc + method needed to reproduce the printed number, so
    a clean published-with-inputs Tm case basically does not exist. Keep Tm validated
    against tool oracles (Biopython/primer3), not against a published Tm.
  - **CFU/mL** and **molarity/solution prep**: raw inputs (plate counts, dilution, volume
    plated / MW + target conc + volume + mass) are almost never all stated together.
