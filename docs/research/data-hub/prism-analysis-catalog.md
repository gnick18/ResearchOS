# GraphPad Prism Analysis Catalog: Statistical Methods and Curve Fitting

Research compiled from the official GraphPad Prism 11 Statistics Guide and Curve Fitting Guide.

Primary sources:
- https://www.graphpad.com/guides/prism/latest/statistics/index.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/index.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_column_statistics.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_choosing_a_normality_test.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_choosing_a_t_test.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_options_tab_1wayanova.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_options_tab_two-way_anova.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_options_tab_three-way_anova.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_nonparametric_tests.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_chi-square_or_fishers_test.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_analysis_choices_for_survival.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_howto_roc.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_bland_altman.htm
- https://www.graphpad.com/guides/prism/latest/statistics/stat_binomial.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_nonlinear_regression_choices.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_the_basic_steps_of_every_nonli.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_models_built-in_to_prism.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_choosing_a_dr_equation.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_comparing_models_tab.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_diagnostics_tab_5_2.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_diagnostics_tab_5_3.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_standard_errors_and_confidence.htm
- https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_example_global_nonlin.htm
- https://www.graphpad.com/support/faq/what-is-the-meaning-of--or--or--in-reports-of-statistical-significance-from-prism-or-instat/

---

## 1. Full Analysis Catalog (Prism's Own Groupings)

Prism organizes analyses by the data table type used to enter the data. The Analyze dialog groups analyses into six broad sections. The descriptions below follow how Prism presents them in the dialog.

---

### 1.1 Column Statistics and Descriptive Statistics

Entry point: Column data table. Click Analyze, choose "Column statistics."

**Descriptive statistics computed:**
- Mean, geometric mean, median
- Standard deviation (SD), standard error of the mean (SEM), variance
- Coefficient of variation (CV)
- Quartiles (25th, 75th percentile), interquartile range (IQR)
- Skewness and kurtosis
- Confidence interval of the mean
- Min, max, range, count

**Normality and lognormality tests** (checkbox options in the same dialog):

Prism offers four normality tests and runs them on the raw data for normal distribution testing, or on the log-transformed data for lognormality testing:

- **D'Agostino-Pearson omnibus test** (recommended by Prism): Computes skewness and kurtosis separately, then combines them into a single K² statistic and P value. Requires at least 8 values. The guide calls it "versatile and powerful."
- **Shapiro-Wilk test**: Compares the actual SD of the data to the SD inferred from the QQ-plot slope. Requires at least 3 values. Works best when all values are unique; loses power when there are many ties.
- **Anderson-Darling test**: Compares the empirical cumulative distribution to the ideal Gaussian CDF, weighting discrepancies across the full curve rather than just the largest single gap.
- **Kolmogorov-Smirnov test (with Dallal-Wilkinson-Lilliefors correction)**: Included only for backward compatibility. The guide states it is "not a very sensitive way to assess normality" and explicitly says to avoid it for new analyses.

**Lognormality option**: Prism log-transforms all values and applies the same four tests. It also performs a likelihood-ratio comparison between a normal and a lognormal fit to the same data, reporting relative likelihoods. If any value is zero or negative, lognormality testing is skipped.

**One-sample hypothesis tests available in Column Statistics:**
- One-sample t test (tests whether the population mean differs from a hypothetical value)
- Wilcoxon signed rank test (nonparametric equivalent of the one-sample t test)

---

### 1.2 Comparing Two Groups: t Tests and Nonparametric Equivalents

Entry point: Column data table. Click Analyze, choose "t tests (and nonparametric tests)."

The dialog presents three sequential choices:

**Choice 1: Experimental design**
- Unpaired (independent samples)
- Paired (matched samples)

**Choice 2: Distribution assumption**
- Assume Gaussian (parametric)
- Assume lognormal (parametric, ratio-based)
- Nonparametric (distribution-free)

**Choice 3: Specific test** (results from the combination above)

The seven available tests are:

| Design | Distribution | Test |
|--------|-------------|------|
| Unpaired | Gaussian | Welch's t test (does not assume equal SDs; Prism recommends this as the default unpaired test) |
| Unpaired | Gaussian | Unpaired t test (assumes equal SDs) |
| Paired | Gaussian | Paired t test (compares differences) |
| Unpaired | Lognormal | Lognormal Welch's t test (does not assume equal geometric SDs) |
| Unpaired | Lognormal | Lognormal t test (assumes equal geometric SDs) |
| Paired | Lognormal | Ratio paired t test (compares ratios, not differences; appropriate when the ratio between paired values is a more consistent measure of effect than the difference) |
| Unpaired | Nonparametric | Mann-Whitney U test (more power to detect a shift in median) |
| Unpaired | Nonparametric | Kolmogorov-Smirnov test (detects differences in distribution shape, not just location) |
| Paired | Nonparametric | Wilcoxon matched-pairs signed rank test |

**Welch's t test note**: Many statisticians now recommend Welch as the default unpaired test because it performs nearly identically to the equal-variance t test when variances are equal, but provides protection against elevated Type I error when they are not.

**What the t-test results sheet reports:**
- t statistic and degrees of freedom
- P value (one- or two-tailed, user's choice; two-tailed is default)
- Mean (or geometric mean) of each group
- Difference between means (or ratio, for lognormal/ratio tests)
- 95% confidence interval of the difference
- Cohen's d (effect size, optional)
- P-value summary using the asterisk convention

---

### 1.3 One-Way ANOVA and Nonparametric Equivalents

Entry point: Column data table. Click Analyze, choose "One-way ANOVA (and nonparametric)."

#### Parametric One-Way ANOVA

**Repeated measures option**: Prism can perform standard one-way ANOVA (independent groups) or one-way repeated measures ANOVA (matched observations). For repeated measures with missing values, Prism offers a mixed-effects model as an alternative.

**Results reported:**
- F ratio and degrees of freedom
- P value for overall treatment effect
- Mean, SD, SEM, 95% CI for each group
- Individual variance for each group

**Multiple comparison tests after one-way ANOVA:**

Prism presents multiple comparison options conditioned on whether group SDs are assumed equal or unequal.

*Assuming equal SDs (comparing all means):*
- **Tukey**: Recommended for comparing every mean with every other mean. Reports multiplicity-adjusted P values and confidence intervals.
- **Bonferroni**: Offered for compatibility with older literature; less powerful than Sidak for independent comparisons.
- **Sidak**: Slightly more powerful than Bonferroni for independent comparisons. Recommended when comparing a prespecified set of pairs.
- **Holm-Sidak**: Step-down procedure; more powerful than Tukey for all-pairs comparisons but cannot produce confidence intervals.
- **Newman-Keuls**: Included for backward compatibility only. The guide explicitly warns that it does not maintain the family-wise error rate and may produce more Type I errors than the stated alpha.
- **Fisher's LSD**: No correction for multiplicity; highest power but highest false-positive risk.

*Comparing a control group to all others (equal SDs):*
- **Dunnett**: Recommended for control-vs.-rest comparisons. Reports adjusted P values and confidence intervals.
- Bonferroni and Sidak also available.

*Assuming unequal SDs (heteroscedastic data):*
- **Games-Howell**: Recommended for larger samples.
- **Dunnett T3**: Recommended when any group has fewer than 50 observations.
- **Tamhane T2**: Conservative option for unequal variances.

*False Discovery Rate (FDR) control:*
Three FDR approaches are available as an alternative to family-wise error rate control. They identify "discoveries" while controlling the expected proportion of false positives to a user-specified Q value.

**Nonparametric equivalent: Kruskal-Wallis test**
- Ranks all values, then tests whether the sum of ranks differs across groups.
- Post-hoc: **Dunn's test** (with or without Bonferroni/Sidak correction for multiplicity).
- Reports: H statistic, P value, post-hoc comparison results with adjusted P values.

**Nonparametric repeated measures: Friedman test**
- Nonparametric equivalent of one-way repeated measures ANOVA.
- Post-hoc: Dunn's test.
- Reports: Friedman statistic, P value, post-hoc comparisons.

---

### 1.4 Two-Way ANOVA

Entry point: Grouped data table. Click Analyze, choose "Two-way ANOVA."

**Experimental design choices:**

*Repeated measures / matching:*
- No matching (standard two-way ANOVA)
- One factor repeated (columns are repeats, matched values spread across a row)
- The other factor repeated (rows are time points, matched values stacked into subcolumns)
- Both factors repeated
- Mixed-effects model: Prism 8 and later can substitute a mixed-effects model for repeated measures ANOVA, which handles missing data gracefully; results are identical to ANOVA when there are no missing values.

*Model:*
- Full model (row effect + column effect + interaction term)
- Main effects only (no interaction term)

*Sphericity assumption (for repeated measures):*
- Assume sphericity (standard)
- Do not assume sphericity (applies Greenhouse-Geisser correction, reports epsilon)

**Results reported:**
- F ratio and P value for each main effect and the interaction
- Partial eta-squared (effect size)
- Individual group means and SEM

**Multiple comparison tests after two-way ANOVA:**

Same menu as one-way ANOVA: Tukey, Dunnett, Sidak, Holm-Sidak, Bonferroni, Newman-Keuls, Fisher's LSD, and three FDR methods. The user also specifies whether comparisons are made within rows, within columns, or between specific cell pairs.

---

### 1.5 Three-Way ANOVA

Entry point: Nested grouped data table. Click Analyze, choose "Three-way ANOVA."

**Design options:**
- Specify which of the three factors (if any) involve repeated measures on the first RM Design tab.
- If repeated measures are present, choose between repeated measures ANOVA or mixed-effects model on the RM Analysis tab.

**Multiple comparisons:**
Same test menu as one- and two-way ANOVA (Tukey, Dunnett, Sidak, Holm-Sidak, Bonferroni, Newman-Keuls, Fisher's LSD, FDR).

**Results reported:**
- F ratio and P value for each main effect (A, B, C), each two-way interaction (A×B, A×C, B×C), and the three-way interaction (A×B×C).

---

### 1.6 Correlation

Entry point: XY data table with multiple Y columns, or a column data table. Click Analyze, choose "Correlation."

**Options:**
- Correlate two specific columns, all column pairs (correlation matrix), or each column against a control dataset.
- **Pearson correlation**: Assumes both variables are approximately Gaussian. Reports Pearson r, r², and two-tailed P value.
- **Spearman nonparametric correlation**: No distributional assumption; uses ranks. Reports Spearman rs and P value. Prism computes exact P values for 17 or fewer pairs; uses a t approximation for 18 or more. The guide notes that r² should not be computed from Spearman rs.
- One-tailed vs. two-tailed P value option (two-tailed is the default recommendation).
- Missing-data handling: exclude only the pair with the missing value, or exclude the entire row.

**Correlation matrix note**: Prism does not apply a multiple-comparisons correction when producing a matrix of correlations; users must account for this themselves.

---

### 1.7 Simple and Multiple Linear Regression

Entry point: XY data table (simple linear regression) or Multiple Variables data table (multiple regression). Under Analyze, choose "Linear regression" or "Multiple regression."

**Simple linear regression:**
- Fits Y = slope × X + intercept.
- Option to force the line through the origin.
- Option to compare slopes and intercepts across multiple datasets (test of parallelism via F test).
- Results: slope with SE and 95% CI, intercept with SE and 95% CI, R², adjusted R², Sy.x (residual standard deviation), F statistic, P value for the regression.
- Confidence bands and prediction bands can be plotted.

**Multiple regression:**
Prism 8 and later offer three regression frameworks:
- **Linear regression** for continuous Y (minimizes sum of squares).
- **Poisson regression** for count outcomes (Y = 0, 1, 2, ...).
- **Logistic regression** for binary outcomes.

Model components the user can include:
- Intercept (default on)
- Main effects (one coefficient per continuous predictor)
- Two-way interactions (products of predictor pairs)
- Three-way interactions
- Polynomial transforms (square, cube, square root) on continuous predictors

**Important limitation**: Prism does not offer automatic variable selection (stepwise, forward, backward, LASSO, etc.). The user must specify the full model manually.

---

### 1.8 Contingency Tables

Entry point: Contingency table data type. Click Analyze, choose "Contingency table analyses."

**Test choices:**
- **Fisher's exact test**: Exact computation; recommended whenever cell expected counts are small, and for all 2×2 tables. Starting with Prism 10.1, extended Fisher's test is available for tables larger than 2×2.
- **Chi-square test** (with optional Yates continuity correction for 2×2 tables).
- **Chi-square test for trend** (Cochran-Armitage method): For ordered categorical rows.

**Effect size options** (all checkboxes; multiple can be selected at once):
- **Relative risk**: How many times more (or less) likely an outcome is in one group vs. another. Confidence interval uses the Koopman asymptotic score method.
- **Attributable risk** (risk difference) and Number Needed to Treat (NNT).
- **Odds ratio**: Appropriate for retrospective case-control studies; approximates relative risk when the outcome is rare.
- **Diagnostic test metrics**: Sensitivity, specificity, positive predictive value, negative predictive value.
- **Phi coefficient and Cramér's V**: Measure association strength in tables of any dimension.

---

### 1.9 Survival Analysis

Entry point: Survival data table or Multiple Variables table. Click Analyze, choose "Kaplan-Meier survival analysis."

**Data input:**
- Values column encodes time to event or time to censoring.
- Codes column: "1" (default) = event occurred, "0" = censored.
- Alternative: descriptive text labels from a Multiple Variables table.

**Comparison tests:**
- **Log-rank test (Mantel-Haenszel method)**: Gives equal weight to all time points. More powerful than Gehan-Breslow when the proportional hazards assumption holds. This is the standard first-choice test.
- **Log-rank test for trend**: For three or more groups with a logical ordering (e.g., dose levels).
- **Gehan-Breslow-Wilcoxon test**: Weights early time points more heavily. Can give misleading results if many early events are censored. Prism 6 and later can report both tests simultaneously.

**P-value computation options:**
- Conservative method (matches Prism 5 output, produces larger P values).
- SPSS/SAS method (recommended by the guide, produces smaller and more valid P values).

**Multiple comparisons for three or more curves** (Prism 10.5 and later):
- Bonferroni correction applied across all pairwise log-rank tests.
- Results appear on a dedicated tab of the results sheet.

**Confidence intervals for survival fraction:**
- Asymmetrical transformation method (recommended).
- Symmetrical Greenwood method (legacy).

**Output:**
- Kaplan-Meier survival curve with optional median survival lines.
- Number-at-risk table (optional inclusion on graph).
- Chi-square statistic and P value for each comparison.
- Median survival times per group.

---

### 1.10 ROC Curves

Entry point: Column data table with one column per group. Click Analyze, choose "ROC curve" from the one-way analyses list.

**Options:**
- Designate which columns contain control (healthy) and patient (diseased) results.
- Report sensitivity and 1-specificity as fractions or percentages.
- Prism determines automatically whether higher or lower test values indicate the abnormal condition.

**Results:**
- ROC curve plot (sensitivity vs. 1-specificity).
- Area Under the Curve (AUC) with 95% confidence interval and P value (testing whether AUC differs from 0.5).
- Multiple ROC curves can be superimposed on one graph.

---

### 1.11 Bland-Altman Analysis

Entry point: XY data table with measurements from two methods. Click Analyze, choose "Bland-Altman" from the one-way analyses list.

**Options (how to display the Y axis):**
- Difference between the two methods.
- Ratio of the two methods.
- Percent difference.

The guide recommends the difference when absolute disagreement is approximately constant across the range of measurements. If disagreement grows proportionally with magnitude, the ratio or percent difference is more appropriate.

**Results:**
- Plot of difference (or ratio/percent) on Y axis versus mean of the two measurements on X axis.
- **Bias**: The mean of all differences between the two methods.
- **95% limits of agreement**: Bias ± 1.96 × SD of differences, shown as dashed reference lines on the plot.

---

### 1.12 One-Sample and Proportion Tests

**Binomial test (compare observed to expected proportions):**
Entry point: Column data table or parts-of-whole table. Click Analyze, choose "Compare observed distribution with expected."

- Exact test for data with only two categories; preferred over chi-square for two-category data because chi-square is only an approximation in that case.
- Reports one-tailed and two-tailed P values. The two-tailed P is computed by the "method of small P values" to ensure probability symmetry rather than count symmetry.
- For three or more categories, the chi-square goodness-of-fit test is used.

**Chi-square goodness-of-fit test:**
- Compares observed counts in multiple categories to a theoretical expected distribution.
- Reports chi-square statistic and P value.

---

## 2. Nonlinear Regression: Prism's Crown Jewel

### 2.1 Overview and Access

Click Analyze from any XY data table, select "Nonlinear regression (curve fit)." The dialog opens to a multi-tab interface.

Prism uses the Marquardt-Levenberg damped least-squares algorithm to minimize the sum of squares of residuals. The algorithm is iterative: it starts from initial parameter estimates and adjusts them repeatedly until further adjustment produces negligible improvement.

### 2.2 The Six Steps of Nonlinear Regression

1. **Choose a model (equation)**: Done on the Model tab. The user can select from the built-in library (organized into thematic groups) or define a custom equation. The guide emphasizes this is "a scientific decision that must be made by someone who understands the scientific goals," not a purely mathematical exercise.

2. **Constrain parameters**: On the Constrain tab, fix specific parameters to constants (e.g., fix the Hill slope to 1.0, fix the top plateau to 100% for normalized data) rather than letting all parameters float.

3. **Set initial values**: Prism supplies starting estimates automatically for all built-in equations using rules derived from the data range. For custom equations, the user provides explicit starting values or formulas to generate them.

4. **Share parameters across datasets (global fitting)**: On the Constrain tab, mark parameters as "shared" across all datasets in the table. Prism then finds one best-fit value for the shared parameter(s) across the entire dataset family, while allowing other parameters to differ per dataset. This produces tighter confidence intervals and enables formal testing of whether a parameter differs between conditions.

5. **Apply weighting**: On the Method tab, choose how to weight data points. Default is equal weighting. Options include weighting by 1/Y, 1/Y², or by entering explicit weights.

6. **Select output**: On the Diagnostics tab, choose which additional results to compute (runs test, replicates test, normality of residuals, confidence intervals, AICc, etc.).

### 2.3 Built-In Equation Library

Equations are organized into thematic groups accessible from the Model tab:

**Dose-Response (the most-used group in pharmacology):**

Two parallel families of equations exist: one where X is the logarithm of concentration (log-dose), and one where X is the raw concentration. Within each family, there are stimulation equations (EC50) and inhibition equations (IC50). The families are:

- **[Agonist] vs. response, standard slope**: Four-parameter logistic (4PL) with Hill slope fixed at 1.0 (or -1.0 for inhibition). The four parameters are Bottom, Top, EC50 (or IC50), and HillSlope (constrained). This is the classic symmetric sigmoidal model.
- **[Agonist] vs. response, variable slope**: 4PL with the Hill slope fitted from the data. This is the most commonly used dose-response model in practice because most real concentration-response data do not have a slope of exactly 1.0.
- **Normalized response**: Bottom constrained to 0, Top constrained to 100. Appropriate when baseline and maximum are precisely known from flanking controls.
- **Asymmetric (five parameter logistic, 5PL)**: Adds an asymmetry parameter to the standard 4PL to model curves that are not symmetric around the midpoint (EC50).
- **Biphasic dose-response**: Models data where two distinct populations respond at different concentrations.
- **Bell-shaped dose-response**: Models responses that rise and then fall with increasing concentration.
- **Operational model (agonism)**: Models transduction between receptor occupancy and response, fitting a transduction ratio (tau) and a receptor-pathway equilibrium constant (KA).
- **Gaddum/Schild EC50 shift**: For antagonist characterization; fits the shift in agonist EC50 caused by an antagonist.
- **Allosteric EC50 shift**: Models allosteric modulation of agonist potency.
- **ECanything**: Extends the variable-slope 4PL to report the concentration producing any specified response percentage (EC10, EC80, EC90, etc.) rather than just EC50. The user constrains parameter F to the desired percentile.
- **Absolute IC50**: Fits the concentration producing 50% inhibition of the absolute response, rather than 50% of the span between top and bottom.

**Enzyme Kinetics:**

All enzyme kinetics equations use substrate concentration as X and velocity as Y. The recommended approach is nonlinear regression directly on velocity-vs-substrate data, avoiding the older Lineweaver-Burk double-reciprocal linearization, which distorts experimental error.

- **Michaelis-Menten**: Y = Vmax × X / (Km + X). Fits Vmax (maximum velocity) and Km (half-saturation constant).
- **Substrate inhibition**: Y = Vmax × X / (Km + X × (1 + X/Ki)). For enzymes where high substrate concentrations inhibit activity. Fits Vmax, Km, and Ki (inhibition constant).
- **Competitive inhibition**: Two datasets (with and without inhibitor); Km apparently increases, Vmax unchanged. Fits Vmax, Km, and Ki with global sharing of Vmax and Km.
- **Noncompetitive inhibition**: Both apparent Vmax and apparent Km are altered. Fits Vmax, Km, and Ki.
- **Mixed-model inhibition**: General case; the inhibitor can affect both Vmax and Km with separate alpha parameters.

**Receptor Binding (saturation binding):**

- **One-site specific binding**: Y = Bmax × X / (Kd + X). Fits Bmax (maximum binding) and Kd (equilibrium dissociation constant).
- **One-site total binding**: Fits total binding (specific + nonspecific) as separate components.
- **One-site total and nonspecific binding simultaneously**: Global fit recommended approach; uses two Y columns (total and nonspecific), sharing Bmax and Kd.
- **Two-site specific binding**: Fits Bmax1, Kd1, Bmax2, Kd2 for two receptor populations.
- **Binding potential**: Bmax/Kd ratio.

**Receptor Binding (kinetics):**

- **Association kinetics (one ligand concentration)**: Fits kon, koff, Req (equilibrium binding).
- **Dissociation kinetics**: Fits koff and half-life.
- **Kinetics of competitive binding**: For displacing a labeled ligand with an unlabeled competitor.

**Exponential:**

- **One-phase exponential decay**: Y = (Y0 - Plateau) × exp(-K × X) + Plateau. Fits Y0, Plateau, and rate constant K. Used for radioactive decay, drug elimination, ligand dissociation.
- **One-phase exponential association**: Fits Y0, Plateau, K. Used for ligand association, drug accumulation.
- **Two-phase exponential decay**: Sum of two exponential terms, each with its own rate constant. Fits Span1, Span2, Plateau, K1, K2. Reports two half-lives.
- **Two-phase exponential association**: Fits fast and slow association components.
- **Plateau followed by one-phase decay**: Used when the signal is constant and then begins decaying after some event.
- **Plateau followed by one-phase association**: Delay before exponential rise.
- **Exponential growth (Malthusian)**: Y = Y0 × exp(K × X).
- **Log of exponential growth**: Linearized form.

**Growth Equations:**

- **Exponential (Malthusian) growth**: Unbounded exponential.
- **Logistic growth (with carrying capacity)**: Sigmoidal growth that plateaus at a maximum population; fits K, Ymax, Y0.
- **Gompertz growth**: Asymmetric sigmoidal growth model; often used in tumor growth modeling.
- **Beta (growth then decay)**: A unimodal curve that rises to a peak and then declines.

**Gaussian:**

- **Gaussian (bell curve)**: Fits mean, SD, and amplitude.
- **Cumulative Gaussian distribution**: Sigmoidal CDF; used for probit-style concentration-response curves and standard curves.
- **Biphasic Gaussian**: Sum of two Gaussian peaks.

**Polynomial:**

- First through fifth degree polynomials.
- These are purely descriptive; Prism includes them for interpolation purposes but does not endorse polynomial fitting as a mechanistic model.

**Sine waves:**

- Sine wave with fitting of amplitude, frequency, and phase. Used for circadian rhythm or periodic data.

**Interpolation equations:**

- Linear interpolation between data points.
- Spline.
- Used mainly for standard curve interpolation (e.g., RIA, ELISA).

### 2.4 How a User Picks a Model

The Model tab shows the equation groups in a hierarchical panel. The user:

1. Expands a category (e.g., "Dose-Response Stimulation").
2. Reads the built-in description of each equation.
3. Selects the equation; a preview graph appears showing the curve shape.
4. Optionally clicks "Help" to read the full guide entry for that equation.

For data that do not fit a built-in category, the user can type a custom equation in a text editor pane using a simple syntax (Y = expression in terms of X and named parameters). Initial value rules for custom equations are written as IF/THEN statements referencing data statistics (e.g., IF X > 0, initial K = 1 / (max(X) - min(X))).

### 2.5 Initial Values

Built-in equations have auto-rules that Prism applies before starting the iteration, typically using the data range to produce biologically plausible starting estimates. For a dose-response curve, for example, Prism initializes Bottom from the lowest Y values, Top from the highest Y values, and EC50 from the midpoint of the X range.

Custom equations require the user to supply either a fixed scalar or an IF/THEN formula.

### 2.6 Constraints

On the Constrain tab, each parameter can be set to:
- **Float** (default): fitted from the data.
- **Fixed to a constant value**: e.g., fix Bottom = 0, fix HillSlope = 1.
- **Shared across datasets**: use one best-fit value for that parameter across all datasets in the table (global fitting).
- **Constrained to be greater than / less than**: bounds constraints.

Fixing parameters reduces the degrees of freedom and can improve precision when the constraint is biologically justified. Global fitting of shared parameters (e.g., sharing the Hill slope across treatment curves while allowing separate EC50 per treatment) often narrows confidence intervals substantially.

### 2.7 Results Reported

**Best-fit values**: One value per parameter, reported with units matching the input data.

**Standard error of each parameter**: Computed from the asymptotic approximation (assumes local linearity of the model). These can be over-optimistic when the model is highly nonlinear.

**Confidence intervals**: Two options:
- *Asymptotic (symmetric)*: Best-fit ± t × SE. Fast but can be inaccurate for highly nonlinear models.
- *Asymmetrical (profile likelihood)*: Traces the likelihood surface along each parameter dimension; slower but more accurate. Prism recommends this for built-in equations.

Special CI output values: "Very wide," "Unstable," "Infinity," or "???" when the data do not constrain the parameter.

**R²**: Computed as 1 - (sum of squares of residuals / total sum of squares). The guide notes R² is not ideal for nonlinear regression because the total SS is not a baseline model in the same sense as for linear regression. A high R² does not guarantee sensible parameter values.

**Runs test for randomness**: Counts consecutive residuals of the same sign (a "run"). Fewer runs than expected (formula: [2×N_above × N_below / (N_above + N_below)] + 1) indicates systematic bias; the curve does not describe the data well. Reports a one-tailed P value. Used only when data have no replicates per X value (or when fitting means only).

**Replicates test**: When data have replicate Y values at each X, this test compares the scatter of replicates around the curve against the scatter among replicates. A small P value means the curve is farther from the data than replicates scatter among themselves, implying a wrong model or systematic experimental factor.

**Normality of residuals**: Applies the four normality tests (D'Agostino-Pearson, Shapiro-Wilk, Anderson-Darling, K-S) to the residuals.

**AICc (corrected Akaike Information Criterion)**: Optional; useful for comparing three or more models fit to the same data.

**Hougaard's measure of skewness**: Quantifies how asymmetric the parameter space is; values below 0.1 indicate reliable symmetric CIs, values above 0.25 indicate asymmetric CIs may differ meaningfully from symmetric ones.

**Dependency**: Measures collinearity between parameters (0 = independent, 1 = fully correlated). High dependency means some parameters are poorly identified independently of others.

**Outlier identification (ROUT method)**: Available as an option on the Outliers tab. Uses a robust nonlinear regression to identify potential outliers based on a false-discovery rate criterion Q (adjustable from 0.1% to 10%). Points flagged as outliers can be automatically excluded or simply highlighted.

### 2.8 Model Comparison

The Compare tab allows formal testing of whether one model fits significantly better than another.

**Extra sum-of-squares F test**: For nested models (one model is a constrained special case of the other, e.g., one-phase vs. two-phase decay). Computes F = [(SS_simple - SS_complex) / (df_simple - df_complex)] / [SS_complex / df_complex]. Reports F, degrees of freedom, P value, and a conclusion about whether the more complex model is justified.

**AICc method**: For any pair of models, nested or not. Prism reports delta AICc and the probability that each model is correct (Akaike weights). The F test is not valid for non-nested models; AICc must be used in that case.

Both methods balance improvement in fit against the cost of additional parameters.

---

## 3. Results Presentation and Reproducibility

### 3.1 Results Sheets

Every analysis in Prism produces one or more results sheets (tabs), separate from the data table. Results sheets can contain multiple sub-tabs (e.g., a nonlinear regression result might have tabs for "Parameters," "Goodness of fit," "Diagnostics," "Model," "Residuals," and "Compare").

Results tables can be copied, and when the copied cells are pasted onto a graph or layout, the link is live: changes in the source data or analysis choices update the embedded result automatically.

### 3.2 P-Value Asterisk Convention

Prism uses a five-tier asterisk summary on graphs and in multiple-comparison tables:

| Symbol | Threshold |
|--------|-----------|
| ns | P > 0.05 |
| * | P ≤ 0.05 |
| ** | P ≤ 0.01 |
| *** | P ≤ 0.001 |
| **** | P ≤ 0.0001 |

Prism evaluates significance using the full double-precision P value, not the rounded display value. So a P value of 0.0500001 is "ns" even though it rounds to "0.0500."

**Style options** (Prism 8 and later):
- **GraphPad style** (default): Four asterisk tiers including ****.
- **APA style**: Maximum three asterisk tiers (P < 0.001 = ***; no ****).
- **NEJM style**: Similar to APA.
- **One or None**: A single * if P < alpha, nothing otherwise.
- **Exact P values**: Report the numerical P value rather than asterisks.

The asterisk summary is automatically placed on bar graphs or scatter plots when multiple comparison results are linked to the graph.

### 3.3 Auto-Update and Reproducibility

Prism stores analysis choices inside the project file alongside the data. The connection between each data table, its analysis, and any graphs derived from it is explicit and persistent.

**Auto-update chain**: If a value in a data table changes (manual edit, correction, or data replaced from an Excel link), Prism automatically recalculates every downstream analysis and updates every graph and layout that references those results. This propagation happens across chained analyses (e.g., data → transform → ANOVA → graph of means and error bars).

**Freezing**: A results sheet can be frozen, which disconnects the live link and preserves the current results even if the data change.

**Methods**: Analysis parameter sets can be saved as a named "Method" and recalled from the Analyze dialog dropdown. This is Prism's mechanism for applying the same analysis workflow to a new dataset without re-entering all choices.

**File format**: Prism projects are saved as .pzfx (XML-based, Prism 6 and later). The file contains data, analysis parameters, graph settings, and layouts in a single document. Because parameters are stored textually in XML, analysis choices are auditable.

---

## 4. Analysis-Parameters Dialog UX

### 4.1 How a User Launches an Analysis

1. The user is on any data, results, or graph sheet.
2. Clicks the "Analyze" button on the toolbar (or uses the Analyze menu).
3. The "Analyze Data" dialog appears with analyses grouped by objective on the left. There is a search box to filter by name.
4. The user selects an analysis type; the dialog switches to the multi-tab parameter form for that analysis.

### 4.2 Dialog Structure

Every analysis dialog is organized into named tabs. The tabs vary by analysis but follow consistent patterns:

**Common tab types:**
- **Experimental Design** (or "Model"): Define the study design. For ANOVA, choose whether the design is paired/repeated, which factor is repeated, whether to include an interaction term.
- **Options** (or "Multiple Comparisons"): Select which post-hoc tests to run and which comparisons to make.
- **Diagnostics**: Choose which additional diagnostics to compute (residuals, normality of residuals, runs test, replicates test, AICc, confidence interval type).
- **Compare**: For nonlinear regression; choose whether and how to compare two models or two datasets.
- **Constrain**: For nonlinear regression; set fixed values and shared parameters.
- **Method**: For nonlinear regression; set weighting scheme and whether to handle replicates individually or fit their means.

### 4.3 Guidance for Non-Statisticians

Prism explicitly designs its dialogs to guide users who are not expert statisticians:

- Every dialog has a **Learn** button or embedded hyperlink that opens the relevant section of the Statistics Guide directly.
- The Experimental Design tab frames choices as plain-language questions: "Are the data paired?" rather than "Is this a within-subjects design?"
- The Multiple Comparisons tab explains the recommended test for each scenario in a sentence or two ("Tukey test is recommended if you want to compare every mean with every other mean").
- **Analysis checklists**: Each analysis type has a dedicated checklist page in the guide covering assumptions, when to use the test, and how to interpret every number in the results sheet.
- When the Welch t test is selected, the dialog explains why (no equal-variance assumption required) rather than simply labeling it.
- For nonlinear regression, built-in equations include a preview graph and a prose description of the scientific context.
- Warning messages appear in results sheets when parameter estimates are outside physiologically plausible ranges or when the algorithm encounters problems (ambiguous fit, unstable parameters, possible local minimum).

---

## 5. Frequency Ranking for Wet-Lab / Molecular-Cell-Biology Papers

This ranking is based on the patterns of use visible across published molecular-cell-biology and biochemistry papers, combined with how Prism's own documentation discusses common use cases.

### Tier 1: Core 80% of publications

1. **Unpaired t test (usually Welch variant)**: The single most-used test in wet-lab biology. Virtually every two-group comparison in a paper runs through this.

2. **One-way ANOVA with Tukey or Dunnett multiple comparisons**: For experiments with three or more treatment conditions compared against each other or against a control (e.g., dose-response at three concentrations, multiple time points, multiple genetic constructs).

3. **Two-way ANOVA with multiple comparisons (Tukey or Sidak)**: Standard for factorial designs (e.g., genotype × treatment, time × treatment). Very frequently used in pharmacology and cell biology.

4. **Nonlinear regression: dose-response (4PL variable slope)**: The dominant analysis in pharmacology, biochemistry, and cell signaling. Every IC50 or EC50 determination uses this model. The log(agonist/inhibitor) vs. response, variable slope form is the default choice for the large majority of users.

5. **Paired t test**: For before/after comparisons in the same animal or cell line, repeated-measures two-group designs.

### Tier 2: Frequently used (appear in a substantial fraction of papers)

6. **Nonparametric tests: Mann-Whitney, Kruskal-Wallis + Dunn**: Used when normality is violated or when sample sizes are small (fewer than ~6 per group); common in in vivo studies.

7. **Pearson or Spearman correlation**: Correlating two continuous measures (gene expression vs. protein level, biomarker vs. outcome score, etc.).

8. **Kaplan-Meier survival + log-rank test**: Ubiquitous in oncology, infection biology, and any study with a time-to-event outcome (animal survival, tumor recurrence, time to adverse event).

9. **Simple linear regression**: For standard curves, dilution series, and linear relationship characterization.

10. **Nonlinear regression: Michaelis-Menten enzyme kinetics**: Standard in biochemistry papers reporting Km and Vmax.

### Tier 3: Specialized but common in specific subfields

11. **Nonlinear regression: exponential decay / association (one-phase and two-phase)**: Pharmacokinetics, radioligand dissociation, calcium imaging, electrophysiology.

12. **Contingency tables (Fisher's exact test, chi-square)**: Categorical outcomes (proportion positive, proportion with a genotype, responder vs. non-responder).

13. **Nonlinear regression: receptor binding (one-site and two-site saturation)**: Radioligand binding assays in pharmacology and neuroscience.

14. **Friedman test**: Repeated-measures nonparametric; used in behavioral and in vivo studies.

15. **Repeated measures one-way ANOVA**: Longitudinal designs with a single treatment factor.

### Tier 4: Minority use in wet-lab biology

16. **ROC curves**: Used in clinical and diagnostic research; occasionally in biomarker studies.
17. **Bland-Altman**: Method comparison studies; used in clinical measurement validation.
18. **Multiple linear regression / logistic regression**: More common in clinical or epidemiological work than typical bench biology.
19. **Goodness-of-fit / binomial tests**: Specific applications (e.g., segregation ratios in genetics).
20. **Three-way ANOVA**: Rare; required only for complex factorial designs.

### The Minimum Viable Set for a Prism Alternative

A client-side Prism alternative targeting wet-lab biologists should implement these first, in order of impact:

1. Unpaired t test (Welch, equal-variance, Mann-Whitney fallback)
2. Paired t test (and Wilcoxon signed rank fallback)
3. One-way ANOVA with Tukey and Dunnett multiple comparisons
4. Two-way ANOVA with Tukey/Sidak/Bonferroni multiple comparisons
5. Nonlinear regression: 4PL dose-response (variable slope, log-dose form, with EC50/IC50 output and 95% CI)
6. Nonlinear regression: Michaelis-Menten enzyme kinetics
7. Nonlinear regression: one-phase and two-phase exponential decay/association
8. Kaplan-Meier survival curves with log-rank test
9. Pearson and Spearman correlation
10. Simple linear regression

These ten analysis types cover the majority of the analyses in a typical cell biology, pharmacology, or biochemistry paper. Fisher's exact test, one-sample t test, and column statistics (descriptive + normality) would round out an initial release.
