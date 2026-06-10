# Data Hub: research synthesis and proposed build plan

Data Hub is the proposed final major feature for ResearchOS, a free and open-source alternative to GraphPad Prism (statistical analysis plus scientific plotting) that lives inside the app. This doc synthesizes the five research streams under `docs/research/data-hub/` into a single positioning, architecture, and ranked build plan. The interactive decision version Grant marks up is `docs/mockups/data-hub-proposal.html`.

Research date 2026-06-10. Voice is plain and factual.

## The one-paragraph thesis

Prism and its peers are GUI wrappers around reproducible math. The hard part was never the statistics, those are settled and available as proven open-source code. The hard part is the workflow Prism nails: pick a table type, type raw replicates, get an automatic graph with error bars, run a guided analysis, and export a journal-ready figure, all live-linked so a data edit reflows everything. Data Hub wins by reproducing that loop on top of battle-tested OSS, running entirely client-side (no backend, data stays in the user's folder), and then beating Prism on the one axis that matters most for our actual users (bench scientists, not statisticians): a guided, plain-language test picker that checks its own assumptions. Because every analysis is a stored, re-runnable spec, Data Hub is also the most honest answer to the NIH reproducibility story we already tell.

## Architecture (decided by the OSS scout)

- No backend. Everything runs in the browser against the on-disk folder via the File System Access API, same as the rest of ResearchOS.
- Compute spine is native JS by default: `@stdlib/stats` (Apache-2.0, per-test packages) for hypothesis tests, `ml-levenberg-marquardt` + `ml-matrix` (MIT) for nonlinear curve fitting, with the parameter covariance / standard-error / confidence-interval step composed in-house (the one real piece of math we build, exactly how scipy `curve_fit` produces `pcov`).
- Plotting reuses what we already ship: `recharts` for common interactive charts plus a thin custom SVG layer on the `d3-scale` / `d3-shape` modules already in the bundle, for the Prism-specific figures (grouped error bars, fitted overlays, box, violin, Kaplan-Meier step). SVG-native means publication vector export is essentially free; PDF reuses `@react-pdf/renderer`.
- Spreadsheet I/O is `exceljs` (MIT) for the styled `.xlsx` round-trip, with `@formulajs/formulajs` (MIT) if we recompute imported formulas. Do not adopt `hyperformula` (GPLv3/commercial).
- Optional validated kernel: Pyodide (real scipy/statsmodels via WASM) offered as an explicitly opt-in, lazily-loaded path for advanced or reproducibility-critical analyses, never on the app-wide or even Data-Hub-default load path. WebR (R) rejected as primary (clunkier interop, R is GPL).
- Bundle impact of the native path is low tens of KB gz per analysis screen, well under the mathjs precedent the team already removed.

## Data model: the table-type insight

Prism's whole model is that you choose a table type first, and that choice drives which analyses appear, what graph auto-generates, and how error bars compute. We adopt the same model. Ranked by real wet-lab frequency:

1. Column table (highest volume). Groups side by side, replicates stacked. Western blot quant, ELISA, viability, qPCR ratios. Default column scatter with a t-test or one-way ANOVA and significance brackets is the single most-used Prism workflow in biology.
2. XY table (second). One X, multiple Y datasets with replicate subcolumns. Dose-response and time courses, the home of nonlinear regression.
3. Grouped table (third, more complex). Rows and columns are both categorical factors. Two-way ANOVA, interleaved bars.
4. Contingency / Survival / Parts-of-whole / Multiple-variables / Nested: progressively narrower; defer.

The two UX behaviors users actually love are mundane and must be nailed: automatic error bars from raw replicates with no analysis step, and the live-linked family where a data edit instantly reflows results and graphs. Our reactive local-first data layer is the natural home for the second.

## Analyses, ranked (the build order)

Tier 1, the core 80% of publications (Phase 1 target):
1. Unpaired t test (Welch default, equal-variance option, Mann-Whitney nonparametric fallback)
2. Paired t test (Wilcoxon signed-rank fallback)
3. One-way ANOVA with Tukey and Dunnett multiple comparisons
4. Two-way ANOVA with Tukey / Sidak / Bonferroni multiple comparisons
5. Nonlinear regression, 4PL variable-slope dose-response (EC50/IC50 with 95% CI)

Tier 2, frequent (Phase 2):
6. Mann-Whitney / Kruskal-Wallis + Dunn
7. Pearson / Spearman correlation
8. Kaplan-Meier survival + log-rank
9. Simple linear regression
10. Michaelis-Menten enzyme kinetics

Tier 3, specialized but common (Phase 3): one/two-phase exponential decay/association, contingency (Fisher / chi-square), receptor binding (saturation), Friedman, repeated-measures one-way ANOVA.

Tier 4, minority / candidates for the Pyodide kernel: ROC, Bland-Altman, multiple/logistic regression, three-way ANOVA.

## Graph types, ranked

Phase 1: bar with SD/SEM error bars plus significance brackets; column scatter / dot plot (individual points, the modern journal default); XY scatter with curve-fit overlay; XY line / time course.
Phase 2: before-after paired; box-and-whisker; Kaplan-Meier step; violin.
Later: pie (Parts-of-whole), volcano, and the Origin-borrowed heatmap-with-dendrogram.

Export targets that matter: SVG and PDF vector, hi-DPI PNG (journal 1200 dpi equivalent), and copy-to-clipboard for slides.

## Differentiators (where we beat Prism for our persona)

1. Guided test-selection wizard with an assumption Report Card. Ask 4-5 plain questions, recommend the test, auto-check normality and equal variance, fall back to the correct nonparametric test if assumptions fail, and report in plain language. This is the single highest-value idea from the competitor research (SigmaPlot, Minitab, Origin all converge on it) and it fits our concept-first, warm, explain-the-why voice exactly.
2. Select-the-graph-first, get a pre-shaped empty table showing how to enter the data. Kills the most common confusion point.
3. Cloneable figure templates (Origin idea): a graph's column-to-plot mapping reused on any structurally identical dataset. The reproducibility story applied to figures.
4. Reproducible analysis spec stored with the data, auto-re-runs on edit. Native to our model, and the honest core of the NIH data-management pitch.
5. Show-the-code (optional): since every analysis is a reproducible operation, surface the equivalent Python/R snippet. Reinforces the "point any AI at your own data" angle and the open, auditable positioning.
6. A public validation/transparency gate: every statistic and fit is checked against scipy / Prism reference values in a vitest gate, the same pattern as the existing `/transparency` page that compares our Tm/alignment math to Biopython. Correctness insurance plus a trust asset for the LabArchives flip.

## Spreadsheet pillar: the honest scope

Achievable client-side today: clean import of cell values, formulas as strings, multiple sheets, merged cells, and basic styles; structure detection (header rows, per-column types, wide-vs-long, multi-block) mapping an imported sheet onto a Column / XY / Grouped table; paste-from-Excel with transpose; export of our data and figures; `.xlsx` export with styling. Google Sheets works via the no-OAuth download/upload path, consistent with our stance.

Not achievable with any free, production-stable browser library today: faithfully round-tripping a native embedded Excel chart object. Both SheetJS and ExcelJS silently drop charts on read; the one MIT library that does charts is pre-1.0 alpha.

The realistic framing of the pillar: we read their data and formulas cleanly and re-plot natively in Data Hub (usually better), rather than literally preserving their Excel chart objects. Optionally recompute imported formulas in-browser via `@formulajs/formulajs`. This is a decision for Grant on how to message, captured in the proposal.

## Proposed phasing

- Phase 0: design lock, table-type data model, the reproducible-analysis spec, and the engine wrappers (stats + fitting + covariance/CI) behind a vitest validation gate against scipy/Prism reference values. The new top-level route also needs an `APP_ROUTE_TO_WIKI` entry and a wiki page or the build will refuse to deploy.
- Phase 1 (MVP): Column and XY tables, Tier-1 analyses, the core graphs, automatic error bars, the guided wizard v1, xlsx/CSV import with structure detection, and SVG/PNG export.
- Phase 2: Grouped table and two-way ANOVA, Tier-2 analyses, box/violin/Kaplan-Meier, significance-bracket polish, PDF and journal-DPI export, cloneable figure templates.
- Phase 3: Tier-3 analyses, the optional Pyodide validated kernel, show-the-code, and the advanced graph types.

## Source docs

- `prism-ui-and-workflow.md`: the eight table types, automatic graphing, the live-linked family, data entry, export.
- `prism-analysis-catalog.md`: the full statistics and curve-fitting catalog with the frequency ranking.
- `competitors-sigmaplot-origin.md`: the guided-wizard idea, select-graph-first, cloneable templates, the graph types Prism lacks.
- `spreadsheet-integration.md`: the honest browser-side `.xlsx` fidelity verdict.
- `oss-library-scout.md`: the recommended stack and the Pyodide-vs-native-JS architecture decision.
