> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.

# Fluorescence reader scan — Plate M-T7-A-R

Reader-day for the joint FY-Δgal80 × pYES-fakeGFP screen. Plate came off the overnight at 8 AM, transfer + reader setup before 9.

## Sample IDs

- Deep-well source: **M-T7-A** (deep-well 96, AeraSeal, 30 °C / 200 rpm, 16 h induction)
- Reader plate: **M-T7-A-R** (Greiner 655096, black-wall clear-bottom)
- 50 µL/well transferred multichannel, corner wells = 50 µL sterile water

## Reader settings (BioTek H1, demo unit)

- Mode: top-read fluorescence + absorbance combo
- GFP: Ex 485 / Em 528, bandwidth 20/20, gain 60
- OD600: 600 nm, pathlength-corrected, 8 flashes / well
- Kinetic: read every 30 min, 13 timepoints (0 to 6 h)
- 30 °C, no shake during read (5 s linear shake before each read)
- Skip well H6 (bad-well flagged from task 7 baseline)

## Plate map (final)

- Col 1 rows B-G: WT FY (n=6, dropped 2 to corner-water buffer)
- Col 12 rows B-G: pDEMO-fluo+ positive (n=6)
- Col 2-11 rows B-G: 80 candidates → but **rows A and H now water** (edge effect from task 7)
- H6 specifically left empty (per the bad-well flag)

So actual sample n = 60 candidates + 6 WT + 6 positive = **72 sample wells**, 24 buffer/empty.

Lost 20 candidate slots to the edge-fix, but the variance gain is worth it — alex agreed last week.

## Workflow

1. Pre-warm reader 30 °C, lamp on 20 min before any read.
2. Read OD600 baseline (no shake, no buffer wells subtracted yet).
3. Read GFP — Ex 485 / Em 528, gain 60.
4. Start kinetic protocol.
5. Mid-run: snapshot CSV at t=180 min, push to analysis notebook.
6. End of run: export full CSV + push to `~/lab/joint-screen/2026-05-14-M-T7-A.csv`.

## Quirks

- Galactose smell strong in the deep-well — induction worked.
- Lid was a hair condensated after the overnight; wiped with kimwipe before reader transfer. No streaks.
- The reader took ~4 min to settle to 30 °C from cold — counted the lamp warmup against that. Total pre-run ~25 min.

## Running log

- **t=0 (08:55):** baseline OD600 + GFP read complete. CV across positive-control wells = 4.1% on GFP — under our 6% spec, good.
- **t=60 min:** positive-control wells starting to climb (~2500 RFU mean). Candidates mostly flat. WT essentially zero.
- **t=180 min:** mid-run CSV exported. Hit candidates emerging — visually ~10 wells climbing well above the noise floor. **Texting alex now to come look.**
- **t=360 min (final):** scan complete. Exported full CSV. Cleaning up and going home — analysis in the morning. Letting alex know the plate looked great so he can plan the qPCR follow-up for Saturday.
