> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.

## Mini-prep notes — 2026-05-09

Mini-prepping 8 candidate plasmid colonies pulled from the Gibson assembly plate (post task-18 follow-up batch). Want clean DNA for restriction-digest QC before sequencing.

### Reagents (per 5 mL overnight)

- P1 resuspension (4 °C, w/ RNase A): 250 µL
- P2 lysis (RT, fresh): 250 µL
- N3 neutralization (RT): 350 µL
- PB wash: 500 µL
- PE wash (with ethanol): 750 µL
- EB elution (pre-warm 50 °C): 30 µL

### Steps

1. Pellet 5 mL overnight @ 3000 × g, 5 min, RT. Decant.
2. Resuspend in P1, transfer to 1.5 mL tube.
3. Add P2, invert 4-6×, incubate 3 min RT.
4. Add N3, invert 4-6×, spin 13k rpm × 10 min.
5. Load supernatant onto column, spin 60 s.
6. Wash PB (60 s), wash PE (60 s), dry-spin 60 s.
7. Elute in 30 µL EB, sit 1 min RT, spin 60 s.

### Samples

- `pDEMO-cand-01` through `pDEMO-cand-08`

### Nanodrop readouts

| Sample | ng/µL | A260/280 | A260/230 |
|---|---|---|---|
| cand-01 | 142 | 1.88 | 2.12 |
| cand-02 | 118 | 1.85 | 2.05 |
| cand-03 | 96  | 1.84 | 1.95 |
| cand-04 | 134 | 1.89 | 2.18 |
| cand-05 | 88  | 1.79 | 1.62 (a bit low) |
| cand-06 | 121 | 1.86 | 2.08 |
| cand-07 | 107 | 1.83 | 2.00 |
| cand-08 | 145 | 1.90 | 2.21 |

All within the expected 80-150 ng/µL range. Cand-05 has a slightly low A260/230 — probably residual PE, re-elute if it gives a weird digest pattern.

TODO: write up the restriction-digest QC results in the results tab (still need to run the digest gel).
