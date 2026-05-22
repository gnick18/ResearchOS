> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.

## Pilot Gibson — backbone test

Testing the Gibson workflow before committing to the full pDEMO-fluo library build (task-9). 4 mock backbones, single insert (200 bp filler with 25 bp overlaps).

### Linearization

- pYES2 (5.86 kb) digested with EcoRI + XhoI, 37 °C, 60 min
- Gel-purified the 5.86 kb band (QIAquick column)
- Eluted in 30 µL EB → 48 ng/µL

### Gibson assembly mix (per rxn, 10 µL final)

| Reagent | Amount |
|---|---|
| 2× Gibson master mix | 5.0 µL |
| Linearized backbone (50 fmol) | 1.5 µL |
| Insert (100 fmol filler) | 0.8 µL |
| Nuclease-free H2O | 2.7 µL |

Incubate 50 °C × 60 min, then transform 2 µL into NEB 5-alpha competent cells.

### Notes

Backbone 4 looked smeary on the post-digest gel, kept it anyway as a negative control. Ran out of fresh Gibson mix mid-run — borrowed two aliquots from morgan's -20 box (label `GIB-2026-02-15`).

![Gibson backbone gel — linearization check](Images/gel-gibson-pilot.png)
