> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.

# qPCR — verify fakeGFP transcripts in top 3 hits

Follow-up on the 8 hits from the fluorescence scan (task 2). Picking the top 3 by GFP/OD (B7, D11, G5) for transcript-level confirmation, plus WT + NTC controls. ACT1 as reference. Goal: confirm the GFP signal is bona fide transcript, not just plasmid background or autofluorescence.

## Samples (RNA extracted 2026-05-15 PM)

All extracted via the standard yeast hot-phenol miniprep on shared bench. RNA on TapeStation, RIN ≥ 8.5 for all 5 samples. Stored −80, freezer 3, box "M-T7-RNA-2026-05-15".

| Sample ID | Source                    | OD-norm. cells | RNA conc. (ng/µL) | RIN |
|-----------|---------------------------|----------------|-------------------|-----|
| M-T7-B7   | Hit B7, induced 6 h       | 2.0 × 10⁷       | 412               | 9.2 |
| M-T7-D11  | Hit D11, induced 6 h      | 2.0 × 10⁷       | 388               | 8.9 |
| M-T7-G5   | Hit G5, induced 6 h       | 2.0 × 10⁷       | 451               | 9.4 |
| M-T7-WT   | WT FY, induced 6 h        | 2.0 × 10⁷       | 405               | 8.7 |
| M-T7-NTC  | No-template control       | —              | —                 | —   |

## RT step

- 1 µg total RNA per sample, oligo-dT primer
- SuperScript-Demo II (lot DEMO-2025-08), shared bench freezer 4 box 1
- 42 °C, 50 min, then 70 °C, 15 min inactivation
- Diluted cDNA 1:5 in nuclease-free water before qPCR (gives clean Ct < 35 for ACT1 typically)
- **Also ran no-RT controls** per sample — see lab note 5 (reagent A expiration tracker) for the new lab rule

## Reagents (qPCR plate)

- 2× SYBR Master Mix (lot DEMO-2025-04, freezer 1 box A) — see note 5, opened 2026-04-12
- Primers (all 10 µM, freezer 2 rack B):
  - `fakeGFP-fwd` / `fakeGFP-rev` — amplicon ~145 bp, predicted Tm 82 °C
  - `ACT1-fwd` / `ACT1-rev` — amplicon ~120 bp, predicted Tm 80 °C
- cDNA, diluted 1:5
- Nuclease-free water (shared bench)

## Per-reaction recipe (10 µL total)

| Component             | Volume (µL) |
|-----------------------|-------------|
| 2× SYBR Master Mix    | 5.0         |
| 10 µM fwd primer      | 0.3         |
| 10 µM rev primer      | 0.3         |
| cDNA (1:5)            | 2.0         |
| Nuclease-free water   | 2.4         |

Made master mixes (sample × primer) for n=3 technical replicates per condition. Total wells used: 5 samples × 2 targets × 3 reps + 5 no-RT × 2 targets = **40 wells** on the 96-well plate.

## Cycling (qPCR)

- 95 °C, 3 min initial denaturation
- 40 cycles: 95 °C 15 s → 60 °C 60 s (anneal + extend)
- Default melt curve, 65 to 95 °C, +0.5 °C / 5 s

Loaded plate 2026-05-16 09:40, run started 09:55. Run takes ~95 min, melt curve +25 min. Should have results by lunch.

## Layout note

Per the new lab convention from the 2026-04-15 meeting (see note 3): no-template control on the **same plate** as the samples. Got 1 NTC per primer pair, plus the no-RT controls. Belt and suspenders.

## Quirks

- Re-aliquoted SYBR master mix on 2026-05-04, so this is a fresh tube — Ct values should be on the low end of normal for ACT1 (expect 18-20).
- Alex sent over the plasmid prep, going to image transformants tomorrow once these qPCR Cts confirm the hits are real. He's standing by for a thumbs-up before he starts the T7-B library construction Monday.
- The RT step at 42 °C ran a little hot (block read 42.6 °C at 30 min) — within spec but flagging.

## Next

- Analyze ΔΔCt (fakeGFP normalized to ACT1, hit normalized to WT) once the run finishes.
- If hits show ≥ 100× ACT1-normalized fakeGFP over WT, ship the figure to alex and start writing the chapter-2 result section this evening.
