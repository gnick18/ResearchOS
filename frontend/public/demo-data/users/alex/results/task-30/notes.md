> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.

## qPCR — fakeGFP expression vs control (in-progress)

Measuring `flbA` transcript abundance in the 6 positive transformants (T1, T2, T4, T6, T7, T8 from task-5) ± galactose induction, vs WT and empty-vector controls. Reference gene: `ACT1`.

Primer pair locked in from earlier qPCR optimization (lab notes #5, run 2026-04-22): 60 °C anneal, 200 nM primers, melt curve clean.

### 2026-05-13 — RNA extraction kickoff

Pulling 6 colonies × 2 conditions (uninduced 2% glucose vs induced 2% galactose, 4 h post-shift) + 2 controls (WT, EV) = 16 samples.

Reagents per sample:

- TRIzol: 1 mL
- Chloroform: 200 µL
- Isopropanol: 500 µL
- 75% EtOH wash: 1 mL × 2
- DEPC-H2O: 30 µL final

Cultures harvested at OD600 = 0.6 (mid-log), pellet snap-frozen in LN2 before TRIzol step. DNase treatment with DNase I (Thermo, 2 U) for 30 min @ 37 °C, then cleanup column.

Nanodrop check:

- All 16 samples between 480-820 ng/µL, A260/280 = 1.94-2.05 (RNA-clean), A260/230 ≥ 2.0
- Spike-in dilution: 1 µg total RNA → 20 µL cDNA via SuperScript IV, random hexamers

### 2026-05-14 — RT done, qPCR plate prep tomorrow

All 16 cDNAs synthesized cleanly. Diluting 1:5 for the qPCR template tomorrow.

**Plate layout** (96-well, 384-well reader booked for Friday backup):

- Each cDNA × 2 genes (flbA + ACT1) × 3 technical reps = 6 wells per sample
- 16 samples × 6 = 96 wells — fits exactly on one plate, no minus-RT control space. Adding -RT controls only for samples T1, T6, WT (3 representative).

### TODO

- [ ] Pour qPCR plate Friday AM
- [ ] Run on QuantStudio 5, 40 cycles, melt curve enabled
- [ ] ΔΔCt vs ACT1, normalize to WT-uninduced
- [ ] Plot fold-change with biological triplicate error bars

Results writeup will land in the results tab post-run.
