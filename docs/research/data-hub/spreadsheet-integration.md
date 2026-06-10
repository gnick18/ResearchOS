# Spreadsheet Integration for Data Hub: Technical Research

**Date:** 2026-06-10
**Scope:** Client-side (browser, no backend) xlsx round-trip, Google Sheets interop, table detection heuristics, honest assessment of what is achievable.

---

## 1. What a Spreadsheet User Already Expects

### 1.1 Excel Analysis ToolPak

The Analysis ToolPak is an Excel add-in (File > Options > Add-Ins) offering 19 statistical tools:

| Tool | What it does |
|---|---|
| ANOVA: Single Factor | One-way ANOVA across 2+ groups |
| ANOVA: Two-Factor with Replication | Two-way with multiple obs per cell |
| ANOVA: Two-Factor without Replication | Two-way, single obs per cell |
| Correlation | Pearson correlation matrix |
| Covariance | Covariance matrix |
| Descriptive Statistics | Mean, median, mode, std dev, skewness, kurtosis, min, max, count |
| Exponential Smoothing | Forecasts via prior-period error correction |
| F-Test Two-Sample for Variances | Tests equality of two variances |
| Fourier Analysis | Fast Fourier Transform for periodic data |
| Histogram | Binned frequency table |
| Moving Average | N-period moving average forecast |
| Random Number Generation | Fill range from several distributions |
| Rank and Percentile | Ordinal and percent ranks |
| Regression | OLS linear regression with residuals, plots |
| Sampling | Random or periodic sample from a range |
| t-Test: Paired | Paired-sample mean test |
| t-Test: Two-Sample Equal Variances | Student's t (pooled variance) |
| t-Test: Two-Sample Unequal Variances | Welch's t |
| z-Test: Two-Sample for Means | z test with known population variance |

**Critical limitation for import:** ToolPak output is static. The tool writes computed values into a destination range; it does not insert formulas that update when data changes. This means exported xlsx files containing ToolPak output tables contain plain numbers, not live references. Source: [Microsoft Support](https://support.microsoft.com/en-us/office/use-the-analysis-toolpak-to-perform-complex-data-analysis-6c67ccf0-f4a9-487c-8dec-bdb5a2cefab6)

### 1.2 Excel Chart Types

Excel supports these chart families natively (relevant to what users may embed in xlsx files sent for import):

- Column (clustered, stacked, 100% stacked)
- Line (with or without markers, stacked)
- Pie / Doughnut
- Bar (same as column, horizontal)
- Area (standard, stacked, 100% stacked)
- Scatter (XY) — the primary scientific chart type
- Bubble
- Radar
- Stock
- Combo (mixed series types)
- Modern types (Waterfall, Histogram, Pareto, Funnel, Treemap, Sunburst, Box & Whisker, Map)

Source: [Microsoft Support — Create a chart](https://support.microsoft.com/en-us/office/create-a-chart-from-start-to-finish-0baf399e-dd61-4e18-8a73-b3fd5d5680c2)

### 1.3 Trendlines and Built-in Regression

Trendlines are attached to individual data series within chart objects. The six types:

- **Linear** — straight best-fit line, suitable for steady-rate trends
- **Logarithmic** — curved, models rapid then leveling change
- **Polynomial** — curved, order 2–6, for fluctuating data
- **Power** — curved, for power-law relationships
- **Exponential** — curved, for accelerating growth/decay
- **Moving Average** — smoothing over N periods

Each trendline can display its equation and R-squared value on the chart. These are chart metadata elements (stored as `c:trendline` XML inside the chart part), not worksheet formulas. They live and die with the chart object itself.

Source: [Microsoft Support — Trendline options](https://support.microsoft.com/en-us/office/trendline-options-in-office-92157920-fee4-4905-bc89-6a0f48152c52), [OOXML c:trendline spec](https://c-rex.net/projects/samples/ooxml/e1/Part4/OOXML_P4_DOCX_trendline_topic_ID0EALIRB.html)

---

## 2. The Browser JS Library Landscape for .xlsx

### 2.1 How XLSX Files Store Charts

An xlsx file is a ZIP archive of XML parts following the Open Packaging Convention (OOXML/ECMA-376). Charts are stored in separate `/xl/charts/chartN.xml` parts using DrawingML (`c:` namespace), referenced from worksheet drawing relationships (`/xl/drawings/drawingN.xml` → `_rels/`). Cell data and chart data are in separate parts. A library that only processes the `xl/worksheets/` parts will silently discard the drawing parts if it re-zips the archive.

### 2.2 SheetJS (the `xlsx` npm package)

**Distribution status:** SheetJS moved off the public npm registry in 2022 due to a legal dispute with npm, Inc. The package `xlsx` on npmjs.com is frozen at v0.18.5. Current releases come from `cdn.sheetjs.com` or the SheetJS Gitea instance at `git.sheetjs.com`. Source: [BleepingComputer](https://www.bleepingcomputer.com/news/software/npm-package-with-14m-weekly-downloads-ditches-npmjs-com-for-own-cdn/)

**Community Edition round-trip support:**

| Feature | Support |
|---|---|
| Cell values (strings, numbers, booleans, dates) | Full |
| Multiple sheets | Full (via `SheetNames[]`) |
| Merged cells | Full (stored in `ws['!merges']`) |
| Formulas (reading) | Full — formula strings stored in cell `f` property, A1 notation, en-US function names |
| Formulas (evaluation/calculation) | None — "this library will not automatically compute formula results" |
| Number formats (reading) | Opt-in via `cellNF: true`; stored in `z` property |
| Cell styles (colors, fonts, borders) | Read with `cellStyles: true` but not written back on re-export — confirmed broken by SheetJS team, who direct users to Pro Edit |
| Embedded charts | Silently dropped. Issue #111 on the old GitHub repo ("Charts in file breaks roundtrip") confirmed charts caused parser confusion and were not preserved. |
| Images | Dropped (community edition) |
| Pivot tables | Dropped (community edition) |
| Defined names | Supported |
| VBA / macros | Dropped |

Sources: [SheetJS CE docs — Formulae](https://docs.sheetjs.com/docs/csf/features/formulae/), [SheetJS CE docs — Number Formats](https://docs.sheetjs.com/docs/csf/features/nf/), [SheetJS issue #3214 — cellStyles round-trip broken](https://git.sheetjs.com/sheetjs/sheetjs/issues/3214), [SheetJS GitHub issue #111 — charts break roundtrip](https://github.com/SheetJS/sheetjs/issues/111)

**SheetJS Pro** adds: chart read/write (`c:chart` ChartSheet parsing and generation), formula evaluation engine (separate add-on), cell styling with round-trip fidelity ("Pro Edit"), PivotTable processing, password protection. Commercial license required; pricing by team size. Source: [SheetJS Pro page](https://sheetjs.com/pro/)

**Community Edition style workaround:** The community forks `xlsx-js-style` (by gitbrent) and `sheetjs-style` add a style object (`fill`, `font`, `alignment`, `border`, `numFmt`) on top of CE. These forks allow writing new styles but do NOT fix the read-modify-preserve problem — they are for generating styled files from scratch, not round-tripping existing styled files. Last meaningful release was several years ago; maintenance is minimal. Source: [xlsx-js-style GitHub](https://github.com/gitbrent/xlsx-js-style)

### 2.3 ExcelJS

**Status:** MIT licensed. Last meaningful npm release was October 2023; project maintainers have acknowledged the library is minimally active. 15,000+ GitHub stars, 655 open issues.

| Feature | Support |
|---|---|
| Cell values | Full |
| Multiple sheets | Full |
| Merged cells | Full (non-streaming mode) |
| Formulas | Read and write formula strings; cannot evaluate — "ExcelJS cannot process the formula to generate a result, it must be supplied" |
| Cell styles (fonts, fills, borders, alignment) | Full on write; read-back is supported |
| Number formats | Full |
| Embedded charts | Destructively dropped on read. Issue #1734 (June 2021) confirmed: read a file with charts, modify, write back — charts gone. Issue #2607 (December 2023) is an open feature request for chart passthrough — no resolution as of research date. |
| Images | Supported (add images to worksheets) |
| Pivot tables | Not supported |
| Defined names | Partial |

Sources: [ExcelJS GitHub](https://github.com/exceljs/exceljs), [ExcelJS issue #1734](https://github.com/exceljs/exceljs/issues/1734), [ExcelJS issue #2607](https://github.com/exceljs/exceljs/issues/2607)

**Bundle size caveat:** ExcelJS is large and bundles poorly — polyfills and internal helpers are duplicated many times across the output. It does not tree-shake well. Source: [ExcelJS Discussion #1790](https://github.com/exceljs/exceljs/discussions/1790)

### 2.4 xlsx-populate

MIT licensed but effectively unmaintained — last release February 2019. Designed around a "keep existing features intact" philosophy but no chart support. A scoped fork `@xlsx/xlsx-populate` shows minor recent activity. Not recommended for production. Source: [xlsx-populate GitHub](https://github.com/dtjohnson/xlsx-populate)

### 2.5 xlsx-kit (new, MIT, pre-1.0)

A newer MIT library (pre-1.0 alpha as of mid-2025) that explicitly models DrawingML charts. Claims to support 16 legacy `c:` chart types plus 8 modern `cx:` types (Sunburst, Treemap, Waterfall, Histogram, Pareto, Funnel, Box & Whisker, RegionMap). For things it cannot fully model (pivot tables, VBA, OLE), it preserves them as byte-identical passthrough so Excel still renders them. Formula support covers normal, array, shared, and data-table varieties. Style support covers font, fill, border, alignment, protection, number formats, named styles.

**Caveats:** Pre-1.0 alpha — APIs may shift. Not yet battle-tested at scale. Source: [xlsx-kit GitHub](https://github.com/baseballyama/xlsx-kit)

### 2.6 Commercial Full-Fidelity Options

**SpreadJS (GrapeCity/Mescius)** — a complete in-browser spreadsheet UI component backed by a C++/WASM formula engine (500+ functions), 30+ chart types, full xlsx import/export including charts. Designed to replace Excel in-browser. Commercial license, expensive. Not a file-conversion library but a complete spreadsheet component. Source: [SpreadJS](https://developer.mescius.com/spreadjs)

### 2.7 Summary Comparison Table

| Library | Values | Formulas (store) | Formulas (eval) | Styles (round-trip) | Charts (round-trip) | Active? |
|---|---|---|---|---|---|---|
| SheetJS CE | Full | Full | None | Broken | Dropped | Yes (paid CDN) |
| SheetJS Pro | Full | Full | Add-on | Full | Read+Write | Yes |
| ExcelJS | Full | Full | None | Full | Dropped | Minimal |
| xlsx-populate | Full | Partial | None | Partial | Dropped | No |
| xlsx-kit | Full | Full | None | Full | Full (16+8 types) | Pre-1.0 alpha |
| SpreadJS | Full | Full | Full (WASM) | Full | Full (30+ types) | Yes (commercial) |

---

## 3. Google Sheets: No-Auth Path and Its Limits

### 3.1 File-Based Round-Trip (No OAuth)

The workflow that requires no OAuth:

1. User opens their Google Sheet in a browser tab.
2. File > Download > Microsoft Excel (.xlsx) — a direct file download, no third-party auth required.
3. User drags the downloaded file into ResearchOS's importer.
4. ResearchOS reads and displays the data.
5. For export back, user downloads the xlsx ResearchOS generates and re-imports into Google Sheets via File > Import > Upload.

This workflow is fully browser-based and requires zero credentials on our side.

### 3.2 What Survives the Download to XLSX

Preserved:
- All standard formulas shared with Excel (SUM, VLOOKUP, IF, COUNTIF, INDEX/MATCH, AVERAGE, STDEV, etc.)
- All sheets, sheet names, order
- Merged cells, frozen panes, column widths, row heights
- Bold, italic, colors, borders, number formats
- Data validation (dropdowns, rules)
- Charts — bar, line, pie, scatter export as native Excel chart objects, not images
- Conditional formatting (with some loss on complex multi-condition rules)

Lost on download to xlsx:
- Google-specific functions: QUERY (replaced by last computed values — the data survives but the formula is gone), IMPORTRANGE (becomes static), GOOGLEFINANCE, SPARKLINE, IMAGE, IMPORTDATA, IMPORTHTML, IMPORTXML, IMPORTFEED, DETECTLANGUAGE, GOOGLETRANSLATE
- Apps Script code, custom menus, triggers — silently removed
- Dynamic array spill behavior may differ from Excel's

Source: [Google Sheets Export Formats guide](https://changethisfile.com/blog/google-sheets-export)

### 3.3 What Happens to Trendlines

Excel trendlines are stored as `c:trendline` child elements inside chart XML parts. When Google Sheets exports a chart to xlsx, it produces a native Excel chart object. When that chart is re-imported into Google Sheets, axis settings and advanced trendline formatting commonly reset to defaults. So a trendline created in Google Sheets may survive as a trendline in the xlsx file, but formatting (colors, equation display) often reverts on the return trip. Basic trendline existence generally survives; precise styling does not.

### 3.4 Google Sheets API Without OAuth

The Sheets API v4 requires authentication even for publicly shared sheets — a direct API call without credentials returns HTTP 403. An API key (not OAuth) works for read-only access to public sheets, but the project's stated preference is to avoid server-side credential management. The file-download/upload path is the right choice here: it requires no credentials, no API key, and no backend, and it delivers a standard xlsx file that any import library can parse.

Source: [Latenode community thread on Sheets API auth](https://community.latenode.com/t/accessing-google-sheets-api-v4-without-oauth-authentication-methods/21556)

---

## 4. Clean Import UX: Table Detection Heuristics

### 4.1 The Core Problem

Real-world xlsx files from labs are not clean single-table CSVs. A single sheet may contain:
- A results table starting in row 3 (rows 1–2 are lab name and date)
- A second summary table starting below a blank row
- Units and sample identifiers in merged cells above column headers
- Mixed text notes scattered in otherwise numeric columns
- Wide format (each replicate is a column) vs. long format (one row per observation)

### 4.2 Established Detection Heuristics

Based on practices from Origin's import wizard, pandas read_excel, and hybrid heuristic approaches documented in the literature:

**Step 1 — Find table boundaries:**
- Treat runs of fully empty rows as table separators. A blank row is the most reliable boundary signal.
- Apply density analysis: calculate the fraction of non-empty cells in a sliding window. Regions above ~30% density are candidate tables; sparse regions are separators.
- Flag merged cells in early rows — these almost always indicate a title or sub-header, not data.

**Step 2 — Identify the header row:**
- The header row is typically the last row of predominantly text content before the first row of predominantly numeric content.
- Validate: if at least N/2 of the cells in the candidate header row are strings, and the next row has mostly numeric cells, treat it as the header.
- Watch for multi-level headers (units in a second row under labels) — a sub-header row immediately below the primary header row that is entirely text or has units-like content (µg/mL, %, min, etc.) is a units row.

**Step 3 — Infer column data types:**
- Scan the first 10–20 data rows per column. Assign a type of: numeric, text, date, or mixed.
- Consistent column types across rows signal a coherent table structure. A column that is 90%+ numeric is a data column; 90%+ text may be a label/category column.

**Step 4 — Detect wide vs. long format:**
- Long format: one numeric data column, plus one or more categorical columns. Each row is one observation.
- Wide format: multiple numeric columns with the same unit and a shared header label pattern (e.g., "Rep1", "Rep2", "Rep3" or "Group A", "Group B"). The column headers are a grouping variable.
- Heuristic: if the column headers of the numeric block are themselves a meaningful categorical series (time points, treatment names, replicate numbers), the data is wide. If there is a single "value" column alongside category columns, it is long.

Sources: [Hybrid Excel processing approach (front10.com)](https://blog.front10.com/articles/excel-processing-hybrid-approach/), [Origin Import Documentation](https://docs.originlab.com/origin-help/import-excel), [GraphPad Prism table type guide](https://www.graphpad.com/guides/prism/latest/user-guide/using_data_table_format.htm)

### 4.3 Mapping to Prism-Style Table Types

Prism uses eight table types. The import heuristic should offer a mapping suggestion, not a forced classification.

| Detected Shape | Suggested Prism Type |
|---|---|
| One numeric column + one or more category columns (long) | Column table |
| Wide format: columns are replicates of the same group | Column table (values stacked per group) |
| First column is numeric X, remaining columns are Y values | XY table |
| First column is numeric X, remaining columns are grouped Y subcolumns | XY table with replicates |
| Two categorical axes with counts in cells | Contingency table |
| Time-to-event data with event/censored flag | Survival table |
| Multi-block sheet with clearly independent tables | Prompt user to select which block |

**Important:** Prism's own documentation states "whenever possible, transfer data from Excel using copy and paste. Importing Excel files directly is rarely helpful." This is because the rigid Prism table-type model does not map cleanly onto free-form Excel layouts. A good importer should preview the detected structure and let the user confirm or override the column-to-type mapping before committing. Source: [Prism 11 user guide — table formats](https://www.graphpad.com/guides/prism/latest/user-guide/using_data_table_format.htm)

---

## 5. The Honest Verdict

### 5.1 What Is Easy (Do This Now)

- **Cell values:** Every major library handles this reliably, including SheetJS CE and ExcelJS. Numbers, strings, booleans, dates, and null cells all parse correctly.
- **Multiple sheets:** All libraries support multi-sheet workbooks. Presenting a sheet picker on import is trivial.
- **Merged cells:** SheetJS CE and ExcelJS both expose merge metadata. The importer can use this to identify title rows and headers.
- **Number formats:** SheetJS CE supports number format round-trips with `cellNF: true`. ExcelJS handles number formats well on both read and write.
- **Basic table detection:** Empty-row boundary detection and the text-then-numeric header heuristic are reliable for clean lab data and can be implemented in ~100 lines.
- **Formula strings (display only):** SheetJS CE reads formula strings faithfully. Showing the user "this cell contains =AVERAGE(B2:B20)" as metadata is achievable without any formula engine.
- **Google Sheets file import:** The manual File > Download > xlsx path delivers a standard xlsx file. All standard formulas survive as formula strings (we can display them), charts survive as chart objects (we cannot render them yet, but we do not corrupt them if we use the right library).

### 5.2 What Is Hard but Possible

- **Formula evaluation:** HyperFormula (MIT, browser-native, 418 functions) can evaluate Excel-compatible formulas in the browser. It is not 100% Excel-equivalent — some compatibility and cube functions are absent, and there are documented behavioral differences — but it covers the common statistical functions (AVERAGE, STDEV, CORREL, T.TEST, LINEST, etc.) that science lab users rely on. The integration pattern: parse formula strings from SheetJS, feed them into a HyperFormula instance, expose the computed values alongside raw values. This is achievable but requires careful handling of cross-sheet references and absolute vs. relative addressing. Source: [HyperFormula](https://hyperformula.handsontable.com/), [HyperFormula built-in functions](https://hyperformula.handsontable.com/guide/built-in-functions.html)

- **Cell style round-trip:** ExcelJS reads and writes styles correctly for generated files. For preserving styles in an existing file through a modify-and-re-export cycle, the choice is xlsx-kit (pre-1.0 alpha), SheetJS Pro (paid), or accepting that minor style loss will occur. For Data Hub's core use case (import data, analyze, export results), style loss on the output is acceptable as long as the input data is read correctly.

- **Defined names / named ranges:** SheetJS CE supports defined names. They can be used as table aliases in the importer.

### 5.3 What Is Effectively Not Feasible Client-Side (Be Honest with the Lab)

- **Preserving embedded Excel charts through a round-trip:** Both SheetJS CE and ExcelJS destructively drop chart XML when re-writing an xlsx file. The charts are gone. The only paths around this are: (a) xlsx-kit, which is pre-1.0 alpha and carries risk; (b) SheetJS Pro (paid); (c) SpreadJS (expensive commercial UI component). For a local-first research app with no backend, none of these are a clean answer today. The realistic approach is to tell users: "Your data is imported correctly. Existing charts in the Excel file are not currently displayed or preserved in ResearchOS — you can recreate them using Data Hub's chart tools."

- **Faithfully replicating Analysis ToolPak outputs as live analyses:** ToolPak output is static values. There is nothing to "import" in a dynamic sense. The appropriate behavior is to read the values as data. If the user wants to reproduce the analysis, Data Hub should offer its own statistical tests that cover the same 19 tools.

- **Rendering Excel trendlines as live regression fits:** Trendline parameters are stored inside chart XML (`c:trendline`). Since chart XML is dropped on round-trip by the common libraries, trendline metadata does not survive. Even if it did, rendering it would require a chart engine. The correct approach is to let the user run a new regression on the imported data values within Data Hub.

- **VBA macros:** Not applicable in a local-first browser app and not expected.

- **Power Query / data model / slicers tied to the data model:** These are Excel-desktop-specific features and do not survive any export to standard xlsx used by third-party tools.

- **Google Sheets-specific formulas (QUERY, IMPORTRANGE, GOOGLEFINANCE):** These become static values on xlsx export by design. Data Hub will see the last computed values, which is correct behavior — nothing more can be preserved here without the Sheets API.

### 5.4 Recommended Pillar Scope for Data Hub

Based on this research, the realistic feature scope for the "clean Excel/Sheets integration" pillar, in priority order, is:

**Tier 1 (ship at launch):**
- Import xlsx via File System Access API drag-drop or open-file dialog
- Multi-sheet workbook: present a sheet picker, show preview of each sheet
- Table detection: empty-row boundary, text-then-numeric header heuristic, column type inference
- Map detected tables to Column / XY / Grouped table types with user confirmation step
- Show formula strings as metadata (read-only), not evaluated
- Export back to xlsx: values + number formats + basic styles using ExcelJS
- Google Sheets workflow: document the File > Download > xlsx path clearly in the UI

**Tier 2 (next iteration):**
- Formula evaluation via HyperFormula for the ~418-function common subset
- Handle multi-block sheets (detect and let user select which block to import)
- Style round-trip for generated xlsx outputs (not read-modify-preserve of originals)

**Tier 3 (defer or never):**
- Chart round-trip (pending xlsx-kit 1.0 stability, or if the lab is willing to take a dependency on SheetJS Pro)
- Full Analysis ToolPak output capture (data values import fine; live re-computation is a Data Hub statistical analysis feature, not an import feature)

### 5.5 The One Clear Constraint to Communicate to Stakeholders

The lab's stated wish — "existing functions or plots in an Excel table integrate in cleanly and export cleanly" — is partially realizable. Functions (as evaluated numbers) survive import cleanly; formula strings survive for display. Plots do not survive through any free, production-ready, client-side library today. This is not a ResearchOS limitation; it is a gap in the open-source ecosystem. The OOXML chart format is complex enough that the two dominant libraries (SheetJS CE, ExcelJS) both chose not to implement it. The only path to full chart round-trip without a paid dependency is xlsx-kit at 1.0 maturity, which is not there yet.

---

## Sources

- [Microsoft Support — Analysis ToolPak](https://support.microsoft.com/en-us/office/use-the-analysis-toolpak-to-perform-complex-data-analysis-6c67ccf0-f4a9-487c-8dec-bdb5a2cefab6)
- [Microsoft Support — Create a chart](https://support.microsoft.com/en-us/office/create-a-chart-from-start-to-finish-0baf399e-dd61-4e18-8a73-b3fd5d5680c2)
- [Microsoft Support — Trendline options](https://support.microsoft.com/en-us/office/trendline-options-in-office-92157920-fee4-4905-bc89-6a0f48152c52)
- [OOXML c:trendline spec](https://c-rex.net/projects/samples/ooxml/e1/Part4/OOXML_P4_DOCX_trendline_topic_ID0EALIRB.html)
- [SheetJS CE documentation](https://docs.sheetjs.com/)
- [SheetJS CE — Formulae](https://docs.sheetjs.com/docs/csf/features/formulae/)
- [SheetJS CE — Number Formats](https://docs.sheetjs.com/docs/csf/features/nf/)
- [SheetJS CE — Merged Cells](https://docs.sheetjs.com/docs/csf/features/merges/)
- [SheetJS issue #3214 — cellStyles round-trip](https://git.sheetjs.com/sheetjs/sheetjs/issues/3214)
- [SheetJS issue #111 — charts break roundtrip](https://github.com/SheetJS/sheetjs/issues/111)
- [SheetJS Pro features](https://sheetjs.com/pro/)
- [BleepingComputer — SheetJS leaves npm](https://www.bleepingcomputer.com/news/software/npm-package-with-14m-weekly-downloads-ditches-npmjs-com-for-own-cdn/)
- [ExcelJS GitHub](https://github.com/exceljs/exceljs)
- [ExcelJS issue #1734 — charts lost on round-trip](https://github.com/exceljs/exceljs/issues/1734)
- [ExcelJS issue #2607 — chart passthrough feature request](https://github.com/exceljs/exceljs/issues/2607)
- [ExcelJS issue #141 — chart support request](https://github.com/exceljs/exceljs/issues/141)
- [xlsx-js-style GitHub](https://github.com/gitbrent/xlsx-js-style)
- [xlsx-populate GitHub](https://github.com/dtjohnson/xlsx-populate)
- [xlsx-kit GitHub](https://github.com/baseballyama/xlsx-kit)
- [PkgPulse — SheetJS vs ExcelJS comparison](https://www.pkgpulse.com/guides/sheetjs-vs-exceljs-vs-node-xlsx-excel-files-node-2026)
- [HyperFormula](https://hyperformula.handsontable.com/)
- [HyperFormula built-in functions](https://hyperformula.handsontable.com/guide/built-in-functions.html)
- [SpreadJS](https://developer.mescius.com/spreadjs)
- [Google Sheets Export Formats](https://changethisfile.com/blog/google-sheets-export)
- [Google Sheets API auth without OAuth](https://community.latenode.com/t/accessing-google-sheets-api-v4-without-oauth-authentication-methods/21556)
- [GraphPad Prism 11 — table types](https://www.graphpad.com/guides/prism/latest/user-guide/using_data_table_format.htm)
- [Selecting models for XY, Column, Grouped tables in Prism](https://www.projectguru.in/xy-columns-grouped-tables/)
- [Origin — Importing from Excel](https://docs.originlab.com/origin-help/import-excel)
- [Hybrid Excel table detection heuristics](https://blog.front10.com/articles/excel-processing-hybrid-approach/)
