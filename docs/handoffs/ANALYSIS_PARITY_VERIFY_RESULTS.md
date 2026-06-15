# Dataset-lane analysis parity — live verification results

Driven via Claude-in-Chrome against the running `:3000` (Grant's main), 2026-06-13.
Fixture: "Parity fixture" (48 rows × 14 cols), switched to large-table (DuckDB) mode.
Engine = the shared validated engine; this pass exercised the DuckDB readers + the
new dialog column-pickers feeding it.

## Verdict: 10 / 10 PASS (A2 dose-response bug FOUND + FIXED + re-verified live)

The original sweep was 9/10 with one real bug (A2 dose-response EC50 = 1.324e8).
Root-caused, fixed (unify on raw dose, see "The fix" below), and re-verified live:
A2 now reports **EC50 = 10.18, 95% CI 9.20–11.27, Top 95.21, Bottom 4.74,
R² 0.997, n 48** — matching the doc's ~10 / ~95 / ~5 expectation exactly.

Setup ✓ — manual-switch card reads **"Large-table mode"** (not "Large dataset detected"),
48×14, "runs on your computer … nothing uploads". Recent fix confirmed.

| # | Analysis | Picker labels seen | Result | Status |
|---|----------|--------------------|--------|--------|
| A1 | Linear regression | X column / Y column | slope 0.5457, R²=0.789 (r≈0.888), n=48 | ✅ PASS |
| A2 | Dose-response 4PL | X column / Y column | before: EC50 1.324e8, CI "-" → **after fix: EC50 10.18, CI 9.20–11.27, top 95.21, bottom 4.74, R² 0.997** | ✅ PASS (fixed) |
| A3 | Simple logistic regression | X column / Y column | slope +24.47, z 2.53, **p=0.011**, McFadden R²=0.925 | ✅ PASS |
| A4 | ROC curve and AUC | X column / Y (0/1 outcome) | AUC 1.000, 28 pos / 20 neg, Youden cut 0.48 | ✅ PASS |
| B5 | Two-way ANOVA | Value / Row factor / Column factor | treatment F(2,42)=354.45 p<.0001; timepoint F(1,42)=74.31 p<.0001; Day2 +4.2 | ✅ PASS |
| B6 | Chi-square / Fisher exact | Row factor / Column factor | M=Pos21/Neg3, F=Pos11/Neg13; χ²(Yates)=7.59 p=.0059; Fisher p=.0050; OR 8.27 | ✅ PASS |
| B7 | Survival analysis (KM) | Time / Event (0/1) / Group | ArmA median 27.0 (15/24 ev), ArmB median 7.1 (16/24 ev); log-rank χ²=11.75 p<.001 | ✅ PASS |
| B8 | Cox proportional hazards | Time / Event (0/1) / Group | HR ArmB vs ArmA = 3.81 (1.71–8.51), z 3.26, p=.0011 | ✅ PASS |
| B9 | Nested one-way ANOVA | Value / Group / Subgroup | 3 treatment groups, 6 operator subgroups; group F(2,3)=226.83 p<.001 | ✅ PASS |
| B10 | Nested t-test | Value / Group / Subgroup | Day1/Day2 (2 groups); diff 4.24, z 1.01, p=.311 (REML, 12 subgroups) | ✅ PASS |

Checks called out by the verify doc — all hold for the 9 passing:
- (setup) card = "Large-table mode" ✓
- (A) XY pickers read X / Y ✓
- (B) each whole-table analysis revealed its own role dropdowns (Value/Row/Column;
  Time/Event/Group; Value/Group/Subgroup) ✓
- (C) group structures read correctly: 3 treatment levels, the exact 2×2 counts
  (M 21/3, F 11/13), 2 survival arms, 6 nested subgroups ✓
- No thrown console errors during any analysis.

## The bug — dose-response EC50 (A2)

**Reported EC50 = 1.324e8** vs expected ~10 (≈7 orders of magnitude off). Reproducible.
Top/Bottom/R²/Hill are sane; **only the derived EC50 is wrong**, and its 95% CI renders
as "-" (a non-finite-CI fallback — `run-analysis.ts:1214-1216`).

### Root cause (confirmed in source)
The 4PL model contract is **x = log10(dose)** (`engine/fit/models.ts:7-8, 66-69`); it
reports `EC50 = 10^logEC50` (`models.ts:121`).

The live UI path never log-transforms the dose:
- `resolveXY` extracts the **raw** column and hands it to `runDoseResponse`
  (`run-analysis.ts:1484-1494`).
- `runDoseResponse` calls `fitModel(model, x, y)` with **raw x** — no `Math.log10`
  (`run-analysis.ts:1192`).

So the fitter finds `logEC50 ≈ 8.12` (the raw-conc half-max, which is reasonable in raw
space) and then exponentiates: `EC50 = 10^8.12 = 1.32e8`. With `x = log10(conc)` it would
fit `logEC50 ≈ 1.0` → `EC50 = 10` as the doc expects.

### Why the parity tests didn't catch it
`engine/__tests__/fit.test.ts` feeds **pre-log-transformed** x (`"x is log10(dose)"`,
line 58) straight to `fitModel`, and even has an explicit regression guard that EC50
lands near 10 and **"NOT at ~1e8"** (lines 104, 121-122). The engine is correct under its
contract. The test exercises `fitModel` in isolation; it never drives the **UI path**
(`runAnalysis` → `resolveXY` → `runDoseResponse`) with a **raw** dose column — which is
where the contract is violated. The ~1e8 failure the engine guards against has leaked into
production through the UI feed.

This is **not lane-specific** — `runDoseResponse` is shared, so any dose-response on raw
dose is affected, big-table or editable.

### The fix (landed — unify on raw dose, x auto-log10 internally)
Decision (Grant): treat the picked dose column as RAW dose everywhere and log10 it
inside the engine, so a user picks raw concentrations and EC50 comes back in linear
dose units. Implemented:

- `engine/fit/models.ts` — new `logXInput` flag on the NonlinearModel interface,
  set `true` on `logistic4pl` + `logistic5pl`; new exported helpers
  `modelExpectsLogX(id)` and `prepareFitData(id, x, y)` (drop non-positive doses,
  take log10) — re-exported through `engine/fit/index.ts` + `engine/index.ts`.
- `run-analysis.ts` — `runDoseResponse`, `runGlobalFit`, and `runModelComparison`
  run their dose column through `prepareFitData` before fitting (raw x/y kept for
  display; n from the fitted count).
- `plot-spec.ts` `resolveXYFit` + `plot-code.ts` — fit on the prepared data and
  evaluate the drawn curve at `log10(x)` for log-dose models, so the curve agrees
  with the EC50.
- `show-code.ts` — the emitted Python now takes `dose` and does
  `x = np.log10(dose)`, so the reproduction matches the analysis.
- Tests: every dose fixture that fed pre-log `log[dose]` migrated to a RAW dose
  column (10^grid) with the pinned scipy EC50 / Hill / F / AICc outputs unchanged
  (xy-analyses, analyses D1+D2, ai/datahub-analysis). Added a single-curve
  `runDoseResponse` raw-dose parity case asserting EC50 in linear dose units and
  NOT the ~1e8 failure — closing the engine-test blind spot (its reference fed
  already-log x).

Validation: `tsc` 0; `src/lib/datahub` 1058/1058 + `src/lib/ai/datahub-analysis`
138/138 green; live re-verify on :3000 → EC50 10.18 (CI 9.20–11.27), top 95.21,
bottom 4.74, R² 0.997. (Note: the engine's own `fit.test.ts` reference still feeds
log10(dose) directly to `fitModel`, which is unchanged — `prepareFitData` lives in
the analysis layer above it.)

## Housekeeping
- Two duplicate "Parity fixture" entries now sit under LARGE DATASETS (one prior-run
  leftover + one created this pass). Harmless test fixtures; safe to delete.
- No sharing/permission settings were touched.
