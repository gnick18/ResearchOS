> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.

## pDEMO-fluo plasmid library build (in-progress)

Building a fluorescent-reporter library: pYES2 backbone + GAL1 promoter + 12 candidate insertion sites (5'UTR variants) + fakeGFP. Library size target: ~12 variants × 3 codon-usage variants = 36 plasmids.

### 2026-05-20 — backbone prep

Re-digesting pYES2 stock (from task-18 lock-in) with EcoRI + XhoI. Gel-purifying the 5.86 kb linearized band. Yield 52 ng/µL × 30 µL = 1.56 µg total.

Fresh aliquot to morgan for her parallel screening prep — she has been short on backbone since the freezer cleanout (lab note #6).

### 2026-05-21 — insert PCRs

PCR-amplifying the 36 fakeGFP+5'UTR variant inserts from the IDT-ordered gene fragments. All 36 reactions use the same conditions (annealing 60 °C, extension 30 s for 750 bp inserts).

**Insert IDs:** `pDF-ins-001` through `pDF-ins-036`.

Ran a QC gel on 12 / 36 (every 3rd). All 12 show the expected 750 bp band, clean, no primer-dimer above background. Cleaning up all 36 with PCR purification columns tomorrow.

### TODO (rest of week)

- [ ] Wed: PCR cleanup all 36 inserts
- [ ] Wed: Gibson assembly, 36 reactions in 96-well format
- [ ] Thu: Transform into NEB 5-alpha, plate on LB + Amp
- [ ] Fri: Pick 4 colonies per variant (144 total), grow overnights in 96-well, glycerol bank
- [ ] Following week: mini-prep + Sanger sequencing all 144 — keep 2 sequence-perfect per variant for the final library

### Notes / human asides

Ran out of T4 ligase mid-cleanup — borrowed two aliquots from morgan's bench (label `T4-2026-05-09`). Need to add to next purchase order.

Will write up the full library QC + sequence-verification results once we hit the end-of-week milestone. For now this is just the bench-side build log.
