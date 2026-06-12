// show-code.ts
//
// Generate the reproducible Python (scipy.stats / statsmodels) that reproduces
// each Data Hub analysis, parameterized by the REAL group names and values, so a
// researcher can paste it into a notebook and get the same numbers. This is the
// Show-the-code differentiator from the mockup, the answer to "where did this
// number come from" that a closed tool like Prism cannot give.
//
// Pure string building. No engine call, no I/O. The verbatim values come from
// the same RunGroup arrays the engine saw, so the snippet and the on-screen
// result are computed from one source.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { globalFitSharedNames } from "@/lib/datahub/analysis-params";
import type {
  NormalizedAnova,
  NormalizedCorrelation,
  NormalizedDoseResponse,
  NormalizedGlobalFit,
  NormalizedLogisticRegression,
  NormalizedMultipleRegression,
  NormalizedModelComparison,
  NormalizedRegression,
  NormalizedResult,
  NormalizedRmAnova,
  NormalizedMixedModel,
  NormalizedSurvival,
  NormalizedCoxRegression,
  NormalizedGrubbsOutlier,
  NormalizedTTest,
  NormalizedTwoWayAnova,
  RunGroup,
} from "@/lib/datahub/run-analysis";

/**
 * Python model definitions for the comparison snippet, one per fittable model in
 * the engine registry. Each entry gives a unique function name, the def body, its
 * parameter count, and a data-driven p0 expression that mirrors the engine's
 * initialGuess so curve_fit lands on the same fit. Keyed by the engine model id.
 */
const PY_MODELS: Record<
  string,
  { name: string; def: string; nParams: number; p0: string }
> = {
  logistic4pl: {
    name: "model_logistic4pl",
    def:
      "def model_logistic4pl(x, bottom, top, logec50, hill):\n" +
      "    return bottom + (top - bottom) / (1 + 10**((logec50 - x) * hill))",
    nParams: 4,
    p0:
      "[min(y), max(y), x[min(range(len(x)), key=lambda i: abs(y[i] - (min(y)+max(y))/2))], 1.0]",
  },
  logistic5pl: {
    name: "model_logistic5pl",
    def:
      "def model_logistic5pl(x, bottom, top, logec50, hill, s):\n" +
      "    return bottom + (top - bottom) / (1 + 10**((logec50 - x) * hill))**s",
    nParams: 5,
    p0:
      "[min(y), max(y), x[min(range(len(x)), key=lambda i: abs(y[i] - (min(y)+max(y))/2))], 1.0, 1.0]",
  },
  "michaelis-menten": {
    name: "model_michaelis_menten",
    def:
      "def model_michaelis_menten(x, vmax, km):\n" +
      "    return vmax * x / (km + x)",
    nParams: 2,
    p0: "[max(y) * 1.1, max(np.mean(x), 1e-6)]",
  },
  "exp-decay-1phase": {
    name: "model_exp_decay",
    def:
      "def model_exp_decay(x, y0, plateau, k):\n" +
      "    return plateau + (y0 - plateau) * np.exp(-k * x)",
    nParams: 3,
    p0: "[y[0], y[-1], 1.0 / (max(x) - min(x) or 1)]",
  },
  "exp-association-1phase": {
    name: "model_exp_association",
    def:
      "def model_exp_association(x, y0, plateau, k):\n" +
      "    return y0 + (plateau - y0) * (1 - np.exp(-k * x))",
    nParams: 3,
    p0: "[y[0], y[-1], 1.0 / (max(x) - min(x) or 1)]",
  },
  linear: {
    name: "model_linear",
    def: "def model_linear(x, slope, intercept):\n    return slope * x + intercept",
    nParams: 2,
    p0: "[0.0, np.mean(y)]",
  },
  polynomial2: {
    name: "model_polynomial2",
    def: "def model_polynomial2(x, a, b, c):\n    return a * x * x + b * x + c",
    nParams: 3,
    p0: "[0.0, 0.0, np.mean(y)]",
  },
  gaussian: {
    name: "model_gaussian",
    def:
      "def model_gaussian(x, amp, mu, sigma, offset):\n" +
      "    return amp * np.exp(-((x - mu)**2) / (2 * sigma * sigma)) + offset",
    nParams: 4,
    p0:
      "[max(y) - min(y), x[max(range(len(y)), key=lambda i: y[i])], (max(x) - min(x))/4 or 1, min(y)]",
  },
};

/** A Python identifier from a group name (lowercase, non-word to underscore). */
function pyVar(name: string, fallback: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base === "" || /^[0-9]/.test(base)) return fallback;
  return base;
}

/** Render a number list as a Python list literal. */
function pyList(values: number[]): string {
  return `[${values.join(", ")}]`;
}

/** A Python string literal (double-quoted, escaped). */
function pyStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Assign each group a unique, padded Python variable name. */
function groupVars(groups: RunGroup[]): { group: RunGroup; var: string }[] {
  const used = new Set<string>();
  const out: { group: RunGroup; var: string }[] = [];
  groups.forEach((g, i) => {
    let v = pyVar(g.name, `group_${i + 1}`);
    let n = 2;
    while (used.has(v)) v = `${pyVar(g.name, `group_${i + 1}`)}_${n++}`;
    used.add(v);
    out.push({ group: g, var: v });
  });
  // Pad the assignment names so the = signs line up (readability matters here).
  const width = Math.max(...out.map((o) => o.var.length));
  return out.map((o) => ({ ...o, var: o.var.padEnd(width) }));
}

/**
 * Omnibus effect-size block (E1) for a parametric one-way ANOVA. eta-squared is
 * SS_between / SS_total and omega-squared is the less biased
 * (SS_between - df_between * MS_within) / (SS_total + MS_within), both read off the
 * one-way ANOVA table statsmodels already fits. Emitted only for the parametric
 * ANOVA (Kruskal-Wallis is a rank test with no sums of squares). `argList` is the
 * comma-joined group variable names so the snippet reuses the same arrays.
 */
function anovaEffectSizeBlock(argList: string): string {
  return `# Effect size: eta-squared (share of variance explained) and the less
# biased omega-squared, from the one-way ANOVA sums of squares.
import numpy as np
es_groups = [${argList}]
es_all = np.concatenate([np.asarray(g, float) for g in es_groups])
grand = np.mean(es_all)
ss_between = sum(len(g) * (np.mean(g) - grand) ** 2 for g in es_groups)
ss_within = sum(((np.asarray(g, float) - np.mean(g)) ** 2).sum() for g in es_groups)
ss_total = ss_between + ss_within
df_between = len(es_groups) - 1
df_within = len(es_all) - len(es_groups)
ms_within = ss_within / df_within
eta2 = ss_between / ss_total
omega2 = (ss_between - df_between * ms_within) / (ss_total + ms_within)
print(f"eta-squared = {eta2:.4g}, omega-squared = {omega2:.4g}")`;
}

function anovaCode(r: NormalizedAnova): string {
  const gv = groupVars(r.groups);
  const assigns = gv
    .map((o) => `${o.var} = ${pyList(o.group.values)}`)
    .join("\n");
  const argList = gv.map((o) => o.var.trim()).join(", ");
  const endog = gv.map((o) => o.var.trim()).join(" + ");
  const groupsExpr = gv
    .map((o) => `${pyStr(o.group.name)}] * ${o.group.values.length}`)
    .map((s, i) => (i === 0 ? `[${s}` : `[${s}`))
    .join(" + ");

  if (r.nonparametric) {
    // Kruskal-Wallis with Dunn post-hoc (scikit-posthocs), the rank-based
    // counterpart of ANOVA + Tukey.
    return `from scipy import stats
import scikit_posthocs as sp

${assigns}

# Kruskal-Wallis H test (rank-based, no normality assumption)
H, p = stats.kruskal(${argList})
print(f"H = {H:.4g}, p = {p:.4g}")

# Dunn pairwise comparisons with Bonferroni adjustment
dunn = sp.posthoc_dunn([${argList}], p_adjust="bonferroni")
print(dunn)`;
  }

  const omnibus = `from scipy import stats

${assigns}

# Omnibus one-way ANOVA
F, p = stats.f_oneway(${argList})
print(f"F = {F:.4g}, p = {p:.4g}")`;

  const esBlock = anovaEffectSizeBlock(argList);

  if (r.postHoc === "none") {
    // No post-hoc family selected, so the snippet stops at the omnibus test plus
    // its effect size.
    return `${omnibus}\n\n${esBlock}`;
  }

  if (r.postHoc === "tukey") {
    return `from scipy import stats
import statsmodels.stats.multicomp as mc

${assigns}

# Omnibus one-way ANOVA
F, p = stats.f_oneway(${argList})
print(f"F = {F:.4g}, p = {p:.4g}")

# Tukey HSD pairwise comparisons (family-wise alpha = 0.05)
tukey = mc.pairwise_tukeyhsd(
    endog=${endog},
    groups=${groupsExpr},
)
print(tukey)

${esBlock}`;
  }

  // Sidak / Bonferroni / Holm-Sidak adjust the per-pair t-test p-values.
  // statsmodels uses these method names directly in multipletests.
  const methodArg =
    r.postHoc === "holm-sidak" ? "holm-sidak" : r.postHoc;
  return `from scipy import stats
from statsmodels.stats.multitest import multipletests
from itertools import combinations

${assigns}

# Omnibus one-way ANOVA
F, p = stats.f_oneway(${argList})
print(f"F = {F:.4g}, p = {p:.4g}")

# Pairwise t-tests with ${methodArg} correction (family-wise alpha = 0.05)
groups = {${gv.map((o) => `${pyStr(o.group.name)}: ${o.var.trim()}`).join(", ")}}
names = list(groups)
raw = [stats.ttest_ind(groups[a], groups[b]).pvalue
       for a, b in combinations(names, 2)]
reject, adj, *_ = multipletests(raw, alpha=0.05, method=${pyStr(methodArg)})
for (a, b), pa in zip(combinations(names, 2), adj):
    print(f"{a} vs {b}: adj p = {pa:.4g}")

${esBlock}`;
}

/**
 * Effect-size block (E1) for a parametric two-group t-test. pingouin's
 * compute_effsize gives Cohen's d (unpaired) / dz (paired) and Hedges' g with the
 * same pooled-SD convention the engine uses, so the printed d / g reproduce the
 * on-screen effect size. The rank tests have no parametric standardized d, so this
 * is only emitted for the unpaired / paired t-tests. `paired=True` selects the
 * within-pair (dz) form for the paired test.
 */
function effectSizeBlock(
  aVar: string,
  bVar: string,
  paired: boolean,
): string {
  const eftype = "cohen";
  const pairedArg = paired ? ", paired=True" : "";
  const label = paired ? "Cohen's dz" : "Cohen's d";
  return `# Effect size: ${label} and the bias-corrected Hedges' g (pingouin)
import pingouin as pg
d = pg.compute_effsize(${aVar}, ${bVar}, eftype=${pyStr(eftype)}${pairedArg})
g = pg.compute_effsize(${aVar}, ${bVar}, eftype="hedges"${pairedArg})
print(f"d = {d:.4g}, Hedges g = {g:.4g}")`;
}

/**
 * Bootstrap block (E4) reproducing the distribution-free 95% CI of the mean
 * difference, emitted only when the run carried a bootstrapCI95. The engine uses a
 * seeded resampler (BCa, B = 2000) so a JS PRNG cannot match scipy resample for
 * resample; scipy.stats.bootstrap with its own RNG converges to the same interval
 * but will not be bit-identical. The snippet says so and uses a fixed numpy seed so
 * the researcher's own re-runs are at least reproducible to each other.
 */
function bootstrapBlock(aVar: string, bVar: string): string {
  return `# Distribution-free bootstrap 95% CI of the mean difference (BCa, the
# robust companion to the parametric CI above). A bootstrap draws random
# resamples, so this scipy interval converges to the engine's CI (B = 2000, BCa)
# but is not bit-identical, since the two use different PRNGs. The seed below
# just makes your own re-runs reproducible.
import numpy as np
from scipy.stats import bootstrap

def mean_diff(x, y):
    return np.mean(x) - np.mean(y)

res = bootstrap((${aVar}, ${bVar}), mean_diff, n_resamples=2000,
                method="BCa", confidence_level=0.95, vectorized=False,
                random_state=np.random.default_rng(0))
print(f"bootstrap 95% CI = [{res.confidence_interval.low:.4g}, "
      f"{res.confidence_interval.high:.4g}]")`;
}

function ttestCode(r: NormalizedTTest): string {
  const gv = groupVars(r.groups);
  const [a, b] = gv;
  const assigns = gv
    .map((o) => `${o.var} = ${pyList(o.group.values)}`)
    .join("\n");

  // scipy's `alternative` matches our tail values one for one ("two-sided",
  // "greater", "less"), so the snippet always reflects the actual run rather
  // than a fixed two-sided assumption.
  const altArg = `alternative=${pyStr(r.tail)}`;

  if (r.type === "pairedTTest") {
    const blocks = [
      `from scipy import stats

${assigns}

# Paired (repeated-measures) t-test on the row-matched values
t, p = stats.ttest_rel(${a.var.trim()}, ${b.var.trim()}, ${altArg})
print(f"t = {t:.4g}, p = {p:.4g}")`,
      effectSizeBlock(a.var.trim(), b.var.trim(), true),
    ];
    if (r.bootstrapCI95) blocks.push(bootstrapBlock(a.var.trim(), b.var.trim()));
    return blocks.join("\n\n");
  }

  if (r.type === "mannWhitneyU") {
    return `from scipy import stats

${assigns}

# Mann-Whitney U (rank-sum), the nonparametric two-independent-groups test
U, p = stats.mannwhitneyu(${a.var.trim()}, ${b.var.trim()}, ${altArg})
print(f"U = {U:.4g}, p = {p:.4g}")`;
  }

  if (r.type === "wilcoxonSignedRank") {
    return `from scipy import stats

${assigns}

# Wilcoxon signed-rank, the nonparametric paired test on row-matched values
W, p = stats.wilcoxon(${a.var.trim()}, ${b.var.trim()}, ${altArg})
print(f"W = {W:.4g}, p = {p:.4g}")`;
  }

  // Unpaired t-test. Welch (equal_var=False) is the default; Student pools the
  // variances (equal_var=True). The comment and the equal_var flag both follow
  // the chosen variance assumption so the code matches the on-screen numbers.
  const student = r.variance === "student";
  const equalVar = student ? "True" : "False";
  const comment = student
    ? "# Student's unpaired t-test (assumes equal variance, pooled)"
    : "# Welch's unpaired t-test (does not assume equal variance)";
  const blocks = [
    `from scipy import stats

${assigns}

${comment}
t, p = stats.ttest_ind(${a.var.trim()}, ${b.var.trim()}, equal_var=${equalVar}, ${altArg})
print(f"t = {t:.4g}, p = {p:.4g}")`,
    effectSizeBlock(a.var.trim(), b.var.trim(), false),
  ];
  if (r.bootstrapCI95) blocks.push(bootstrapBlock(a.var.trim(), b.var.trim()));
  return blocks.join("\n\n");
}

function correlationCode(r: NormalizedCorrelation): string {
  const x = pyList(r.x);
  const y = pyList(r.y);
  if (r.method === "spearman") {
    return `from scipy import stats

x = ${x}
y = ${y}

# Spearman rank correlation (monotone, no normality assumption)
rho, p = stats.spearmanr(x, y)
print(f"rho = {rho:.4g}, p = {p:.4g}")`;
  }
  return `from scipy import stats

x = ${x}
y = ${y}

# Pearson linear correlation
r, p = stats.pearsonr(x, y)
print(f"r = {r:.4g}, p = {p:.4g}")

# Effect size: r-squared, the share of variance the linear fit explains
print(f"r-squared = {r ** 2:.4g}")`;
}

function regressionCode(r: NormalizedRegression): string {
  return `from scipy import stats

x = ${pyList(r.x)}
y = ${pyList(r.y)}

# Ordinary least squares linear regression y = intercept + slope * x
fit = stats.linregress(x, y)
print(f"slope = {fit.slope:.4g}, intercept = {fit.intercept:.4g}")
print(f"R-squared = {fit.rvalue ** 2:.4g}, slope SE = {fit.stderr:.4g}")`;
}

/**
 * Reproducible scipy.optimize.curve_fit for a dose-response fit (4PL default,
 * 5PL when the analysis chose the asymmetric model). Emits the model def, the
 * curve_fit call with the same data-driven initial guess the engine uses, and the
 * EC50 / Hill readout. The 5PL EC50 readout uses the closed-form half-max
 * correction (the EC50 is NOT 10^logEC50 when S != 1), the same formula the engine
 * documents, so the printed EC50 matches the on-screen value.
 */
/**
 * Reproducible Python for simple (binary) logistic regression via statsmodels
 * Logit. add_constant gives params[0] = intercept, params[1] = slope. The odds
 * ratio is exp(slope) with the exponentiated Wald CI, and result.prsquared is the
 * McFadden pseudo-R-squared the sheet shows. The same fixed X and binary Y are
 * baked in so the printout reproduces the on-screen numbers.
 */
function logisticRegressionCode(r: NormalizedLogisticRegression): string {
  return `import numpy as np
import statsmodels.api as sm

x = ${pyList(r.x)}
y = ${pyList(r.y)}  # binary outcome (0 or 1)

# Simple logistic regression P(Y=1) = 1 / (1 + exp(-(b0 + b1*x))), fit by maximum
# likelihood. add_constant makes params[0] the intercept and params[1] the slope.
X = sm.add_constant(np.asarray(x, float))
result = sm.Logit(np.asarray(y, float), X).fit(disp=0)

print(result.summary())

b0, b1 = result.params
se = result.bse
# Odds ratio for the slope = exp(b1), with the exponentiated 95% Wald CI.
odds_ratio = np.exp(b1)
or_lo, or_hi = np.exp(b1 - 1.959964 * se[1]), np.exp(b1 + 1.959964 * se[1])
print(f"odds ratio = {odds_ratio:.4g}  95% CI [{or_lo:.4g}, {or_hi:.4g}]")

# The x where P = 0.5 is -b0/b1 (the dose-response-style midpoint).
print(f"X at P=0.5 = {-b0 / b1:.4g}")
print(f"McFadden pseudo-R2 = {result.prsquared:.4g}")`;
}

function multipleRegressionCode(r: NormalizedMultipleRegression): string {
  // One numpy array per predictor column so the snippet reads like a real script.
  const cols = r.predictorNames
    .map((name, j) => {
      const col = r.predictors.map((row) => row[j]);
      const safe = name.replace(/[^A-Za-z0-9_]/g, "_") || `x${j + 1}`;
      return `${safe} = ${pyList(col)}`;
    })
    .join("\n");
  const stacked = r.predictorNames
    .map((name, j) => name.replace(/[^A-Za-z0-9_]/g, "_") || `x${j + 1}`)
    .join(", ");
  return `import numpy as np
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor

y = ${pyList(r.y)}
${cols}

# Multiple linear regression y = b0 + b1*x1 + ... + bk*xk by ordinary least
# squares. add_constant puts the intercept first, so params[0] is b0.
X = sm.add_constant(np.column_stack([${stacked}]))
result = sm.OLS(np.asarray(y, float), X).fit()

print(result.summary())

# Each predictor's variance inflation factor (multicollinearity). Index 0 is the
# constant, so the predictors start at index 1.
for i in range(1, X.shape[1]):
    print(f"VIF[{i}] = {variance_inflation_factor(X, i):.4g}")`;
}

function doseResponseCode(r: NormalizedDoseResponse): string {
  const x = pyList(r.x);
  const y = pyList(r.y);
  if (r.model === "logistic5pl") {
    return `import numpy as np
from scipy.optimize import curve_fit
from scipy import stats

x = ${x}
y = ${y}

# 5-parameter logistic (asymmetric), x = log10(dose). Bottom, Top, logEC50,
# HillSlope, S. The 4PL is the special case S = 1.
def model_5pl(x, bottom, top, logec50, hill, s):
    return bottom + (top - bottom) / (1 + 10**((logec50 - x) * hill))**s

# Data-driven starting guess: plateaus from the data range, logEC50 at the
# half-max x, slope 1, symmetric (S = 1) to start.
lo, hi = min(y), max(y)
mid = (lo + hi) / 2
x_mid = x[min(range(len(x)), key=lambda i: abs(y[i] - mid))]
p0 = [lo, hi, x_mid, 1.0, 1.0]

popt, pcov = curve_fit(model_5pl, x, y, p0=p0, maxfev=200000)
bottom, top, logec50, hill, s = popt
perr = np.sqrt(np.diag(pcov))

# The EC50 is the dose at the half-maximal response, which for S != 1 is NOT
# 10**logEC50. Solve model = (Top+Bottom)/2 for x:
#   x_EC50 = logEC50 - log10(2**(1/S) - 1) / HillSlope
shift = -np.log10(2**(1.0/s) - 1.0) / hill
logec50_true = logec50 + shift
ec50 = 10**logec50_true

# 95% CI on the EC50: t-based CI on the logEC50 parameter, shifted to the true
# half-max logEC50, then exponentiated (asymmetric in dose units).
df = len(x) - len(popt)
tcrit = stats.t.ppf(0.975, df)
lo_log = logec50 - tcrit * perr[2] + shift
hi_log = logec50 + tcrit * perr[2] + shift
print(f"EC50 = {ec50:.4g}  95% CI [{10**lo_log:.4g}, {10**hi_log:.4g}]")
print(f"Hill = {hill:.4g}, Top = {top:.4g}, Bottom = {bottom:.4g}, S = {s:.4g}")

resid = y - model_5pl(np.asarray(x), *popt)
ss_res = np.sum(resid**2)
ss_tot = np.sum((np.asarray(y) - np.mean(y))**2)
print(f"R-squared = {1 - ss_res/ss_tot:.4g}")`;
  }
  return `import numpy as np
from scipy.optimize import curve_fit
from scipy import stats

x = ${x}
y = ${y}

# 4-parameter logistic (variable slope), x = log10(dose). The Prism
# "log(agonist) vs response" dose-response model. Bottom, Top, logEC50, HillSlope.
def model_4pl(x, bottom, top, logec50, hill):
    return bottom + (top - bottom) / (1 + 10**((logec50 - x) * hill))

# Data-driven starting guess: plateaus from the data range, logEC50 at the
# half-max x, slope 1.
lo, hi = min(y), max(y)
mid = (lo + hi) / 2
x_mid = x[min(range(len(x)), key=lambda i: abs(y[i] - mid))]
p0 = [lo, hi, x_mid, 1.0]

popt, pcov = curve_fit(model_4pl, x, y, p0=p0, maxfev=200000)
bottom, top, logec50, hill = popt
perr = np.sqrt(np.diag(pcov))

# EC50 (the IC50 for an inhibition curve) is the dose at the half-maximal
# response. For the symmetric 4PL that is exactly 10**logEC50.
ec50 = 10**logec50

# 95% CI on the EC50: t-based CI on logEC50, then exponentiated (asymmetric in
# dose units because the fit is symmetric in log space).
df = len(x) - len(popt)
tcrit = stats.t.ppf(0.975, df)
print(f"EC50 = {ec50:.4g}  95% CI [{10**(logec50 - tcrit*perr[2]):.4g}, "
      f"{10**(logec50 + tcrit*perr[2]):.4g}]")
print(f"Hill = {hill:.4g}, Top = {top:.4g}, Bottom = {bottom:.4g}")

resid = y - model_4pl(np.asarray(x), *popt)
ss_res = np.sum(resid**2)
ss_tot = np.sum((np.asarray(y) - np.mean(y))**2)
print(f"R-squared = {1 - ss_res/ss_tot:.4g}")`;
}

/**
 * Reproducible Python for the model comparison: fit both models to the same XY
 * data with scipy.optimize.curve_fit, then compute the extra-sum-of-squares F
 * test (for a nested pair) and AICc for each model. The model defs and the same
 * data-driven p0 the engine uses are baked in so the printed F / p / AICc match
 * the on-screen numbers. AICc uses K = n_params + 1 (the +1 for the variance).
 */
function modelComparisonCode(r: NormalizedModelComparison): string {
  const x = pyList(r.x);
  const y = pyList(r.y);
  const s = PY_MODELS[r.simpler.id];
  const c = PY_MODELS[r.complex.id];
  if (!s || !c) {
    return "# Model comparison snippet unavailable for the chosen models.";
  }
  const fBlock = r.nested
    ? `
# Extra-sum-of-squares F test (the two models are nested, the simpler model is a
# special case of the complex one). model 2 = complex (more params, fewer df).
df1 = len(x) - ${s.nParams}
df2 = len(x) - ${c.nParams}
f_stat = ((ss_simple - ss_complex) / (df1 - df2)) / (ss_complex / df2)
p_f = stats.f.sf(f_stat, df1 - df2, df2)
print(f"F({df1 - df2}, {df2}) = {f_stat:.4g}, p = {p_f:.4g}")
print("F test prefers:", "${c.name}" if p_f < 0.05 else "${s.name}")
`
    : `
# The models are not nested, so the extra-sum-of-squares F test does not apply.
# Compare them with AICc only.
`;
  return `import numpy as np
from scipy.optimize import curve_fit
from scipy import stats

x = ${x}
y = ${y}
xa = np.asarray(x, dtype=float)
ya = np.asarray(y, dtype=float)

# Simpler model (fewer parameters).
${s.def}
# More complex model.
${c.def}

popt_s, _ = curve_fit(${s.name}, x, y, p0=${s.p0}, maxfev=200000)
popt_c, _ = curve_fit(${c.name}, x, y, p0=${c.p0}, maxfev=200000)

ss_simple = np.sum((ya - ${s.name}(xa, *popt_s))**2)
ss_complex = np.sum((ya - ${c.name}(xa, *popt_c))**2)

def aicc(ss, n_params, n):
    k = n_params + 1  # +1 for the estimated residual variance
    return n * np.log(ss / n) + 2*k + (2*k*(k+1)) / (n - k - 1)

n = len(x)
aicc_s = aicc(ss_simple, ${s.nParams}, n)
aicc_c = aicc(ss_complex, ${c.nParams}, n)
delta = abs(aicc_s - aicc_c)
# Akaike weights (probability each model is the better of the two).
w = np.exp(-0.5 * (np.array([aicc_s, aicc_c]) - min(aicc_s, aicc_c)))
prob = w / w.sum()
print(f"AICc: simpler = {aicc_s:.4g}, complex = {aicc_c:.4g}, delta = {delta:.4g}")
print(f"Probabilities: simpler = {prob[0]:.4g}, complex = {prob[1]:.4g}")
print("AICc prefers:", "${c.name}" if aicc_c < aicc_s else "${s.name}")
${fBlock}`;
}

/**
 * Reproducible Python for the GLOBAL (shared-parameter) fit. Builds a stacked
 * residual closure over every curve with scipy.optimize.least_squares, where the
 * packed vector holds one slot per SHARED parameter and one slot per dataset per
 * LOCAL parameter, exactly the engine's layout. The shared/local split and each
 * curve's data are baked in so the printed shared parameters, each local EC50,
 * and the global R-squared match the on-screen numbers.
 */
function globalFitCode(r: NormalizedGlobalFit): string {
  // Model parameter order matches the engine: Bottom, Top, logEC50, HillSlope (+S).
  const allParams =
    r.model === "logistic5pl"
      ? ["Bottom", "Top", "logEC50", "HillSlope", "S"]
      : ["Bottom", "Top", "logEC50", "HillSlope"];
  const sharedSet = new Set(globalFitSharedNames(r.share));
  // logEC50 is always local in every preset; reflect that here regardless.
  sharedSet.delete("logEC50");
  const isShared = (name: string) => sharedSet.has(name);

  const nCurves = r.curves.length;
  // Build the curve data lists.
  const curveData = r.curves
    .map(
      (c, i) =>
        `x${i} = ${pyList(c.x)}\ny${i} = ${pyList(c.y)}  # ${c.name}`,
    )
    .join("\n");

  // Build the packed-vector layout comment and unpack expressions. We lay shared
  // params first (one slot each), then each local param as a block of nCurves.
  const sharedNames = allParams.filter(isShared);
  const localNames = allParams.filter((nm) => !isShared(nm));
  const layoutParts: string[] = [];
  const unpackLines: string[] = [];
  let cursor = 0;
  for (const nm of sharedNames) {
    layoutParts.push(`${nm}(shared)`);
    unpackLines.push(`    ${nm} = p[${cursor}]`);
    cursor += 1;
  }
  for (const nm of localNames) {
    layoutParts.push(`${nm}(local x${nCurves})`);
    unpackLines.push(
      `    ${nm} = [p[${cursor} + d] for d in range(${nCurves})]`,
    );
    cursor += nCurves;
  }
  const P = cursor;

  // The 4PL / 5PL model body, choosing per-curve local values by index d.
  const modelBody =
    r.model === "logistic5pl"
      ? "bottom + (top - bottom) / (1 + 10**((logec50 - xx) * hill))**s"
      : "bottom + (top - bottom) / (1 + 10**((logec50 - xx) * hill))";

  // For each curve d, the per-parameter value is the shared scalar or the local
  // list indexed by d.
  const valExpr = (nm: string, lower: string) =>
    isShared(nm) ? lower : `${lower}[d]`;
  const evalArgs = [
    `bottom=${valExpr("Bottom", "Bottom")}`,
    `top=${valExpr("Top", "Top")}`,
    `logec50=${valExpr("logEC50", "logEC50")}`,
    `hill=${valExpr("HillSlope", "HillSlope")}`,
  ];
  if (r.model === "logistic5pl") {
    evalArgs.push(`s=${valExpr("S", "S")}`);
  }

  // Initial guess for the packed vector: shared params averaged, local seeded per
  // curve. We just bake the engine's converged-near guess from the data ranges.
  const p0Parts: string[] = [];
  for (const nm of sharedNames) {
    if (nm === "Bottom") p0Parts.push("min(min(y) for y in ys)");
    else if (nm === "Top") p0Parts.push("max(max(y) for y in ys)");
    else if (nm === "HillSlope") p0Parts.push("1.0");
    else if (nm === "S") p0Parts.push("1.0");
  }
  for (const nm of localNames) {
    if (nm === "logEC50") {
      // One starting logEC50 per curve at each curve's own half-max x.
      p0Parts.push(
        `*[x[min(range(len(x)), key=lambda i: abs(y[i] - (min(y)+max(y))/2))] for x, y in zip(xs, ys)]`,
      );
    } else if (nm === "Bottom") p0Parts.push(`*[min(y) for y in ys]`);
    else if (nm === "Top") p0Parts.push(`*[max(y) for y in ys]`);
    else if (nm === "HillSlope") p0Parts.push(`*[1.0 for _ in ys]`);
    else if (nm === "S") p0Parts.push(`*[1.0 for _ in ys]`);
  }

  // The 5PL half-max correction uses each curve's own Hill and S (shared scalar
  // or local list). Index per curve so it is correct whether or not Hill is shared.
  const hillExpr = isShared("HillSlope") ? "HillSlope" : "HillSlope[d]";
  const sExpr = isShared("S") ? "S" : "S[d]";
  const leExpr = "logEC50[d]";
  const ec50Line =
    r.model === "logistic5pl"
      ? `ec50 = []
for d in range(${nCurves}):
    shift = -np.log10(2**(1.0/(${sExpr})) - 1.0) / (${hillExpr})  # half-max correction
    ec50.append(10**(${leExpr} + shift))`
      : `ec50 = [10**le for le in logEC50]`;

  const xsList = Array.from({ length: nCurves }, (_, i) => `x${i}`).join(", ");
  const ysList = Array.from({ length: nCurves }, (_, i) => `y${i}`).join(", ");
  const names = r.curves.map((c) => pyStr(c.name)).join(", ");

  return `import numpy as np
from scipy.optimize import least_squares

# Global (shared-parameter) dose-response fit. One ${
    r.model === "logistic5pl" ? "5PL" : "4PL"
  } curve shape is fit to
# every dataset at once. Shared parameters take one value across all curves;
# local parameters are fit separately per curve.
${curveData}

xs = [${xsList}]
ys = [${ysList}]
names = [${names}]

def curve(xx, bottom, top, logec50, hill${r.model === "logistic5pl" ? ", s" : ""}):
    return ${modelBody}

# Packed parameter vector layout: ${layoutParts.join(", ")}
# (${P} parameters total across ${nCurves} curves).
def unpack(p):
${unpackLines.join("\n")}
    return ${allParams.join(", ")}

def residuals(p):
    ${allParams.join(", ")} = unpack(p)
    res = []
    for d in range(${nCurves}):
        xa = np.asarray(xs[d], dtype=float)
        res.append(curve(xa, ${evalArgs.join(", ")}) - np.asarray(ys[d], dtype=float))
    return np.concatenate(res)

p0 = [${p0Parts.join(", ")}]
sol = least_squares(residuals, p0, method="lm", max_nfev=200000)
${allParams.join(", ")} = unpack(sol.x)

# EC50 per curve (10**logEC50 for the 4PL; half-max-corrected for the 5PL).
${ec50Line}
for nm, e in zip(names, ec50):
    print(f"{nm}: EC50 = {e:.4g}")
print("Shared:", ${sharedNames.map((nm) => `f"${nm}={${nm}:.4g}"`).join(", ") || '"(none)"'})

# Global R-squared pools every point of every curve about one mean.
y_all = np.concatenate([np.asarray(y, dtype=float) for y in ys])
ss_res = float(np.sum(residuals(sol.x)**2))
ss_tot = float(np.sum((y_all - y_all.mean())**2))
print(f"Global R-squared = {1 - ss_res/ss_tot:.6g}")`;
}

function twoWayCode(r: NormalizedTwoWayAnova): string {
  // Reconstruct the long-format observations from the ANOVA so the snippet
  // builds the same DataFrame statsmodels fits (factorA x factorB with repeats).
  const rows: string[] = [];
  // The normalized result does not carry the raw cells, so emit a template the
  // researcher fills with their table; statsmodels' OLS + anova_lm is the
  // standard two-way path with an interaction term.
  rows.push("import pandas as pd");
  rows.push("import statsmodels.api as sm");
  rows.push("from statsmodels.formula.api import ols");
  rows.push("");
  rows.push("# df has columns: factorA (the row label), factorB (the group),");
  rows.push("# and value (each replicate). One row per replicate observation.");
  rows.push('# df = pd.DataFrame({"factorA": [...], "factorB": [...], "value": [...]})');
  rows.push("");
  rows.push('model = ols("value ~ C(factorA) + C(factorB) + C(factorA):C(factorB)", data=df).fit()');
  rows.push("print(sm.stats.anova_lm(model, typ=2))");
  return rows.join("\n");
}

function survivalCode(r: NormalizedSurvival): string {
  if (r.groups.length < 2) {
    return `from lifelines import KaplanMeierFitter

# durations = each subject's time; events = 1 if the event happened, 0 if censored
# durations = [...]; events = [...]
kmf = KaplanMeierFitter()
kmf.fit(durations, events)
print(kmf.median_survival_time_)
kmf.plot_survival_function()`;
  }
  return `from lifelines import KaplanMeierFitter
from lifelines.statistics import multivariate_logrank_test

# df has columns: duration, event (1/0), and group (the arm label).
# df = pd.DataFrame({"duration": [...], "event": [...], "group": [...]})

for name, sub in df.groupby("group"):
    kmf = KaplanMeierFitter()
    kmf.fit(sub["duration"], sub["event"], label=name)
    print(name, kmf.median_survival_time_)

res = multivariate_logrank_test(df["duration"], df["group"], df["event"])
print(f"log-rank chi2 = {res.test_statistic:.4g}, p = {res.p_value:.4g}")

# Gehan-Breslow-Wilcoxon is the same comparison with each event time weighted
# by the number at risk, so early deaths count more. Two groups here.
from lifelines.statistics import logrank_test
g = sorted(df["group"].unique())
a = df[df["group"] == g[0]]
b = df[df["group"] == g[1]]
gbw = logrank_test(
    a["duration"], b["duration"],
    event_observed_A=a["event"], event_observed_B=b["event"],
    weightings="wilcoxon",
)
print(f"Gehan-Breslow-Wilcoxon chi2 = {gbw.test_statistic:.4g}, p = {gbw.p_value:.4g}")`;
}

function coxRegressionCode(r: NormalizedCoxRegression): string {
  const covName = r.coefficients[0]?.name ?? "arm";
  return `from lifelines import CoxPHFitter

# df has columns: duration, event (1/0), and ${covName} (the arm indicator,
# 1 for the comparison arm and 0 for the reference arm). Efron tie handling
# is lifelines' default, so the coefficients match what the Data Hub reports.
# df = pd.DataFrame({"duration": [...], "event": [...], "${covName}": [...]})

cph = CoxPHFitter()
cph.fit(df, duration_col="duration", event_col="event")
cph.print_summary()  # coef, exp(coef) = hazard ratio, se, z, p, 95% CI
print("log-likelihood", cph.log_likelihood_)
print("concordance", cph.concordance_index_)`;
}

/**
 * One-way repeated-measures ANOVA. statsmodels AnovaRM gives the uncorrected
 * F / df / p; pingouin rm_anova gives the same F plus the Greenhouse-Geisser and
 * Huynh-Feldt sphericity corrections (epsilon + corrected p) and partial
 * eta-squared. The condition columns are baked in as parallel arrays and stacked
 * into the long-form dataframe both tools read (one row per subject-condition).
 */
function rmAnovaCode(r: NormalizedRmAnova): string {
  const gv = groupVars(r.groups);
  const assigns = gv
    .map((o) => `${o.var} = ${pyList(o.group.values)}`)
    .join("\n");
  const condArrays = gv.map((o) => o.var.trim()).join(", ");
  const condNames = gv.map((o) => pyStr(o.group.name.trim())).join(", ");
  return `import numpy as np
import pandas as pd
import pingouin as pg
from statsmodels.stats.anova import AnovaRM

# Each array is one within-subject condition; row i is the same subject i.
${assigns}

conditions = [${condArrays}]
labels = [${condNames}]
n = len(conditions[0])

# Stack into the long-form frame both tools read (one row per subject-condition).
rows = []
for subj in range(n):
    for label, values in zip(labels, conditions):
        rows.append({"subject": subj, "condition": label, "value": values[subj]})
df = pd.DataFrame(rows)

# Uncorrected F / df / p (statsmodels AnovaRM)
aov = AnovaRM(df, depvar="value", subject="subject", within=["condition"]).fit()
print(aov.anova_table)

# Sphericity corrections + partial eta-squared (pingouin)
rm = pg.rm_anova(
    data=df, dv="value", within="condition", subject="subject",
    correction=True, detailed=True,
)
eff = rm[rm["Source"] == "condition"].iloc[0]
err = rm[rm["Source"] == "Error"].iloc[0]
partial_eta_sq = eff["SS"] / (eff["SS"] + err["SS"])
hf_eps = pg.epsilon(data=df, dv="value", within="condition",
                    subject="subject", correction="hf")
print(f"partial eta-squared = {partial_eta_sq:.4g}")
print(f"Greenhouse-Geisser epsilon = {eff['eps']:.4g}, p-GG = {eff['p_GG_corr']:.4g}")
print(f"Huynh-Feldt epsilon = {hf_eps:.4g}")`;
}

function mixedModelCode(r: NormalizedMixedModel): string {
  const gv = groupVars(r.groups);
  const assigns = gv
    .map((o) => `${o.var} = ${pyList(o.group.values)}`)
    .join("\n");
  const condArrays = gv.map((o) => o.var.trim()).join(", ");
  const condNames = gv.map((o) => pyStr(o.group.name.trim())).join(", ");
  return `import numpy as np
import pandas as pd
import statsmodels.api as sm

# Each array is one within-subject condition; row i is the same subject i.
${assigns}

conditions = [${condArrays}]
labels = [${condNames}]
n = len(conditions[0])

# Stack into long form (one row per subject-condition) for the mixed model.
rows = []
for subj in range(n):
    for label, values in zip(labels, conditions):
        rows.append({"subject": subj, "condition": label, "value": values[subj]})
df = pd.DataFrame(rows)

# Treatment-code condition with the first label as the reference so the
# intercept is the reference-condition mean and each other coefficient is that
# condition minus the reference.
df["condition"] = pd.Categorical(df["condition"], categories=labels)

# Random-intercept linear mixed model, fit by REML (the statsmodels default).
# The random intercept (re_formula="1") lets each subject have its own baseline.
md = sm.MixedLM.from_formula(
    "value ~ C(condition)", groups="subject", re_formula="1", data=df
)
mdf = md.fit(reml=True, method="lbfgs")
print(mdf.summary())

# Variance components and the REML log-likelihood.
print(f"between-subject variance = {mdf.cov_re.iloc[0, 0]:.6g}")
print(f"residual variance = {mdf.scale:.6g}")
print(f"REML log-likelihood = {mdf.llf:.6g}")`;
}

/**
 * Grubbs outlier test. There is no scipy.stats.grubbs, so the snippet computes
 * the two-sided Grubbs G and the Bonferroni-corrected critical value by hand from
 * scipy.stats.t (the same definition the engine uses), and runs the iterative
 * sweep the same way. Each selected column is screened on its own. This needs
 * only scipy, no extra package, so it matches the on-screen flags exactly.
 */
function grubbsCode(r: NormalizedGrubbsOutlier): string {
  // Bake each screened column's real array in by name so the snippet reproduces
  // the on-screen flags exactly.
  const gv = groupVars(
    r.columns.map(
      (c): RunGroup => ({
        columnId: c.columnId,
        name: c.name,
        values: c.values,
      }),
    ),
  );
  const entries = gv
    .map((o) => `    ${pyStr(o.group.name.trim())}: ${pyList(o.group.values)},`)
    .join("\n");
  const colNames = gv.map((o) => pyStr(o.group.name.trim())).join(", ");
  return `import numpy as np
from scipy import stats

# One array per screened column. The screen below reproduces the Data Hub flags
# for alpha = ${r.alpha} in ${
    r.iterative ? "iterative" : "single-point"
  } mode.
columns = {
${entries}
}
labels = [${colNames}]

def grubbs_critical(n, alpha=${r.alpha}):
    # Bonferroni-corrected two-sided Grubbs critical value at sample size n.
    if n < 3:
        return float("nan")
    df = n - 2
    t = stats.t.ppf(1 - alpha / (2 * n), df)  # upper alpha/(2n) critical
    return ((n - 1) / np.sqrt(n)) * np.sqrt(t**2 / (df + t**2))

def grubbs(values, alpha=${r.alpha}, iterative=${r.iterative ? "True" : "False"}):
    x = list(map(float, values))
    flagged = []
    while len(x) >= 3:
        arr = np.asarray(x, float)
        mean, sd = arr.mean(), arr.std(ddof=1)  # sample sd (n - 1)
        i = int(np.argmax(np.abs(arr - mean)))
        g = 0.0 if sd == 0 else abs(arr[i] - mean) / sd
        g_crit = grubbs_critical(len(x), alpha)
        print(f"n={len(x)} value={x[i]:.4g} G={g:.4f} G_crit={g_crit:.4f} "
              f"outlier={g > g_crit}")
        if g <= g_crit:
            break
        flagged.append(x.pop(i))
        if not iterative:
            break
    return flagged

for label in labels:
    print(label)
    out = grubbs(columns[label])
    print("  flagged:", out, "cleaned n:", len(columns[label]) - len(out))`;
}

/**
 * The reproducible Python snippet for a normalized analysis result, with the
 * real group names and values baked in so it reproduces the on-screen numbers.
 */
export function showCode(result: NormalizedResult): string {
  if (result.kind === "anova") return anovaCode(result);
  if (result.kind === "rmAnova") return rmAnovaCode(result);
  if (result.kind === "mixedModel") return mixedModelCode(result);
  if (result.kind === "correlation") return correlationCode(result);
  if (result.kind === "regression") return regressionCode(result);
  if (result.kind === "logisticRegression")
    return logisticRegressionCode(result);
  if (result.kind === "multipleRegression")
    return multipleRegressionCode(result);
  if (result.kind === "doseResponse") return doseResponseCode(result);
  if (result.kind === "modelComparison") return modelComparisonCode(result);
  if (result.kind === "globalFit") return globalFitCode(result);
  if (result.kind === "twoWayAnova") return twoWayCode(result);
  if (result.kind === "survival") return survivalCode(result);
  if (result.kind === "coxRegression") return coxRegressionCode(result);
  if (result.kind === "grubbsOutlier") return grubbsCode(result);
  return ttestCode(result);
}
