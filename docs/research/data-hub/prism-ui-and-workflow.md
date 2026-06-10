# GraphPad Prism UI and Workflow Teardown

Research bot sub-report for Data Hub design. Covers the UI mental model, data entry UX, graph surface, project structure, and import/export. Does NOT cover statistical math (separate bot). All information sourced from official GraphPad/Prism documentation as cited.

**Sources consulted:**
- https://www.graphpad.com/guides/prism/latest/user-guide/using_data_table_format.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/how_to_begin.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/using_prism_navigator.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/xy_table.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/two_grouping_variable_table.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/survival_table.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/about_parts_of_whole.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/nested-tables.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/multiple-variable-tables.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/contingency_table.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/error-bars-from-side-by-side-r.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/graphing_errorbars_calclated_e.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/using_change_graph_type.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/using_format_graph_two_way.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/graphing-box-and-whisker-and-v.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/simple_pairwise_comparisons.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/page_layouts.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/using_creating_a_new_layout.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/exporting_options.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/exporting_to_journals.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/chosing_an_export_format.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/one_click_to_powerpoint_or_word_(windows_only).htm
- https://www.graphpad.com/guides/prism/latest/user-guide/using_pasting_from_excel___windows.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/using_importing_native_excel_files_w.htm
- https://www.graphpad.com/guides/prism/latest/user-guide/how_to_change_a_graph.htm
- https://www.graphpad.com/series/how-to-choose-the-right-data-table-in-prism

---

## 1. The Eight Data Table Types

Prism's core mental model is that you pick a table type before you enter any data. The table type you pick determines what analyses appear in the Analyze menu, what graph is auto-generated, and what graph types are available in the Change Graph Type dialog. The official guide states explicitly: "choose a table based on the organization of your data and the analyses you wish to perform rather than the graph type you want to create."

### 1.1 XY

**Data shape.** One X column, one or more Y dataset columns (labeled A, B, etc.). Each data point requires both an X value and a Y value. Side-by-side subcolumns hold replicates within each dataset column. There is only one X column per table; data sets sharing the same X values go in separate dataset columns.

**What it is for.** Continuous X with continuous Y. Typical use cases: time courses, dose-response curves, standard curves, correlation of two measured variables.

**Analyses unlocked.** Nonlinear regression (with 105+ built-in equations including all standard dose-response models), linear regression, Deming (Model II) regression, area under the curve, smoothing/differentiation/integration, LOWESS, standard curve interpolation, XY correlation.

**Default graph auto-generated.** A scatter plot with one symbol series per dataset column. If subcolumns contain replicates, Prism computes SD or SEM and overlays error bars automatically (the default error bar type is set in Preferences). If subcolumns contain pre-entered mean+error, it plots those directly.

**Graph types available.** Scatter (points only), line-only, points-and-line, line with error area fill, bar-at-each-X. Logarithmic axes are available on both axes. The fitted curve from a nonlinear regression analysis is overlaid on the same graph and updates automatically when data changes.

### 1.2 Column

**Data shape.** Each column is a separate group. Replicates within a group are stacked vertically in the same column (not in subcolumns). There is no X axis variable; the X axis positions are determined by column order.

**What it is for.** Comparing a measured outcome across groups defined by a single categorical variable (e.g., control vs. drug A vs. drug B; wild-type vs. knockout).

**Analyses unlocked.** Unpaired and paired t test, Mann-Whitney, Wilcoxon signed-rank, one-way ANOVA, Kruskal-Wallis, Friedman, column statistics (mean, SD, SEM, CV, normality tests), multiple comparisons post-hoc tests (Tukey, Dunnett, Sidak, etc.).

**Default graph auto-generated.** A column scatter plot showing every individual data point. The user can switch this to a bar graph (with SD or SEM error bars), box-and-whisker, or violin plot through the Change Graph Type dialog or by double-clicking a data symbol.

**Graph types available.** Column scatter (a.k.a. dot plot), bar with error bars, box-and-whisker, violin plot, before-and-after (paired) plot, floating bar (min-to-max), combination of scatter points over a bar.

### 1.3 Grouped

**Data shape.** Two-dimensional grid: rows categorize by one grouping variable, dataset columns categorize by another. Side-by-side subcolumns hold replicates within each row-by-column cell. Up to 256 dataset columns with up to 256 subcolumns each. Blank cells are treated as missing data, which Prism handles properly for mixed-effects models.

**What it is for.** Any experiment with two categorical factors (e.g., genotype x treatment, sex x dose, time point x cell line). Also used to compare multiple separate groups on a single bar chart when a second grouping variable distinguishes them.

**Analyses unlocked.** Two-way ANOVA (and the corresponding mixed-effects model when data are missing), three-way ANOVA, multiple t tests (one per row, with multiple-comparisons correction), row means with SD or SEM.

**Default graph auto-generated.** An interleaved grouped bar chart with error bars. In the interleaved arrangement, bars for all datasets in the same row are placed together; the row labels appear on the X axis and the dataset legend distinguishes colors. The alternative "grouped" arrangement swaps this so each dataset forms its own cluster.

**Graph types available.** Interleaved or grouped bar chart, stacked bar chart, scatter dot plot (one symbol per cell), before-and-after, box-and-whisker, violin plot, floating bar.

### 1.4 Contingency

**Data shape.** A frequency table. Each cell contains the integer count of subjects falling into the category defined by that row and column. No subcolumns. Values must be non-negative integers; no decimals allowed. Prism blocks entry of percentages or decimals. Cannot be created from raw subject-level data (no cross-tabulation); must be entered as pre-counted values.

**What it is for.** Testing whether two categorical variables are associated (e.g., does treatment status predict outcome yes/no?). Row and column categories are mutually exclusive; each subject contributes to exactly one cell.

**Analyses unlocked.** Chi-square test, Fisher's exact test (default for 2x2; extended to larger tables in Prism 10.1+), odds ratio, relative risk, fraction of total.

**Default graph auto-generated.** A grouped bar chart is created automatically (confirmed in the Prism statistics guide howto page). Bar heights represent counts or percentages per category.

**Graph types available.** The grouped bar chart is the primary option. There is no mosaic chart natively.

### 1.5 Survival

**Data shape.** Each row is one subject. There is one X column for elapsed time and one outcome column per treatment group, coded 1 for event (death, failure) and 0 for censored. Time values are numeric durations, not calendar dates. Multiple groups go in multiple columns.

**What it is for.** Time-to-event data analyzed with Kaplan-Meier methods. Each subject contributes one row.

**Analyses unlocked.** Kaplan-Meier survival curve computation, log-rank test (most commonly used for comparing curves), Gehan-Breslow-Wilcoxon test (weights early time points more heavily). Confidence intervals on the survival curve are computed automatically.

**Default graph auto-generated.** A Kaplan-Meier step-function survival plot with one step curve per treatment group. Error bands representing SE or 95% CI are auto-computed and can be toggled on or off.

**Graph types available.** The survival plot is essentially fixed in form. Axis scales and tick marks are configurable. Censored individuals are typically shown as tick marks on the curve.

### 1.6 Parts of Whole

**Data shape.** A simple one-column-per-dataset structure where values in a column represent named fractions or counts of a total. Row labels identify the categories. Multiple columns can be entered, but only column A is graphed automatically; additional columns require manually creating a new graph.

**What it is for.** Asking "what fraction of the total does each category represent?" Pie charts and equivalent visualizations. Also used to run chi-square goodness-of-fit tests against a theoretical distribution.

**Analyses unlocked.** Fraction of total, chi-square goodness-of-fit test.

**Default graph auto-generated.** A pie chart from column A data.

**Graph types available.** Pie chart is the primary type. Bar charts representing proportions are also accessible via Change Graph Type.

### 1.7 Multiple Variables

**Data shape.** Each row is one observation (one experiment, one animal, one subject). Each column is one variable. Columns can hold continuous numeric values or categorical text values (Prism auto-encodes text categories). No subcolumns. This format matches the wide-format layout used by SPSS, R data frames, etc.

**What it is for.** Multivariate analysis with more than two numeric columns to relate, or survival analysis with covariates. Examples: multiple linear regression, logistic regression, PCA, Cox proportional hazards regression (which requires at least three columns: time, event indicator, and one or more predictor variables).

**Analyses unlocked.** Multiple linear regression, binary logistic regression, Cox proportional hazards regression, PCA, correlation matrix, descriptive statistics, outlier tests, data extraction and transform operations.

**Default graph auto-generated.** None. Multiple Variables tables do not auto-generate a graph. Users must manually create graphs via the "Create New Graph" button and select which variables to plot.

**Graph types available.** Scatter matrix (from correlation), PCA biplots, user-configured scatter plots of chosen variable pairs, bubble plots.

### 1.8 Nested

**Data shape.** Hierarchical replication at two levels. Each subcolumn represents one sub-group (e.g., one rat); values stacked within that subcolumn are repeated measurements taken from that sub-group. At least two subcolumns are required. Pre-averaged data (mean/SD/N) cannot be entered; only raw replicate values.

**What it is for.** Experiments with two-level hierarchical replication: e.g., measurements taken multiple times within individual animals, where multiple animals are nested within treatment groups. This prevents pseudoreplication by properly partitioning variance.

**Analyses unlocked.** Nested t test, nested one-way ANOVA, descriptive statistics per subcolumn, normality tests, one-sample t test per subcolumn.

**Default graph auto-generated.** A grouped scatter plot where each subcolumn's data is stacked and error bars are computed from within-subcolumn variance.

**Graph types available.** Nested scatter plot, bar with error bars computed from the hierarchical structure.

---

## 2. Automatic Graph Behavior

When data is entered into a table, Prism creates one graph sheet automatically. The default graph type depends on the table type as described in Section 1. The auto-generated graph:

- Appears in the Graphs folder in the Navigator and is shown as a child of the data table in the Family view.
- Is live-linked to the data table: editing any cell in the table immediately redraws the graph.
- Has a default error bar type determined by the New Graphs tab of Prism Preferences (SD vs SEM vs none). This can be overridden per-graph at any time.
- Can be changed entirely via the Change Graph Type dialog without losing the data link.

Additional graphs of the same data can be created at any time via "New Graph of Existing Data." One data table can feed multiple graph sheets, and one graph can combine data from multiple tables.

---

## 3. Project Structure and the Navigator

### 3.1 The Prism File as Self-Contained Notebook

A single `.pzfx` file contains up to 500 sheets of each of five types: Data Tables, Info Sheets, Analysis Results, Graphs, and Layouts. Everything required to reproduce, re-analyze, and re-export the figures is stored in this one file.

### 3.2 The Navigator Panel

The Navigator appears as a tree on the left side of the Prism window. It has five top-level folders: Data Tables, Info Sheets, Results, Graphs, Layouts. Clicking any sheet name opens it. The currently active sheet is highlighted; all linked sheets appear in bold.

From Prism 8.2 onward, there are two view modes:
- **Combined Data+Results:** results are nested under the data table they came from, making the dependency chain visible.
- **Separate folders:** data and results stay in their own folders.

Frozen sheets (those set to not update when source data changes) appear in italics.

### 3.3 The Family Concept

At the bottom of the Navigator is a Family panel. It shows every sheet related to the currently open sheet. If you are looking at a data table, the Family shows all analyses run from it and all graphs that plot it. If you are looking at a results sheet, the Family shows the source data above it and any graphs derived from it.

Analysis chains (e.g., first a normalization transform, then a curve fit on the normalized data) are shown with increasing indentation levels. Editing the source data table causes Prism to automatically recompute every downstream results sheet and redraw every downstream graph in the chain. This propagation happens in real time.

### 3.4 Sheets That Do Not Auto-Update

Any sheet can be individually frozen so it will not update when source data changes. Frozen sheets appear in italics in the Navigator. This is useful when you want to compare a final result to a revised analysis without overwriting it.

---

## 4. Data Entry UX

### 4.1 The Format Data Table Dialog

When creating a new table (any type except Contingency, Survival, and Multiple Variables), a Format Data Table dialog asks how replicates will be entered. This choice determines the subcolumn structure of the table. The choices are:

**For XY and Grouped tables (side-by-side subcolumns):**
- Individual replicate values: 2 to 256 side-by-side subcolumns, one replicate per subcolumn. Prism computes SD, SEM, or CV and plots error bars automatically from these raw values. No analysis step needed to get error bars.
- Mean and SD (with optional N): three subcolumns labeled Mean, SD, N (or just two: Mean, SD without N). If N is included, Prism can compute SEM on the fly from SD and N. The user can then choose on the graph whether to display SD, SEM, or 95% CI error bars.
- Mean and SEM (with optional N): similar to above.
- Mean and %CV: coefficient of variation (100 x SD/Mean) as the error measure.
- Upper and lower limits: the error columns are treated as the endpoint coordinates of the error bars, not distances. Useful for confidence intervals with asymmetric bounds or median with quartiles.
- +/- error values: the error columns are distances (added to and subtracted from the mean). Useful for already-computed symmetric error.

**For Column tables (stacked replicates):**
Replicates are simply entered one per row within the same column. There are no subcolumns. The entire column is treated as one group.

**For Nested tables:**
Subcolumns represent sub-groups (e.g., individual animals). Values stacked within a subcolumn are repeated measurements from that sub-group. Pre-averaged data cannot be entered.

### 4.2 The Data Grid

The data grid is a spreadsheet-like interface. Cells accept numeric values. Column titles and row labels are editable by clicking the header cells. For XY and Grouped tables, the column header area shows the dataset letter (A, B, C) and the subcolumn index (Y1, Y2, Y3 for replicates, or Mean, SD, N for summary data).

Subcolumn count can be changed after data entry via Format Data Table without losing existing data. If the format label is wrong (e.g., table was set up for SEM but SD was actually entered), the label can be corrected without re-entering data.

### 4.3 Capacity

- Up to 256 dataset columns per table
- Up to 256 subcolumns (replicates) per dataset column
- Up to 500 sheets of each type per project file

---

## 5. The Graphing Surface

### 5.1 Available Graph Types Per Table Type (Summary)

| Table Type | Primary Graph Types |
|---|---|
| XY | Scatter, line, points+line, error area fill, bar-at-X, fitted curve overlay |
| Column | Column scatter/dot plot, bar+error, box-and-whisker, violin, before-after, floating bar |
| Grouped | Interleaved bar, grouped bar, stacked bar, dot plot, box-and-whisker, violin, before-after, floating bar |
| Contingency | Grouped bar (counts or percentages) |
| Survival | Kaplan-Meier step curve |
| Parts of Whole | Pie chart, proportional bar |
| Multiple Variables | Scatter matrix, PCA plot, user-configured scatter (no auto-graph) |
| Nested | Nested scatter, bar+error |

### 5.2 The Change Graph Type Dialog

Accessed via the toolbar button or the Change menu. Shows thumbnail previews of available graph types for the current table format. The user clicks a thumbnail to see a live preview, then confirms. This dialog is designed for switching between types within the same family (e.g., bar to scatter). Switching to a graph family that requires a different table type is technically possible but the guide explicitly warns it "rarely makes sense" and advises reformatting the data table instead.

The "Format Graph" dialog (opened by double-clicking anywhere on the graph except an axis) provides fine-grained control over symbols, bars, error bars, area fills, and legends. The "Global" button in this dialog applies changes to all data sets at once rather than one at a time.

### 5.3 Axis Customization

The Format Axes dialog is opened by double-clicking on an axis. It has multiple tabs:

- **Frame and Origin tab:** sets the frame style (L-shape, full box, none), origin location, and background/plot area colors.
- **X Axis tab:** range (min, max), scale (linear, log2, log10), tick marks (major interval, minor count), numbering format, axis title text and font.
- **Left Y Axis tab:** same controls as X axis.
- **Right Y Axis tab:** optional second Y axis for dual-axis plots. Datasets can be individually assigned to the left or right Y axis via the Data Sets on Graph tab of Format Graph.
- **Titles tab:** controls axis and graph title visibility, font, and distance from the axis.

Log axes can be applied to X, Y, or both axes without transforming the underlying data. Tick labels can display actual values or log-transformed values depending on preference.

### 5.4 Per-Dataset and Per-Point Customization

Color, symbol type, symbol size, fill, border thickness, and line style can be set per dataset (via the Format Graph dialog) or per individual data point (by selecting cells in the data table, right-clicking, and choosing Format Points). This per-cell formatting propagates directly to the graph.

### 5.5 Significance Brackets and Annotations

After running a compatible statistical test (t test, one-way ANOVA, two-way ANOVA cell means), a toolbar button in the Draw section adds pairwise comparison lines or brackets to the graph automatically. The brackets include p-value labels (displayed as numeric p or asterisk notation: ns, *, **, ***). Customization options:

- Three bracket styles with configurable thickness and color.
- Choice between numeric p value and asterisk display.
- Custom prefix (e.g., "P =" or "p <").
- Selective display: the Comparisons on Graph tab lets the user show only specific comparisons or filter by p-value threshold.
- Individual bracket right-click for per-line formatting.
- Independent sizing of asterisks vs. text labels.

A "Compact Letter Display" alternative (Prism 11+) places letters above bars rather than brackets between them.

### 5.6 Color Schemes and Prism Magic

Color schemes apply a coordinated palette to all datasets in one click. "Prism Magic" copies the visual style (colors, symbol shapes, error bar type, axis settings) from one graph and applies it to other graphs, enabling consistent styling across a multi-panel figure.

### 5.7 Multi-Panel Layouts

Layouts are dedicated sheet types (not the same as a graph sheet). A Layout:

- Combines multiple graphs from the same or different Prism projects on one printable page.
- Can also include data tables, results tables, text, drawings, and imported images.
- Can be set up with a fixed number of placeholders in grid or custom arrangement.
- Supports auto-population: designate a starting graph and Prism fills the remaining placeholders in Navigator order.
- The graphs embedded in a layout remain live-linked to their source data; when data changes, the layout redraws.
- Orientation is configurable (portrait or landscape).

---

## 6. Getting Data In

### 6.1 Direct Keyboard Entry

The simplest path: select a table in the Navigator, click into the grid, and type. Pressing Tab moves right across subcolumns; Enter moves down. Copy-paste from any source that puts tab-separated text on the clipboard will map correctly to columns and rows.

### 6.2 Paste from Excel (Recommended Method)

1. In Excel, select and copy the data range.
2. In Prism, place the cursor at the target cell (this becomes the top-left corner).
3. Click Paste or Paste Special in the Prism clipboard toolbar.

Paste Special offers three modes:
- **Paste Data:** values only, no ongoing link to Excel.
- **Paste Embed:** values plus an embedded copy of the entire Excel file inside the Prism project. Edits to the embedded file are reflected immediately.
- **Paste Link:** values plus a live link to the Excel file on disk. When the Excel file changes, Prism updates its analyses and graphs automatically. Requires saving the Excel file before linking.
- **Transposed variants:** all three modes have a transpose option that converts Excel rows to Prism columns and vice versa.

Pasting an Excel range as a picture (rather than data) is also possible and places a non-analyzable image on a graph or layout.

### 6.3 Import Excel Files Directly (Windows Only)

File menu import reads a native `.xlsx` file. Uses an OLE connection and requires Excel to be installed. Only the worksheet that was active when the file was last saved is imported (single sheet only). The guide recommends copy-paste in most cases because direct import is slower and can fail if the OLE connection is unreliable.

### 6.4 Import Text Files

Plain text files (CSV, TSV, custom delimiters) can be imported on both Mac and Windows. Faster and more reliable than OLE-based Excel import for large datasets.

---

## 7. Getting Data Out

### 7.1 Export Formats

Prism supports these export formats from the File > Export menu:

| Format | Type | Notes |
|---|---|---|
| PDF | Vector | Infinite resolution; preferred for Mac workflows; compact; supports transparency |
| SVG | Vector | Infinite resolution; editable text; web-native; best for online journals and modern publishing |
| EPS | Vector | Traditional print; requires font embedding or outline conversion; journal acceptance varies |
| EMF+ / EMF / WMF | Vector | Windows only; native Office embedding format |
| TIFF | Raster | 100/300/600/1200 dpi options; RGB or CMYK; supports transparency; de facto standard for journal submission |
| PNG | Raster | Lossless compression; transparent backgrounds; good for web use |
| JPEG | Raster | Lossy compression; not recommended for line art or scientific graphs |
| BMP | Raster | No advantages over PNG or TIFF |

Raster DPI options: 100, 300, 600, 1200. Doubling DPI quadruples file size. 300 dpi is the default; journals typically require 1200 dpi for TIFF.

Color model choices for PDF, EPS, TIFF: RGB or CMYK. SVG is always RGB. Grayscale and pure monochrome conversions are available for TIFF, PDF, EPS, SVG, and JPEG.

Batch export sends multiple graphs simultaneously. Choosing PDF for a batch export can consolidate all graphs into a single multi-page PDF.

### 7.2 Journal Presets

Prism does not have named journal-specific presets in the export dialog. Instead, the documentation instructs users to check each journal's guidelines. The general recommendation:

- TIFF at 1200 dpi with white background for most legacy journal submission systems.
- SVG or PDF for journals with online-first workflows.
- RGB color model unless the journal specifically requires CMYK.
- Avoid transparent backgrounds in TIFF for submission (can cause problems with some editorial systems).

### 7.3 Copy-to-Clipboard and Send to Office

**Copy to clipboard:** Copies the current graph as an image (WMF, EMF, or EMF+ format on Windows; PDF on Mac) for pasting into any application.

**Send to PowerPoint (Windows):** One button. Creates a new PowerPoint slide and pastes the current graph onto it. If the Prism graph background is set to transparent, the existing PowerPoint slide master design is preserved. Background color settings in Prism override the slide master.

**Send to Word (Windows only):** One button. Pastes the current graph (or multiple selected graphs from the gallery) into the current cursor position in Word. Not available on Prism Mac.

**Embedding:** When a graph is pasted into Word or PowerPoint as an OLE object, double-clicking the embedded object opens it in Prism for editing. Changes are saved back into the Office document but do not affect the original `.pzfx` file.

**Format preferences:** The Preferences dialog (Send to MS Office tab) lets users choose between WMF, EMF, and EMF+ for clipboard delivery, and between embedding, linking, or plain pictures.

---

## 8. Usage Frequency Ranking for Wet-Lab / Molecular-Cell Biology

The following ranking is based on what the documentation and tutorial materials identify as the primary use cases and "common tasks," combined with what is structurally central to how Prism is marketed to biology labs.

### 8.1 The 20% That Covers 80% of Use

**Table types, ranked by typical frequency:**

1. **Column table** (highest volume). The bread-and-butter table for any experiment comparing two or more groups on a single measured outcome. Used with t tests and one-way ANOVA. Essentially every western blot quantification, ELISA, flow cytometry comparison, cell viability assay, or qPCR result expressed as a ratio lands here. The default column scatter dot plot with a t-test or one-way ANOVA and significance brackets is arguably the single most-used Prism workflow in biology.

2. **XY table** (very high). Used for all time-course data, dose-response curves, standard curves, growth curves, and binding assays. The nonlinear regression curve fitter on XY data is a major selling point. Drug labs, pharmacologists, and anyone running an EC50 or IC50 assay rely on this heavily.

3. **Grouped table** (high). Used when any experiment has two independent variables (e.g., drug x genotype, or time point x treatment). Two-way ANOVA from Grouped tables is a staple of publications comparing multiple conditions across multiple groups. Less common than Column but appears in a large fraction of multi-condition papers.

4. **Survival table** (moderate in certain fields). Essential for any lab doing mouse tumor or infection models, but irrelevant to many others. High intensity within its niche.

5. **Contingency table** (low-to-moderate). Used for binary outcome data (alive/dead, positive/negative). Chi-square and Fisher's exact test. Appears in genetics (allele frequency comparisons), immunology (responders vs non-responders), and clinical data analysis.

6. **Parts of Whole table** (low). Pie charts are used occasionally for data showing composition (e.g., cell type fractions in flow cytometry differential counts). Chi-square goodness-of-fit from this table type is uncommon in wet-lab biology.

7. **Nested table** (low). Conceptually important for proper statistical handling of animal experiments with multiple measurements per animal, but relatively few users set up Nested tables explicitly. Many labs incorrectly use Column or Grouped tables for data that should be Nested.

8. **Multiple Variables table** (low in wet-lab biology). More common in clinical and epidemiological analysis contexts. Wet-lab biologists rarely run Cox regression or PCA on their own; this table type is underused in the core biology audience.

**Graph types, ranked by typical frequency:**

1. Bar graph with error bars (mean + SD or SEM, with significance brackets) -- from Column and Grouped tables. Appears in the majority of biology papers.
2. Scatter/dot plot (column scatter showing individual points) -- increasingly preferred over bar graphs for transparency; increasingly required by journals.
3. XY scatter with curve fit overlay (dose-response, standard curve) -- from XY tables.
4. XY line/time-course plot -- from XY tables.
5. Before-and-after (paired) plot -- from Column or Grouped tables.
6. Box-and-whisker plot -- from Column or Grouped tables, used when showing distribution is important.
7. Kaplan-Meier survival curve -- from Survival tables.
8. Violin plot -- from Column or Grouped tables; growing use in high-replicate data.
9. Pie chart -- from Parts of Whole tables; niche use.
10. Volcano plot -- generated from multiple t test results on XY data; used in omics-adjacent work.

### 8.2 The Central Daily Loop

For a typical wet-lab biology grad student or postdoc, Prism use looks like this:

1. Copy data from Excel (columns = groups, rows = replicates).
2. Paste into a Column table (individual replicates stacked).
3. Note that Prism auto-generates a column scatter plot.
4. Click Analyze, choose t test or one-way ANOVA.
5. Prism generates a results sheet with test statistics and p values.
6. Navigate back to the graph. Use the pairwise comparison toolbar button to add significance brackets.
7. Double-click graph to change from scatter to bar or adjust error bar type.
8. Export as TIFF at 1200 dpi for the paper, or copy-paste EMF into PowerPoint for the lab meeting.

The XY table + nonlinear regression workflow (dose-response curves) is the second most common loop, used by any lab with binding assays, drug studies, or standard curves.

---

## Key Design Implications for Data Hub

1. Column and XY tables plus their associated analyses account for the vast majority of real use. These two table types plus their primary graphs (column scatter/bar and XY scatter with curve fit) should be the initial MVP scope.

2. The automatic error bar computation from raw replicates (no analysis step needed) is a significant UX convenience. Users enter raw data and the graph just shows error bars. This should be replicated: user enters replicates, the chart auto-shows SD or SEM.

3. The live-linked family (data table changes instantly redraw graphs and re-run analyses) is the central architectural feature. In ResearchOS, the equivalent is reactive computation from the underlying file-system data.

4. The significance bracket / pairwise comparison annotation is nearly as important as the graph itself for biology publishing workflows. Adding asterisks and p-value brackets to a bar graph is a near-universal publication step.

5. The paste-from-Excel workflow (with transpose option) is the dominant data entry path in practice. Tab-separated paste mapping correctly to columns is table stakes.

6. Journal export at 1200 dpi TIFF and vector formats (SVG/PDF) are the critical output paths. Copy-to-clipboard for PowerPoint is also heavily used.

7. The "column scatter plot as default" (showing individual points) reflects a trend that has been pushed by journals for the past decade. Individual point display should be the default in Data Hub rather than bar-only.

8. The Grouped table's two-way ANOVA and its interleaved bar chart is the most complex common case. It is achievable with a second table type but is lower priority than Column and XY.
