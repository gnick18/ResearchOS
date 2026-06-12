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

import type {
  NormalizedAnova,
  NormalizedCorrelation,
  NormalizedDoseResponse,
  NormalizedRegression,
  NormalizedResult,
  NormalizedSurvival,
  NormalizedTTest,
  NormalizedTwoWayAnova,
  RunGroup,
} from "@/lib/datahub/run-analysis";

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
print(f"chi2 = {res.test_statistic:.4g}, p = {res.p_value:.4g}")`;
}

/**
 * The reproducible Python snippet for a normalized analysis result, with the
 * real group names and values baked in so it reproduces the on-screen numbers.
 */
export function showCode(result: NormalizedResult): string {
  if (result.kind === "anova") return anovaCode(result);
  if (result.kind === "correlation") return correlationCode(result);
  if (result.kind === "regression") return regressionCode(result);
  if (result.kind === "doseResponse") return doseResponseCode(result);
  if (result.kind === "twoWayAnova") return twoWayCode(result);
  if (result.kind === "survival") return survivalCode(result);
  return ttestCode(result);
}
