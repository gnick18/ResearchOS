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
  NormalizedRegression,
  NormalizedResult,
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
print(tukey)`;
}

function ttestCode(r: NormalizedTTest): string {
  const gv = groupVars(r.groups);
  const [a, b] = gv;
  const assigns = gv
    .map((o) => `${o.var} = ${pyList(o.group.values)}`)
    .join("\n");

  if (r.type === "pairedTTest") {
    return `from scipy import stats

${assigns}

# Paired (repeated-measures) t-test on the row-matched values
t, p = stats.ttest_rel(${a.var.trim()}, ${b.var.trim()})
print(f"t = {t:.4g}, p = {p:.4g}")`;
  }

  if (r.type === "mannWhitneyU") {
    return `from scipy import stats

${assigns}

# Mann-Whitney U (rank-sum), the nonparametric two-independent-groups test
U, p = stats.mannwhitneyu(${a.var.trim()}, ${b.var.trim()}, alternative="two-sided")
print(f"U = {U:.4g}, p = {p:.4g}")`;
  }

  if (r.type === "wilcoxonSignedRank") {
    return `from scipy import stats

${assigns}

# Wilcoxon signed-rank, the nonparametric paired test on row-matched values
W, p = stats.wilcoxon(${a.var.trim()}, ${b.var.trim()})
print(f"W = {W:.4g}, p = {p:.4g}")`;
  }

  // Unpaired Welch (equal_var=False) is the engine default.
  return `from scipy import stats

${assigns}

# Welch's unpaired t-test (does not assume equal variance)
t, p = stats.ttest_ind(${a.var.trim()}, ${b.var.trim()}, equal_var=False)
print(f"t = {t:.4g}, p = {p:.4g}")`;
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
print(f"r = {r:.4g}, p = {p:.4g}")`;
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

/**
 * The reproducible Python snippet for a normalized analysis result, with the
 * real group names and values baked in so it reproduces the on-screen numbers.
 */
export function showCode(result: NormalizedResult): string {
  if (result.kind === "anova") return anovaCode(result);
  if (result.kind === "correlation") return correlationCode(result);
  if (result.kind === "regression") return regressionCode(result);
  if (result.kind === "twoWayAnova") return twoWayCode(result);
  return ttestCode(result);
}
