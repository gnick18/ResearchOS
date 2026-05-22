> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.

# BioTek H1 baseline + standard curve

Pre-flight check before any GFP screening this quarter. Reader has been sitting since the holiday shutdown; running fluorescein standard + empty-plate noise before alex hands over the first transformant batch.

## Reagents

- Fluorescein sodium salt stock — 10 µM in PBS (made 2026-03-10, stored 4 °C, foil-wrapped). Aliquot in freezer 3, rack B, slot 4.
- PBS (1×, sterile) — shared bench stock
- Black-wall clear-bottom 96-well plate (Greiner 655096) — box on shelf 1

## Dilution series

Fresh per run. 7 concentrations, 3 reps each:

| nM   | µL 10 µM stock | µL PBS  |
|------|----------------|---------|
| 0    | 0              | 200     |
| 25   | 0.5            | 199.5   |
| 50   | 1              | 199     |
| 100  | 2              | 198     |
| 200  | 4              | 196     |
| 350  | 7              | 193     |
| 500  | 10             | 190     |

Pipette in subdued bench light — fluorescein bleaches faster than I keep remembering.

## Reader settings

- BioTek H1 (lab unit, demo serial DEMO-H1-A)
- Mode: top-read fluorescence
- Ex 485 / Em 528, bandwidth 20/20
- Gain: 60 (matches the screen we'll run on the FY-Δgal80 transformants)
- 4 reads / well, 100 ms each, no shake
- Plate type: Greiner 655096

## Empty-plate noise

Same plate, all 96 wells filled with 60 nM fluorescein in PBS, 3 reads/well, no other changes. Goal: characterize well-to-well CV before we start interpreting differences in actual samples.

## Quirks

- Lamp on for 20 min before any reads (warmup curve is real, learned the hard way 2025-Q3).
- Lid OFF for fluorescence (condensation = scatter = bad).
- Door fully closed even between reads — ambient bench fluorescence bleeds in if it's cracked.

## Notes for me

- Scope booked Tue 9-noon for the dissection scope (transformant pick prep).
- Cleaned lamp housing per the BioTek docs link before the run, dust film was visible.
- If R² drops below 0.99 the lamp is on its way out — order replacement now, do not wait.
