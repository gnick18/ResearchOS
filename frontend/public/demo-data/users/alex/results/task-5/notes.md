> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.

## DemoCheck PCR screen — 2026-05-13

Screening all 8 transformants (T1-T8) + WT + empty-vector + water for the GAL1::flbA integration cassette. Expected band: **~1.4 kb** (URA3 5'UTR primer + flbA-internal primer).

### Reagents (per 25 µL rxn, ×16 incl. controls)

| Reagent | Stock | Per rxn |
|---|---|---|
| 5× HF Buffer | 5× | 5.0 µL |
| dNTPs | 10 mM | 0.5 µL |
| DemoCheck-fwd (URA3 5'UTR) | 10 µM | 1.25 µL |
| DemoCheck-rev (flbA-internal) | 10 µM | 1.25 µL |
| Phusion polymerase | 2 U/µL | 0.25 µL |
| gDNA template (50 ng/µL) | — | 1.0 µL |
| Nuclease-free H2O | — | 15.75 µL |
| **Total** |   | **25.0 µL** |

### Cycle conditions

| Step | Temp | Time | Cycles |
|---|---|---|---|
| Initial denaturation | 98 °C | 30 s | 1 |
| Denaturation | 98 °C | 10 s | 30 |
| Annealing | 58 °C | 20 s | 30 |
| Extension | 72 °C | 45 s | 30 |
| Final extension | 72 °C | 5 min | 1 |
| Hold | 12 °C | ∞ | — |

### Gel

1.5% agarose, 1× TAE, 100 V × 35 min. Loaded 10 µL/lane + 2 µL 6× loading dye. Ladder: NEB 1 kb plus.

Lane order: L | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | WT | EV | H2O.

![DemoCheck PCR screen — 1.5% agarose, expected band at ~1.4 kb](Images/gel-pcr-screen.png)
