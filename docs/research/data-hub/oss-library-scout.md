# Data Hub OSS Library Scout

Research findings for building "Data Hub", a free open-source GraphPad Prism alternative (statistical analysis plus scientific plotting) inside ResearchOS. ResearchOS is local-first with NO backend, everything runs in the browser, data lives in an on-disk folder via the File System Access API. The project is AGPLv3 and bundle-weight-conscious (precedent: mathjs was removed for adding ~104KB gz app-wide, swapped to expr-eval-fork ~8KB). We want to WRAP proven OSS math/plot/IO code, not reinvent statistics or curve fitting.

Date of research: 2026-06-10. Voice is plain and factual.

## Recommended stack (read this first)

- Stats engine: `@stdlib/stats` (Apache-2.0), installed as individual per-test packages (`@stdlib/stats-ttest`, `-ttest2`, `-anova1`, `-kruskal-test`, `-wilcoxon`, `-chi2gof`, `-chi2test`, plus `@stdlib/stats-base-dists-*` for CDF/quantile p-values). Richest test coverage of any JS stats lib, modular so we only ship the tests a given screen uses, native JS, no WASM.
- Distribution p-values and any test stdlib lacks (Mann-Whitney U, two-way ANOVA, Fisher exact, post-hoc Tukey/Dunn): compose ourselves on top of `@stdlib/stats-base-dists-*` CDFs. Keep `jstat` only as a fallback reference for `tukeyhsd`, do not standardize on it.
- Curve fitting: `ml-levenberg-marquardt` (MIT) for arbitrary nonlinear models (4PL dose-response, Michaelis-Menten, exponential, Gaussian) with initial guesses and `minValues`/`maxValues` bounds, plus `ml-matrix` (MIT) to build the parameter covariance matrix ourselves (LM returns parameter values and residual error only, NOT standard errors or CIs). For simple fixed forms reuse the `ml-regression-*` family (MIT).
- Linear algebra: `ml-matrix` (MIT), mature, has SVD/QR/LU/Cholesky/inverse/pseudo-inverse/eig. This is the workhorse for covariance-based standard errors and confidence intervals.
- Plotting: `recharts` (already in deps) for the common interactive scatter/bar/box charts, plus a thin custom SVG layer (we already ship the `d3-*` scale/shape primitives) for the things recharts does not do well (error bars on grouped bars, fitted-curve overlays, violin, Kaplan-Meier step). SVG-native means publication vector export is free. Keep Plotly.js OFF the default bundle; if we ever need its statistical chart breadth, load the cartesian partial bundle lazily and only on the Data Hub route.
- Spreadsheet I/O: `exceljs` (MIT) for the local-first xlsx read/write round-trip with styling, or `xlsx` SheetJS CE (Apache-2.0) if we want the smaller reader and do not need styled writes. Do NOT adopt `hyperformula` (GPLv3/commercial). If we need to recompute imported Excel formulas, use `@formulajs/formulajs` (MIT).
- Pyodide/WebR verdict: HYBRID, but default to native JS. Build the common analyses (descriptive stats, t-test, ANOVA, the nonparametrics, correlation, the standard curve fits) entirely in native JS so the Data Hub route stays light and instant. Treat Pyodide as an OPTIONAL, lazily-loaded "validated kernel" the user explicitly opts into for advanced or reproducibility-critical analyses (real scipy/statsmodels). Do not put any WASM runtime on the app-wide or even Data-Hub-default load path. WebR is the weaker option here and is not recommended as the primary kernel.

Rough bundle implication of the native path: stdlib per-test packages and the ml-* fitting/matrix libs are each small and tree-shakeable (low tens of KB gz combined for a typical analysis screen, far under the mathjs precedent). recharts and d3-* are already paid for. The only heavy thing, Pyodide (~7MB runtime plus ~10MB+ for numpy/scipy/pandas), is opt-in and lazy, so it never taxes a user who just wants a t-test.

---

## 1. Statistics and hypothesis tests

What ResearchOS already has: `expr-eval-fork` (expression parsing, not stats), `d3-scale`/`d3-shape` (no stats). No stats library is currently installed, so this is a clean adoption.

| Library | License | Maintenance | Bundle | Browser | What it actually implements | Rec |
|---|---|---|---|---|---|---|
| `@stdlib/stats` (modular per-test pkgs) | Apache-2.0 | Active, large org | Per-package, small + tree-shakeable | Yes, ESM/UMD/Deno builds | One-way ANOVA (`anova1`), 1-sample/paired `ttest`, 2-sample `ttest2`, Kruskal-Wallis (`kruskalTest`), Wilcoxon signed-rank (`wilcoxon`), chi-square GOF (`chi2gof`), chi-square test (`chi2test`), Levene, Fligner, Bartlett, F-test (`vartest`), Pearson corr test (`pcorrtest`), KS test (`kstest`), binomial test, z-tests. Full `dists` namespace: normal/t/F/chi2/beta/etc with pdf/cdf/quantile for composing any missing p-value. | ADOPT. Richest coverage, modular, native JS. |
| `jstat` | MIT | Slow; lowercase `jstat` is the live package, case-sensitive `jStat` retired | ~40KB-ish min, not strongly tree-shakeable | Yes | z-test, t-test (1/2 sided), ANOVA (`anovaftest`/`anovafscore`), F-test, Tukey HSD (`tukeyhsd`/`qtest`), normal/t CI, proportion tests, broad distributions (weibull/cauchy/poisson/beta/etc with pdf/cdf/inv). MISSING: Mann-Whitney, Kruskal-Wallis, chi-square GOF, Fisher exact, two-way ANOVA. | CONSIDER as a narrow fallback only for `tukeyhsd` if we do not want to port Tukey ourselves. Do not standardize on it. |
| `simple-statistics` | ISC | Active, widely used | Small | Yes | `tTest`, `tTestTwoSample`, `linearRegression`/`linearRegressionLine`, `rSquared`, `chiSquaredGoodnessOfFit`, correlation, descriptive stats, Bayesian classifier. CAVEAT: `tTest`/`tTestTwoSample` return the t statistic but NOT a p-value (open issue #354), so you still need a t-distribution CDF. No ANOVA, no nonparametrics. | CONSIDER for descriptive stats if we want a friendlier API, but stdlib supersets it for tests. |
| `science.js` | BSD-3 | Effectively dormant (D3 v3 era) | Small | Yes (old) | Basic stats and a little LM, but stale and unmaintained. | AVOID, stale. |

Tests we will have to compose ourselves on top of stdlib `dists` CDFs (none of the JS libs ship them cleanly): Mann-Whitney U / rank-sum, two-way ANOVA, repeated-measures ANOVA, Fisher exact, Dunn/Tukey post-hoc for the nonparametric path, Holm/Benjamini-Hochberg multiple-comparison corrections, Shapiro-Wilk normality (stdlib has KS and there is the Anderson-Darling route, but Shapiro-Wilk specifically is a port job). This is expected and is the right kind of work to do in-house since the underlying CDFs are battle-tested.

Sources: https://www.npmjs.com/package/@stdlib/stats , https://stdlib.io/docs/api/latest/@stdlib/stats , https://jstat.github.io/test.html , https://github.com/jstat/jstat , https://github.com/simple-statistics/simple-statistics/issues/354 , https://simple-statistics.github.io/docs/

## 2. Curve fitting / nonlinear regression (Prism's crown jewel)

The need: fit arbitrary user models (4-parameter logistic dose-response for EC50/IC50, Michaelis-Menten, one/two-phase exponential, Gaussian) with initial guesses and bounds, and return parameter standard errors and confidence intervals.

| Library | License | Maintenance | Browser | Arbitrary models? | Bounds? | SE / covariance / CIs? | Rec |
|---|---|---|---|---|---|---|---|
| `ml-levenberg-marquardt` | MIT | Active, v5.0.1 (Apr 2026) | Yes, TS->JS | YES, you pass a parameterized model fn and initial values | YES, `minValues`/`maxValues` | NO. Returns `parameterValues`, `parameterError` (residual), `iterations` only. No covariance matrix, no SE, no CIs. | ADOPT as the fitting engine, but we implement the covariance step. |
| `ml-regression-*` family (`-polynomial`, `-power`, `-exponential`, `-theil-sen`, `-robust-polynomial`, `-multivariate-linear`, simple linear) aggregated by `ml-regression` | MIT | Active, `ml-regression` v6.3.0 (May 2025) | Yes | NO, fixed model forms only | n/a | Linear forms give coefficients; not the nonlinear Prism models | ADOPT for the simple fixed-form fits (linear, polynomial, exponential, power) where a closed form exists; falls short of 4PL/Michaelis-Menten. |
| `regression-js` (`regression`) | MIT | Low activity | Yes, tiny | Only built-in forms (linear/exp/log/power/poly) | NO | NO | AVOID for serious work, no arbitrary models, no stats; fine only for quick trendlines. |
| `fmin` | BSD-3 | Dormant, last release v0.0.2 (Nov 2016), educational-grade | Yes | Yes via Nelder-Mead/conjugate-gradient as a generic minimizer | No native bound support | NO | AVOID. Stale and not purpose-built; LM is the better tool. |

The covariance gap (important, this is the in-house work): after `ml-levenberg-marquardt` converges, compute the Jacobian J at the solution (numerically), form `J^T J`, scale by the residual variance `s^2 = SSR/(n - p)`, invert via `ml-matrix` to get the parameter covariance matrix, take the sqrt of the diagonal for standard errors, and multiply by the t critical value (from stdlib's t-distribution quantile) for confidence intervals. This is exactly how scipy `curve_fit` produces `pcov`, and it is a modest, well-defined amount of code on top of two MIT libs we are already adopting. This is the single biggest "compose it ourselves" item for matching Prism.

Sources: https://github.com/mljs/levenberg-marquardt , https://www.npmjs.com/package/ml-regression , https://github.com/mljs/regression , https://github.com/benfred/fmin

## 3. Linear algebra / matrix

| Library | License | Maintenance | Browser | Provides | Rec |
|---|---|---|---|---|---|
| `ml-matrix` | MIT | Active, v6.12.2 (Apr 2026), maintained by Zakodium | Yes, ESM + CJS | Matrix arithmetic, SVD, QR, LU, Cholesky, eigendecomposition, inverse, pseudo-inverse, least-squares solve | ADOPT. Everything curve-fitting covariance and regression internals need. |
| `numeric.js` (`numeric`) | MIT | Dormant for years | Yes | Broad linear algebra and a generic optimizer, but old and unmaintained | AVOID, stale; `ml-matrix` is the modern equivalent. |

`ml-matrix` pairs naturally with `ml-levenberg-marquardt` (same Zakodium/mljs ecosystem, same MIT license) and is the keystone for producing standard errors and CIs.

Sources: https://github.com/mljs/matrix , https://www.npmjs.com/package/numeric

## 4. Plotting / charting

The bar is Prism-quality publication figures: grouped bar with SD/SEM error bars, XY scatter with fitted-curve overlays, box-and-whisker, violin, before-after, Kaplan-Meier step survival, AND clean vector export (SVG/PDF). ResearchOS already ships `recharts` and the `d3-*` primitives (`d3-scale`, `d3-shape`, `d3-selection`, `d3-interpolate`, `d3-transition`, `d3-zoom`).

| Library | License | Bundle (gz) | Vector export | Error bars | Box/violin | Sci-graph fit | Rec |
|---|---|---|---|---|---|---|---|
| `recharts` (already in deps) | MIT | Already paid for | SVG-native (DOM is SVG, easy to serialize) | `ErrorBar` component | Box no (composable), violin no | Good for scatter/line/bar; custom shapes possible | ADOPT for the common interactive charts, already a sunk cost. |
| Custom SVG via `d3-*` (already in deps) | n/a (our code, MIT d3) | Already paid for | SVG-native, perfect vector export | We draw them | We draw them | Best control for grouped error bars, fitted overlays, violin, KM step | ADOPT for the Prism-specific figures recharts cannot do cleanly. |
| `plotly.js` (full `plotly.js-dist-min`) | MIT | Very heavy, full dist ~3.5MB+ min and the npm bundle balloons to ~10MB unpacked | High-quality SVG via `toImage` | Yes, native | Yes, native box and violin | Excellent statistical-chart breadth | AVOID on the default bundle. CONSIDER only as a lazily-loaded cartesian partial bundle on the Data Hub route if custom SVG proves too much work. Weight is the dealbreaker for app-wide. |
| `vega-lite` (+ `vega`) | BSD-3 | Heavy (Vega runtime is large) | SVG renderer, good vector | Yes via layered specs | Yes (boxplot mark) | Strong, declarative, reproducible JSON specs | CONSIDER if we want spec-driven reproducible figures, but the runtime weight is large and it duplicates capabilities we get cheaper from d3. |
| `echarts` | Apache-2.0 | ~167KB gz | SVG renderer available | Custom | Box yes, violin via custom | Broad, themeable | CONSIDER, but heavier than recharts+d3 which we already have, and weaker pure-vector story than plain SVG. |
| `uplot` | MIT | ~48KB gz, very fast | Canvas-first (no clean SVG vector export) | Not native | No | Time-series/line focused | AVOID for Data Hub. Canvas export is raster, fails the publication-vector requirement, and lacks box/violin/error-bar primitives. |
| `chart.js` | MIT | ~60-70KB gz | Canvas (raster) | Plugin only | Plugin only | Dashboard-grade, not publication | AVOID, canvas raster export and weaker scientific primitives. |
| D3 (full) | ISC/BSD | We only ship submodules | SVG-native | We draw | We draw | Maximal control, most work | We already use the relevant submodules; no need to add full D3. |

Plotting recommendation: lean on what is already in the bundle. Use `recharts` for the everyday interactive scatter/bar/line, and a small in-house SVG chart layer built on the `d3-scale`/`d3-shape` modules we already ship for the Prism-specific figures (grouped error bars, fitted-curve overlays, box/violin, Kaplan-Meier step). SVG-native output means publication-quality vector SVG export is essentially free, and PDF export can reuse the existing `@react-pdf/renderer` dependency or an SVG-to-PDF pass. Keep Plotly.js available only as a lazily-loaded escape hatch on the Data Hub route, never app-wide, because its weight is exactly the kind of cost the team removed mathjs to avoid.

Sources: https://github.com/plotly/plotly.js/ , https://www.npmjs.com/package/plotly.js , https://github.com/leeoniya/uPlot , https://bundlephobia.com/package/echarts , https://npm-compare.com/chart.js,d3,plotly.js,vega-lite

## 5. Spreadsheet I/O

ResearchOS already ships `jszip` and `fflate` (xlsx is a zip of XML, so the zip layer is covered), `exceljs` is NOT currently a dependency, and there is NO xlsx lib installed today.

| Library | License | Bundle | Read | Write + styling | Browser local-first | Rec |
|---|---|---|---|---|---|---|
| `exceljs` | MIT | Moderate (tens of KB to low hundreds gz) | Yes (File/ArrayBuffer) | Yes, full styling (fonts, fills, borders, number formats, merges, images); writes Uint8Array/Blob | Yes, works in-browser; may need polyfills on old browsers | ADOPT for the round-trip if we need styled writes. MIT is clean. |
| `xlsx` (SheetJS CE) | Apache-2.0 | ~300KB min (mini build available) | Yes, broad format support and robust parsing | Writes work, but cell STYLING is a Pro (paid) feature in CE | Yes, identical across browser/node | CONSIDER for read-heavy import where styling is not needed; the smaller mini build is attractive. Styling paywall is the catch. |
| `hyperformula` | GPLv3 / commercial | Large | n/a (formula engine) | n/a | n/a | AVOID. Copyleft/commercial, conflicts with the permissive-dependency rule. ~400 Excel functions but not worth the license. |
| `@formulajs/formulajs` | MIT | Small-moderate | n/a | n/a | Yes | ADOPT (only if we actually need to recompute imported Excel formulas in-browser). Maintained MIT fork of formula.js, ~400 Excel functions, the permissive answer to HyperFormula. |

Spreadsheet recommendation: `exceljs` (MIT) for a true local-first read/write round-trip with styling, falling back to SheetJS CE `xlsx` (Apache-2.0) only if we want the leaner reader and do not need styled output. For recomputing imported formulas, `@formulajs/formulajs` (MIT), never HyperFormula. Note this category cross-references a sibling bot; the license verdict (exceljs MIT good, HyperFormula GPLv3 avoid) is the load-bearing part of this read.

Sources: https://www.npmjs.com/package/exceljs , https://bundlephobia.com/package/exceljs , https://www.npmjs.com/package/xlsx , https://docs.sheetjs.com/ , https://github.com/handsontable/hyperformula , https://www.npmjs.com/package/@formulajs/formulajs

## 6. The Pyodide / WebR question (the architectural fork)

This is the big decision. Two ways to get battle-tested correctness instead of reimplementing stats in JS.

### Pyodide (CPython + numpy/scipy/pandas/statsmodels via WASM)

- Load size: ~7MB for CPython plus stdlib, then packages on top. numpy plus pandas is roughly another ~10.5MB in a typical app; scipy alone is ~10MB brotli-compressed (~35MB uncompressed). statsmodels IS an official Pyodide package now, as are numpy, scipy, pandas, scikit-learn, matplotlib.
- First-load latency: multi-second on a good connection for the runtime, more once scipy/statsmodels are pulled in. After first load, the browser HTTP cache (and a service worker or self-hosting the wheels from our own `public/` folder) makes subsequent loads fast and fully offline-capable. Self-hosting the wheels fits ResearchOS's local-first ethos and avoids a CDN dependency.
- JS/UI interop: mature. You pass JS arrays/typed-arrays into Python, call scipy/statsmodels, and get results back as JS objects. Plotting stays in JS (feed the numeric results to recharts/our SVG layer); we would not use matplotlib for the UI.
- Offline/caching: feasible. Wheels can live in the on-disk app assets; a service worker serves them. No network needed after first cache.
- Tradeoff: enormous weight that must NEVER be on the app-wide or Data-Hub-default path, but it gives the real, citable, reproducible scipy/statsmodels numbers the lab mentioned, with zero reimplementation risk.

### WebR (real R via WASM)

- Downloads R plus requested CRAN-WASM package binaries at startup from a CDN; uses a Service Worker for offline. Per-package install/`library()` cost varies a lot and some packages (Matrix, mgcv) are notably slow to load in WASM.
- R is the lingua franca of a lot of bench statistics, so correctness and method coverage are excellent, but the JS interop is clunkier than Pyodide's and the package-load performance is more uneven. Self-hosting and offline are possible but more finicky.
- Verdict within the fork: weaker than Pyodide as a primary kernel for a JS app. Keep it only as a possible future power-user option, not the recommendation.

### Verdict: (c) HYBRID, defaulting to native JS

Build the common 80% in native JS (stdlib tests, ml-* fitting, recharts/d3 plotting) so the Data Hub route is light and instant and works with no extra download. Offer Pyodide as an OPTIONAL, explicitly-opted-into "validated kernel" for advanced or reproducibility-critical analyses (real scipy/statsmodels), lazily loaded and ideally self-hosted from app assets for offline use. This keeps the bundle discipline the team cares about while giving labs a path to citable, reproducible, server-grade statistics when they want it. Do not adopt WebR as the primary kernel; native-JS plus optional-Pyodide is the right shape.

Sources: https://pyodide.org/en/stable/usage/downloading-and-deploying.html , https://pyodide.org/en/stable/usage/packages-in-pyodide.html , https://github.com/pyodide/pyodide/issues/1365 , https://docs.r-wasm.org/webr/latest/ , https://docs.r-wasm.org/webr/latest/packages.html

---

## License flag summary

- Permissive and safe to adopt: `@stdlib/stats` (Apache-2.0), `ml-levenberg-marquardt` / `ml-matrix` / `ml-regression-*` (MIT), `simple-statistics` (ISC), `jstat` (MIT), `recharts` (MIT), `d3-*` (ISC/BSD), `plotly.js` (MIT), `echarts` (Apache-2.0), `uplot` / `chart.js` (MIT), `exceljs` (MIT), `xlsx` SheetJS CE (Apache-2.0), `@formulajs/formulajs` (MIT), Pyodide (MPL-2.0, components include numpy/scipy/pandas under BSD), WebR (R itself is GPL, relevant if we ever ship it).
- FLAG, do not adopt as a permissive dependency: `hyperformula` (GPLv3 or paid commercial). Even though AGPLv3 can technically include GPLv3 code, the team's rule is permissive-only, so treat this as a copyleft avoid and use `@formulajs/formulajs` instead.
- Stale / avoid on quality grounds: `fmin` (2016), `numeric.js`, `science.js`, `regression-js` for serious fits.
- License note on WebR: R is GPL, so a Pyodide (MPL/BSD stack) kernel is the cleaner choice if we ever ship a WASM compute spine inside an AGPLv3 app that wants permissive deps.
