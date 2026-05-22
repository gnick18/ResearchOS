> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.

## Baseline growth profile — FakeYeast-001 in YPD

No-stress reference for the stress-tolerance project. Need a clean doubling-time number before we layer on heat / glucose perturbations.

### Setup

- Strain: `FakeYeast-001` (fresh streak from -80 glycerol, 2 days old)
- Media: YPD + 2% glucose, filter-sterilized
- Reader: BioTek Synergy H1, 30 °C, double-orbital shake 425 cpm
- Plate: Corning 96-well, flat-bottom, lid-on
- Sample IDs: `FY-BG-001` through `FY-BG-003` (biological triplicates from 3 independent overnight cultures)
- 200 µL volume per well, seeded at OD600 = 0.05
- Read interval: 15 min for 18 h

### Observations during run

- t=0 h: OD600 0.05 ± 0.01 across all wells (good seeding consistency)
- t=4 h: OD600 = 0.42 (mid-log, end of lag phase)
- t=8 h: OD600 = 1.18 (entering early stationary)
- t=14 h: plateau at OD600 ≈ 1.45

### Deviations

Reader gave a single spurious read at t=6.25 h (one well, edge of plate, OD600 = 0.001). Probably condensation under the lid. Excluded from the fit.

![Baseline growth curves — 3 biological reps](Images/growth-curve-baseline.png)
