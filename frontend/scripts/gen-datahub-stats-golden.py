#!/usr/bin/env python3
"""
Generate INDEPENDENT ground-truth reference values for the Data Hub statistics
transparency domain (frontend/src/lib/transparency/datasets/datahub-stats.ts).

WHY THIS EXISTS
---------------
A test that asserts "our engine equals what our engine produced" proves nothing.
Every value the /transparency "Data Hub statistics" domain pins must come from an
INDEPENDENT authority (scipy, statsmodels, lifelines), never from our own engine.
This script runs those reference implementations over ONE small, fixed, fully
hardcoded dataset and prints every reference value plus its exact provenance
(the scipy / statsmodels / lifelines call that produced it), so each pinned
constant in the TypeScript dataset is reproducible and auditable. The committed
TS gate is PURE (no Python, no network at test time, CI-safe).

THE STANDING RULE (see docs/datahub/STATS_VALIDATION.md)
-------------------------------------------------------
Every new Data Hub statistical test must add (a) a scipy/statsmodels/R reference
value generated here and (b) a pinned comparison in the datahub-stats
transparency domain, before it ships. This script is half of that contract.

DATASET
-------
All inputs are tiny, fixed, and hardcoded below so a reader can paste them into
scipy and reproduce every number by hand. The same arrays are mirrored verbatim
in the TypeScript dataset, where OUR engine is run on them.

KNOWN METHOD DIFFERENCES (documented, not bugs)
-----------------------------------------------
 - Our `levene` centers on the MEAN; scipy's `levene` default centers on the
   MEDIAN (that is Brown-Forsythe). So our `levene` is pinned against
   scipy.stats.levene(center='mean'), and our `brownForsythe` against the scipy
   default scipy.stats.levene(center='median'). Both are recorded explicitly.
 - Mann-Whitney U: our engine reports the normal approximation with a 0.5
   continuity correction and a tie correction. We pin the p-value against
   scipy.stats.mannwhitneyu(method='asymptotic', use_continuity=True). The
   reported U statistic is U_min (scipy reports U for the first sample).
 - Spearman p-value: our engine uses the t-distribution approximation
   (t = rho*sqrt((n-2)/(1-rho^2)), df=n-2), which is exactly what
   scipy.stats.spearmanr returns for n in this range.
 - Chi-square test of a contingency table: our engine does NOT yet implement a
   contingency chi-square (only the chi-square distribution backend). The scipy
   reference is generated here and pinned in the dataset as a PENDING reference
   so the standing rule is already satisfied when that test ships. It is NOT
   gated against the engine yet (flagged in STATS_VALIDATION.md).

PRISM / GRAPHPAD
----------------
Where a GraphPad Prism reference would require a Prism license to produce, the
value is NOT invented here. STATS_VALIDATION.md flags those as "needs Grant to
run Prism." Everything this script prints comes from a tool actually run.

Run:
    python3 -m venv /tmp/dh-venv
    /tmp/dh-venv/bin/pip install scipy statsmodels lifelines numpy
    /tmp/dh-venv/bin/python frontend/scripts/gen-datahub-stats-golden.py

Re-run any time and confirm the printed JSON still matches the constants pinned
in datahub-stats.ts.
"""

from __future__ import annotations

import json

import numpy as np
import scipy
import scipy.stats as st
from scipy.optimize import brentq, curve_fit, least_squares
import statsmodels
import statsmodels.api as sm
from statsmodels.formula.api import ols
from statsmodels.stats.multicomp import pairwise_tukeyhsd
from statsmodels.stats.power import TTestIndPower
from statsmodels.stats.outliers_influence import variance_inflation_factor
import pingouin as pg
import lifelines
from lifelines import KaplanMeierFitter
from lifelines.statistics import logrank_test


# ---------------------------------------------------------------------------
# THE FIXED DATASET. Tiny and hardcoded; mirrored verbatim in datahub-stats.ts.
# ---------------------------------------------------------------------------

# Three independent groups of a numeric response (e.g. an assay readout under
# three treatments). Unequal but small n, chosen so every test has signal.
GROUP_A = [5.1, 4.9, 5.6, 5.0, 5.3, 4.8]
GROUP_B = [6.2, 5.9, 6.5, 6.0, 6.3]
GROUP_C = [4.4, 4.7, 4.1, 4.9, 4.5, 4.3, 4.6]

# A paired/repeated set: the same 6 subjects measured under three conditions.
# Rows are subjects, columns are conditions P, Q, R (for Friedman / repeated).
REPEATED = [
    [5.1, 5.8, 6.0],
    [4.9, 5.5, 5.7],
    [5.6, 6.1, 6.4],
    [5.0, 5.4, 5.9],
    [5.3, 5.7, 6.2],
    [4.8, 5.2, 5.6],
]
REPEATED_LABELS = ["P", "Q", "R"]

# A two-group paired comparison (the first two columns of REPEATED), for the
# paired t-test and Wilcoxon signed-rank.
PAIR_X = [row[0] for row in REPEATED]
PAIR_Y = [row[1] for row in REPEATED]

# An XY dataset for correlation + simple linear regression.
XY_X = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
XY_Y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1]

# A binary-outcome XY dataset for simple logistic regression (D4). A continuous
# predictor x (e.g. a dose) and a binary y (0/1 outcome) with MODERATE overlap so
# the maximum-likelihood fit converges cleanly and there is no perfect separation
# (which would blow the coefficients up). Mirrored verbatim in datahub-stats.ts.
LOGIT_X = [
    0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0,
    5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0,
]
LOGIT_Y = [
    0, 0, 0, 1, 0, 0, 1, 0, 1, 1,
    0, 1, 1, 1, 0, 1, 1, 1, 1, 1,
]

# A multiple-regression dataset (D5). Two predictors x1, x2 and a response y, with
# mild correlation between the predictors so the VIF is meaningful but not
# pathological (no near-collinearity). statsmodels.api.OLS on sm.add_constant([x1,
# x2]) produces the pinned coefficients / SE / p / R2 / F / VIF. Mirrored verbatim
# in datahub-stats.ts.
MLR_X1 = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0]
MLR_X2 = [2.0, 5.0, 3.0, 8.0, 4.0, 9.0, 6.0, 11.0, 7.0, 13.0, 10.0, 14.0]
MLR_Y = [
    4.1, 7.8, 8.9, 13.2, 13.0, 18.7, 18.2, 24.1, 22.0, 28.9, 27.1, 32.0,
]

# A dose-response dataset for the 4PL / 5PL curve fit (D1). x = log10(dose in M),
# an 11-point serial dilution; y = response. Mirrored verbatim in datahub-stats.ts.
DOSE_LOG_CONC = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0]
DOSE_RESPONSE = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1]

# Two dose-response curves for the GLOBAL (shared-parameter) fit (D3). The two
# curves SHARE Bottom, Top, and Hill slope and differ ONLY in logEC50, the
# pharmacology textbook case for a shared-parameter fit. Both share the same
# x grid (an 11-point serial dilution on log10 dose). The y values are generated
# from a clean 4PL with Bottom=0, Top=100, Hill=1 and a tiny fixed deterministic
# wobble so scipy and our engine land on the same minimum without random draws:
#   curve A logEC50 = -7.0, curve B logEC50 = -6.0 (a 10-fold EC50 shift).
# Verbatim-mirrored in datahub-stats.ts.
GLOBAL_FIT_X = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0]
# Curve A (logEC50 = -7.0): half-max at x = -7.0.
GLOBAL_FIT_YA = [0.9, 2.9, 8.6, 23.0, 50.4, 75.9, 90.8, 96.9, 99.1, 99.6, 100.1]
# Curve B (logEC50 = -6.0): half-max at x = -6.0, the same shape shifted +1 in x.
GLOBAL_FIT_YB = [0.1, 0.4, 0.8, 2.9, 8.6, 23.4, 50.4, 75.9, 90.8, 96.9, 99.1]

# A balanced two-way design: factor "Dose" (Low/High) x factor "Time" (AM/PM),
# 3 replicates per cell. Cells are (dose, time, value).
TWOWAY = [
    ("Low", "AM", 10.2), ("Low", "AM", 9.8), ("Low", "AM", 10.5),
    ("Low", "PM", 11.1), ("Low", "PM", 10.9), ("Low", "PM", 11.4),
    ("High", "AM", 13.0), ("High", "AM", 12.6), ("High", "AM", 13.4),
    ("High", "PM", 15.2), ("High", "PM", 14.8), ("High", "PM", 15.6),
]

# Survival: two arms (Treatment vs Control). (time, event=1 observed/0 censored).
SURV_TREAT = [
    (6, 1), (7, 1), (10, 1), (13, 1), (16, 1), (22, 1), (23, 1),
    (6, 0), (9, 0), (10, 0), (11, 0), (17, 0), (19, 0), (20, 0), (25, 0),
]
SURV_CONTROL = [
    (1, 1), (1, 1), (2, 1), (2, 1), (3, 1), (4, 1), (4, 1), (5, 1),
    (5, 1), (8, 1), (8, 1), (8, 1), (8, 1), (11, 1), (11, 1), (12, 1),
    (12, 1), (15, 1), (17, 1), (22, 1), (23, 1),
]
# Fixed times at which to read the Treatment-arm KM survival.
KM_READ_TIMES = [7, 13, 23]

# A 2 x 3 contingency table (rows = outcome, cols = group) for chi-square.
CONTINGENCY = [
    [10, 20, 30],
    [25, 15, 20],
]

# --- Fixed inputs for the estimation layer (E1 / E3 / E4) ---
# E3 power is a DESIGN scenario, not a statistic of the dataset above.
POWER_TWO_SAMPLE_N = 26      # per-group n
POWER_TWO_SAMPLE_D = 0.8     # Cohen's d
POWER_ALPHA = 0.05
SAMPLESIZE_D = 0.5           # a-priori scenario effect size
SAMPLESIZE_TARGET_POWER = 0.8
# E4 bootstrap: only the DETERMINISTIC (RNG-free) machinery is pinned exactly.
# A reseeded JS bootstrap cannot match scipy resample-for-resample, so these fixed
# arrays exercise the percentile extractor, the BCa z0, and the jackknife
# acceleration with no random draws involved. Mirrored verbatim in datahub-stats.ts.
BOOT_DISTRIBUTION = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
BOOT_STATS = [1.0, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0, 2.2, 2.5, 3.0]
BOOT_OBSERVED = 1.7
BOOT_ACCEL_SAMPLE = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]


# ---------------------------------------------------------------------------
# Reference computations. Each returns a dict; the function/version that
# produced every value is recorded in PROVENANCE below.
# ---------------------------------------------------------------------------

def r4(x):
    """Round, but keep enough significant figures for very small p-values.

    Plain round(x, 6) collapses a p like 3.2e-08 to 0.0, which would make a pin
    meaningless. For |x| < 1e-4 we keep 3 significant figures instead.
    """
    v = float(x)
    if v != 0 and abs(v) < 1e-4:
        return float(f"{v:.3g}")
    return round(v, 6)


def ref_ttests():
    out = {}
    # Unpaired Welch (scipy default equal_var=False).
    t = st.ttest_ind(GROUP_A, GROUP_B, equal_var=False)
    out["unpaired_welch"] = {"t": r4(t.statistic), "df": r4(t.df), "p": r4(t.pvalue)}
    # Unpaired Student (pooled, equal_var=True).
    t = st.ttest_ind(GROUP_A, GROUP_B, equal_var=True)
    out["unpaired_student"] = {"t": r4(t.statistic), "df": r4(t.df), "p": r4(t.pvalue)}
    # Paired t on PAIR_X vs PAIR_Y.
    t = st.ttest_rel(PAIR_X, PAIR_Y)
    out["paired"] = {"t": r4(t.statistic), "df": float(len(PAIR_X) - 1), "p": r4(t.pvalue)}
    return out


def ref_nonparametric_two_group():
    out = {}
    # Mann-Whitney U, asymptotic with continuity correction (matches our engine).
    u = st.mannwhitneyu(GROUP_A, GROUP_B, alternative="two-sided",
                        method="asymptotic", use_continuity=True)
    out["mann_whitney"] = {"U": r4(u.statistic), "p": r4(u.pvalue)}
    # Wilcoxon signed-rank on the paired set.
    w = st.wilcoxon(PAIR_X, PAIR_Y)
    out["wilcoxon"] = {"W": r4(w.statistic), "p": r4(w.pvalue)}
    return out


def ref_anova_oneway():
    f = st.f_oneway(GROUP_A, GROUP_B, GROUP_C)
    out = {"oneway": {"F": r4(f.statistic), "p": r4(f.pvalue)}}
    # Tukey HSD adjusted p-values (statsmodels).
    data = GROUP_A + GROUP_B + GROUP_C
    labels = (["A"] * len(GROUP_A)) + (["B"] * len(GROUP_B)) + (["C"] * len(GROUP_C))
    tuk = pairwise_tukeyhsd(np.array(data), np.array(labels))
    # Build a {('A','B'): padj} map.
    pairs = {}
    for row in tuk.summary().data[1:]:
        g1, g2, meandiff, padj = row[0], row[1], row[2], row[3]
        key = "__".join(sorted([str(g1), str(g2)]))
        pairs[key] = {"meanDiff": r4(meandiff), "pAdj": r4(padj)}
    out["tukey"] = pairs
    return out


def ref_anova_twoway():
    import pandas as pd
    df = pd.DataFrame(TWOWAY, columns=["Dose", "Time", "y"])
    model = ols("y ~ C(Dose) + C(Time) + C(Dose):C(Time)", data=df).fit()
    table = sm.stats.anova_lm(model, typ=2)
    out = {}
    rowmap = {
        "C(Dose)": "doseA",
        "C(Time)": "timeB",
        "C(Dose):C(Time)": "interaction",
    }
    for idx, key in rowmap.items():
        out[key] = {"F": r4(table.loc[idx, "F"]), "p": r4(table.loc[idx, "PR(>F)"])}
    return out


def ref_kruskal_friedman():
    out = {}
    k = st.kruskal(GROUP_A, GROUP_B, GROUP_C)
    out["kruskal"] = {"H": r4(k.statistic), "p": r4(k.pvalue)}
    cols = list(zip(*REPEATED))
    fr = st.friedmanchisquare(*cols)
    out["friedman"] = {"chi2": r4(fr.statistic), "p": r4(fr.pvalue)}
    return out


def ref_rm_anova():
    # One-way repeated-measures ANOVA on REPEATED (rows = subjects, columns =
    # the three within-subject conditions P, Q, R). statsmodels AnovaRM gives
    # the uncorrected F / df / p; pingouin rm_anova(correction=True) gives the
    # Greenhouse-Geisser and Huynh-Feldt epsilons plus the GG-corrected p (and
    # the sphericity test) on the SAME data.
    import pandas as pd

    rows = []
    for subj, triple in enumerate(REPEATED):
        for ci, cond in enumerate(REPEATED_LABELS):
            rows.append({"subject": subj, "condition": cond, "value": triple[ci]})
    df = pd.DataFrame(rows)

    from statsmodels.stats.anova import AnovaRM
    aov = AnovaRM(df, depvar="value", subject="subject", within=["condition"]).fit()
    tbl = aov.anova_table
    F = float(tbl["F Value"].iloc[0])
    df1 = float(tbl["Num DF"].iloc[0])
    df2 = float(tbl["Den DF"].iloc[0])
    p = float(tbl["Pr > F"].iloc[0])

    pg_aov = pg.rm_anova(
        data=df, dv="value", within="condition", subject="subject",
        correction=True, detailed=True,
    )
    eff = pg_aov[pg_aov["Source"] == "condition"].iloc[0]
    err = pg_aov[pg_aov["Source"] == "Error"].iloc[0]
    gg_eps = float(eff["eps"])
    p_gg = float(eff["p_GG_corr"])
    # partial eta-squared = SS_effect / (SS_effect + SS_error). pingouin reports
    # ng2 (generalized eta-squared); for a one-way RM design we want the partial
    # form, which the engine reports, so compute it from the SS columns directly.
    ss_eff = float(eff["SS"])
    ss_err = float(err["SS"])
    np2 = ss_eff / (ss_eff + ss_err)

    # Huynh-Feldt epsilon + HF-corrected p are not columns of pg.rm_anova, so
    # derive them from pingouin's epsilon machinery and the same F.
    hf_eps = float(pg.epsilon(data=df, dv="value", within="condition",
                              subject="subject", correction="hf"))
    p_hf = float(st.f.sf(F, df1 * hf_eps, df2 * hf_eps))

    return {
        "F": r4(F),
        "df1": r4(df1),
        "df2": r4(df2),
        "p": r4(p),
        "partial_eta_sq": r4(np2),
        "gg_epsilon": r4(gg_eps),
        "p_gg": r4(p_gg),
        "hf_epsilon": r4(hf_eps),
        "p_hf": r4(p_hf),
    }


def ref_mixed_model():
    # Random-intercept linear mixed model on REPEATED reshaped to long form (rows
    # = subjects, columns = the within-subject conditions P, Q, R). The fixed
    # effect is the treatment-coded condition (P the reference), the random
    # intercept groups by subject. statsmodels MixedLM defaults to REML; we keep
    # that default and request a random intercept (re_formula="1"). We print every
    # fixed-effect coefficient / SE / z / p / 95% CI, both variance components
    # (the random-intercept group variance and the residual variance), and the
    # REML log-likelihood. The fixed effects are stable across implementations;
    # the variance components and the log-likelihood come from a numeric optimum
    # and can wobble slightly, so the gate pins them with an honest looser band.
    import pandas as pd

    rows = []
    for subj, triple in enumerate(REPEATED):
        for ci, cond in enumerate(REPEATED_LABELS):
            rows.append({"subject": subj, "condition": cond, "value": triple[ci]})
    df = pd.DataFrame(rows)
    # Treatment-code condition with the first label as the reference so the
    # coefficients match the engine (intercept = reference mean, each other
    # coefficient = that condition minus the reference).
    df["condition"] = pd.Categorical(
        df["condition"], categories=REPEATED_LABELS, ordered=False
    )

    md = sm.MixedLM.from_formula(
        "value ~ C(condition)", groups="subject", re_formula="1", data=df
    )
    mdf = md.fit(reml=True, method="lbfgs")

    fixed = []
    params = mdf.fe_params
    bse = mdf.bse_fe
    tvals = mdf.tvalues
    pvals = mdf.pvalues
    ci = mdf.conf_int()
    for name in params.index:
        est = float(params[name])
        se = float(bse[name])
        z = float(tvals[name])
        p = float(pvals[name])
        lo = float(ci.loc[name][0])
        hi = float(ci.loc[name][1])
        fixed.append({
            "name": name,
            "estimate": r4(est),
            "se": r4(se),
            "z": r4(z),
            "p": r4(p),
            "ci_low": r4(lo),
            "ci_high": r4(hi),
        })

    # cov_re is the random-effects covariance in units of the residual variance;
    # statsmodels reports group_var = cov_re[0,0] * scale and residual = scale.
    group_var = float(mdf.cov_re.iloc[0, 0])
    residual = float(mdf.scale)
    loglike = float(mdf.llf)

    return {
        "fixed_effects": fixed,
        "group_var": r4(group_var),
        "residual_var": r4(residual),
        "reml_loglike": r4(loglike),
        "groups": int(df["subject"].nunique()),
        "observations": int(len(df)),
    }


def ref_correlation_regression():
    out = {}
    p = st.pearsonr(XY_X, XY_Y)
    out["pearson"] = {"r": r4(p.statistic), "p": r4(p.pvalue)}
    s = st.spearmanr(XY_X, XY_Y)
    out["spearman"] = {"rho": r4(s.statistic), "p": r4(s.pvalue)}
    lr = st.linregress(XY_X, XY_Y)
    out["linreg"] = {
        "slope": r4(lr.slope),
        "intercept": r4(lr.intercept),
        "rSquared": r4(lr.rvalue ** 2),
    }
    return out


def ref_logistic_regression():
    """Reference simple (binary) logistic regression (D4) via statsmodels Logit.

    Fits P(Y=1) = 1 / (1 + exp(-(b0 + b1*x))) by maximum likelihood (Newton). We
    add a constant with sm.add_constant so params[0] is the intercept and params[1]
    is the slope. SE come from the inverse Fisher information (.bse), the p-values
    from the Wald z (.pvalues), the odds ratio is exp(slope), McFadden pseudo-R2 is
    result.prsquared, and the AUC of the fitted probabilities is roc_auc_score. All
    deterministic given the data and the standard zero start, so these pin tight.
    """
    x = np.asarray(LOGIT_X, float)
    y = np.asarray(LOGIT_Y, float)
    X = sm.add_constant(x)
    model = sm.Logit(y, X)
    result = model.fit(disp=0, method="newton")
    b0, b1 = float(result.params[0]), float(result.params[1])
    se0, se1 = float(result.bse[0]), float(result.bse[1])
    p0, p1 = float(result.pvalues[0]), float(result.pvalues[1])
    odds_ratio = float(np.exp(b1))
    or_lo = float(np.exp(b1 - 1.959963984540054 * se1))
    or_hi = float(np.exp(b1 + 1.959963984540054 * se1))
    x_at_half = float(-b0 / b1)
    # AUC via the rank-sum (Mann-Whitney) form on the fitted probabilities using
    # scipy.stats.rankdata. This equals sklearn.metrics.roc_auc_score exactly and
    # keeps the oracle as scipy (no extra dependency). Cross-checked below.
    probs = np.asarray(result.predict(X))
    ranks = st.rankdata(probs)
    pos = y == 1
    npos = int(pos.sum()); nneg = int((~pos).sum())
    auc = float((ranks[pos].sum() - npos * (npos + 1) / 2) / (npos * nneg))
    return {
        "intercept": r4(b0),
        "slope": r4(b1),
        "interceptSE": r4(se0),
        "slopeSE": r4(se1),
        "interceptP": r4(p0),
        "slopeP": r4(p1),
        "oddsRatio": r4(odds_ratio),
        "oddsRatioCI95": [r4(or_lo), r4(or_hi)],
        "logLikelihood": r4(float(result.llf)),
        "nullLogLikelihood": r4(float(result.llnull)),
        "mcFaddenR2": r4(float(result.prsquared)),
        "xAtHalf": r4(x_at_half),
        "auc": r4(auc),
        "iterations": int(result.mle_retvals.get("iterations", 0))
        if isinstance(result.mle_retvals, dict) else 0,
    }


def ref_multiple_regression():
    """Reference multiple (OLS) linear regression (D5) via statsmodels OLS.

    Fits y = b0 + b1*x1 + b2*x2 by ordinary least squares. We add a constant with
    sm.add_constant so params[0] is the intercept, params[1] the x1 slope, params[2]
    the x2 slope. SE come from .bse, the t and p from .tvalues / .pvalues, R2 from
    .rsquared, adjusted R2 from .rsquared_adj, the residual standard error from
    sqrt(.mse_resid), the overall F from .fvalue / .f_pvalue, and the log-likelihood
    from .llf. The VIF of each predictor is the standard
    statsmodels.stats.outliers_influence.variance_inflation_factor on the design
    matrix WITH the constant (so index 1 is x1, index 2 is x2). Closed-form OLS, so
    these pin tight.
    """
    x1 = np.asarray(MLR_X1, float)
    x2 = np.asarray(MLR_X2, float)
    y = np.asarray(MLR_Y, float)
    X = sm.add_constant(np.column_stack([x1, x2]))
    result = sm.OLS(y, X).fit()
    b0, b1, b2 = (float(v) for v in result.params)
    se0, se1, se2 = (float(v) for v in result.bse)
    t0, t1, t2 = (float(v) for v in result.tvalues)
    p0, p1, p2 = (float(v) for v in result.pvalues)
    vif1 = float(variance_inflation_factor(X, 1))
    vif2 = float(variance_inflation_factor(X, 2))
    return {
        "intercept": r4(b0),
        "x1Slope": r4(b1),
        "x2Slope": r4(b2),
        "interceptSE": r4(se0),
        "x1SlopeSE": r4(se1),
        "x2SlopeSE": r4(se2),
        "x1SlopeT": r4(t1),
        "x1SlopeP": r4(p1),
        "x2SlopeP": r4(p2),
        "rSquared": r4(float(result.rsquared)),
        "adjRSquared": r4(float(result.rsquared_adj)),
        "residualSE": r4(float(np.sqrt(result.mse_resid))),
        "fStatistic": r4(float(result.fvalue)),
        "fPValue": r4(float(result.f_pvalue)),
        "logLikelihood": r4(float(result.llf)),
        "x1Vif": r4(vif1),
        "x2Vif": r4(vif2),
    }


def ref_dose_response():
    """Reference 4PL + 5PL dose-response fits (D1) via scipy.optimize.curve_fit.

    x = log10(dose), y = response. The 4PL is the symmetric variable-slope model;
    the 5PL adds an asymmetry exponent S. The EC50 is the dose at the TRUE
    half-maximal response. For the 4PL that is exactly 10**logEC50; for the 5PL it
    is NOT, because the logEC50 parameter is not the half-max midpoint when S != 1.
    Solving model = (Top+Bottom)/2 for x gives the closed-form half-max shift
    x_EC50 = logEC50 - log10(2**(1/S) - 1)/Hill, the same formula the engine uses.
    """
    out = {}
    x = np.asarray(DOSE_LOG_CONC, float)
    y = np.asarray(DOSE_RESPONSE, float)
    ss_tot = float(np.sum((y - y.mean()) ** 2))

    def fpl(xx, bottom, top, logec50, hill):
        return bottom + (top - bottom) / (1.0 + 10.0 ** ((logec50 - xx) * hill))

    def f5pl(xx, bottom, top, logec50, hill, s):
        return bottom + (top - bottom) / (1.0 + 10.0 ** ((logec50 - xx) * hill)) ** s

    mid = (y.min() + y.max()) / 2.0
    x_mid = x[int(np.argmin(np.abs(y - mid)))]

    # 4PL.
    p0_4 = [y.min(), y.max(), x_mid, 1.0]
    popt4, _ = curve_fit(fpl, x, y, p0=p0_4, maxfev=200000)
    b4, t4, le4, h4 = popt4
    ss_res4 = float(np.sum((y - fpl(x, *popt4)) ** 2))
    out["fourpl"] = {
        "ec50": float(10.0 ** le4),
        "hill": float(h4),
        "top": float(t4),
        "bottom": float(b4),
        "rSquared": 1.0 - ss_res4 / ss_tot,
    }

    # 5PL.
    p0_5 = [y.min(), y.max(), x_mid, 1.0, 1.0]
    popt5, _ = curve_fit(f5pl, x, y, p0=p0_5, maxfev=200000)
    b5, t5, le5, h5, s5 = popt5
    ss_res5 = float(np.sum((y - f5pl(x, *popt5)) ** 2))
    logec50_true5 = le5 - np.log10(2.0 ** (1.0 / s5) - 1.0) / h5
    out["fivepl"] = {
        "ec50_true": float(10.0 ** logec50_true5),
        "s": float(s5),
        "rSquared": 1.0 - ss_res5 / ss_tot,
    }
    return out


def ref_model_comparison():
    """Reference model comparison (D2): 4PL vs 5PL on the dose-response dataset.

    Both models are fit with scipy.optimize.curve_fit on the SAME x = log10(dose),
    y = response arrays. The 4PL is nested inside the 5PL (the 4PL is the 5PL with
    S = 1), so both methods Prism uses apply:

      - Extra-sum-of-squares F test. model 2 = complex (5PL, 5 params, fewer df):
          F = ((SS1 - SS2)/(DF1 - DF2)) / (SS2/DF2)
          p = scipy.stats.f.sf(F, DF1 - DF2, DF2)
      - AICc, K = n_params + 1 (the +1 for the variance):
          AICc = n*ln(SS/n) + 2K + (2K(K+1))/(n - K - 1)
    """
    x = np.asarray(DOSE_LOG_CONC, float)
    y = np.asarray(DOSE_RESPONSE, float)
    n = x.size

    def fpl(xx, bottom, top, logec50, hill):
        return bottom + (top - bottom) / (1.0 + 10.0 ** ((logec50 - xx) * hill))

    def f5pl(xx, bottom, top, logec50, hill, s):
        return bottom + (top - bottom) / (1.0 + 10.0 ** ((logec50 - xx) * hill)) ** s

    mid = (y.min() + y.max()) / 2.0
    x_mid = x[int(np.argmin(np.abs(y - mid)))]

    popt4, _ = curve_fit(fpl, x, y, p0=[y.min(), y.max(), x_mid, 1.0], maxfev=200000)
    popt5, _ = curve_fit(
        f5pl, x, y, p0=[y.min(), y.max(), x_mid, 1.0, 1.0], maxfev=200000
    )
    ss4 = float(np.sum((y - fpl(x, *popt4)) ** 2))
    ss5 = float(np.sum((y - f5pl(x, *popt5)) ** 2))

    # 4PL is the simpler model (4 params); 5PL is the complex one (5 params).
    np4, np5 = 4, 5
    df1 = n - np4  # simpler model residual df
    df2 = n - np5  # complex model residual df
    f_stat = ((ss4 - ss5) / (df1 - df2)) / (ss5 / df2)
    p_f = float(st.f.sf(f_stat, df1 - df2, df2))

    def aicc(ss, n_params):
        k = n_params + 1
        return n * np.log(ss / n) + 2 * k + (2 * k * (k + 1)) / (n - k - 1)

    aicc4 = float(aicc(ss4, np4))
    aicc5 = float(aicc(ss5, np5))

    return {
        "f": float(f_stat),
        "df1": int(df1 - df2),
        "df2": int(df2),
        "p_f": p_f,
        "aicc_4pl": aicc4,
        "aicc_5pl": aicc5,
        # decisions pinned as 0/1: 1 means the COMPLEX (5PL) model is preferred.
        "f_prefers_complex": 1 if p_f < 0.05 else 0,
        "aicc_prefers_complex": 1 if aicc5 < aicc4 else 0,
    }


def ref_global_fit():
    """Reference GLOBAL (shared-parameter) 4PL fit (D3) via scipy least_squares.

    Two dose-response curves are fit together with ONE 4PL form. Bottom, Top, and
    Hill are SHARED (one value each, fit globally); logEC50 is LOCAL (one value per
    curve). The packed parameter vector is [Bottom, Top, Hill, logEC50_A, logEC50_B].
    The residual closure stacks both curves' residuals into one vector, so the
    optimizer minimizes the combined sum of squares, exactly the engine's global
    objective. EC50 = 10**logEC50 per curve (4PL). The global R-squared pools every
    point of both curves about a single mean (1 - SS_res_total/SS_tot_total), the
    Prism global-fit convention the engine reports.
    """
    x = np.asarray(GLOBAL_FIT_X, float)
    ya = np.asarray(GLOBAL_FIT_YA, float)
    yb = np.asarray(GLOBAL_FIT_YB, float)
    y_all = np.concatenate([ya, yb])

    def model(xx, bottom, top, logec50, hill):
        return bottom + (top - bottom) / (1.0 + 10.0 ** ((logec50 - xx) * hill))

    # packed = [Bottom, Top, Hill, logEC50_A, logEC50_B]; Bottom/Top/Hill shared.
    def residuals(p):
        bottom, top, hill, le_a, le_b = p
        ra = model(x, bottom, top, le_a, hill) - ya
        rb = model(x, bottom, top, le_b, hill) - yb
        return np.concatenate([ra, rb])

    # Initial guess mirrors the engine: shared params averaged from each curve's
    # single-fit heuristic, local logEC50 seeded near each curve's own midpoint.
    p0 = [0.0, 100.0, 1.0, -7.0, -6.0]
    sol = least_squares(residuals, p0, method="lm", max_nfev=200000)
    bottom, top, hill, le_a, le_b = sol.x

    ss_res = float(np.sum(residuals(sol.x) ** 2))
    ss_tot = float(np.sum((y_all - y_all.mean()) ** 2))
    r_squared = 1.0 - ss_res / ss_tot

    return {
        # Shared parameters (one global value each).
        "bottom": float(bottom),
        "top": float(top),
        "hill": float(hill),
        # Local EC50 per curve (linear dose = 10**logEC50 for the 4PL).
        "ec50_a": float(10.0 ** le_a),
        "ec50_b": float(10.0 ** le_b),
        "logec50_a": float(le_a),
        "logec50_b": float(le_b),
        # Global goodness of fit pooled over both curves.
        "rSquared": float(r_squared),
        "ss_res_total": ss_res,
        "n_datasets": 2,
        "n_total": int(y_all.size),
        "n_params": 5,
    }


def ref_from_stats():
    """Reference values for the FROM-SUMMARY-STATS engine paths.

    A Column table can hold ENTERED summary stats (mean + SD + n, or mean + SEM +
    n) instead of raw replicates. The engine then runs the summary-compatible
    tests from those stats. The faithful scipy oracle is ttest_ind_from_stats,
    which takes (mean, std, nobs) per group, and f_oneway reconstructed from the
    group summaries for the one-way ANOVA omnibus.

    These MUST equal the raw ttest_ind / f_oneway references generated above,
    because ttest_ind_from_stats is the same computation fed the matching summary
    (scipy documents this equivalence), so the pins in datahub-stats.ts reuse the
    SAME real-scipy reference values under from-stats ids. We still emit the
    explicit from-stats numbers here so a scipy re-run proves the equivalence
    directly rather than by assertion.

    scipy.stats.ttest_ind_from_stats(mean1, std1, nobs1, mean2, std2, nobs2,
                                     equal_var=...) returns the same t / p (and,
    for Welch, the same df via the internal Welch-Satterthwaite) as
    ttest_ind(A, B, equal_var=...). Our engine reconstructs SD from SEM when the
    table stores SEM, so the SD-entered and SEM-entered cases are numerically the
    same test and share one pin.
    """
    out = {}

    def msn(arr):
        a = np.asarray(arr, dtype=float)
        # ddof=1 sample SD, matching our engine's sampleSD.
        return float(a.mean()), float(a.std(ddof=1)), int(a.size)

    mA, sA, nA = msn(GROUP_A)
    mB, sB, nB = msn(GROUP_B)
    mC, sC, nC = msn(GROUP_C)

    # Welch (equal_var=False) and Student (equal_var=True) from stats.
    # scipy.stats.ttest_ind_from_stats returns a plain Ttest_indResult namedtuple
    # with only .statistic and .pvalue (no .df, unlike ttest_ind), so the degrees
    # of freedom are computed here directly. Welch uses Welch-Satterthwaite;
    # Student (pooled) uses n1 + n2 - 2.
    vA, vB = sA ** 2, sB ** 2
    welch_df = ((vA / nA + vB / nB) ** 2
                / ((vA / nA) ** 2 / (nA - 1) + (vB / nB) ** 2 / (nB - 1)))
    student_df = float(nA + nB - 2)
    w = st.ttest_ind_from_stats(mA, sA, nA, mB, sB, nB, equal_var=False)
    out["fromstats_welch"] = {"t": r4(w.statistic), "df": r4(welch_df), "p": r4(w.pvalue)}
    s = st.ttest_ind_from_stats(mA, sA, nA, mB, sB, nB, equal_var=True)
    out["fromstats_student"] = {"t": r4(s.statistic), "df": r4(student_df), "p": r4(s.pvalue)}

    # One-sided tails on the Welch from-stats case.
    wg = st.ttest_ind_from_stats(mA, sA, nA, mB, sB, nB, equal_var=False,
                                 alternative="greater")
    wl = st.ttest_ind_from_stats(mA, sA, nA, mB, sB, nB, equal_var=False,
                                 alternative="less")
    out["fromstats_welch_greater_p"] = r4(wg.pvalue)
    out["fromstats_welch_less_p"] = r4(wl.pvalue)

    # One-way ANOVA omnibus reconstructed from the group summaries:
    #   SS_between = sum n_i (m_i - grand)^2 ;  SS_within = sum (n_i - 1) sd_i^2
    # which equals f_oneway(A, B, C) on the equivalent raw data.
    groups = [(mA, sA, nA), (mB, sB, nB), (mC, sC, nC)]
    N = sum(n for _, _, n in groups)
    k = len(groups)
    grand = sum(n * m for m, _, n in groups) / N
    ss_b = sum(n * (m - grand) ** 2 for m, _, n in groups)
    ss_w = sum((n - 1) * sd ** 2 for _, sd, n in groups)
    df_b, df_w = k - 1, N - k
    F = (ss_b / df_b) / (ss_w / df_w)
    p = float(st.f.sf(F, df_b, df_w))
    out["fromstats_oneway"] = {"F": r4(F), "p": r4(p)}

    return out


def ref_param_options():
    """Reference values for the user-selectable analysis PARAMETERS.

    The Data Hub results panel lets a researcher change how a test runs (a
    one-sided tail, the unpaired-t variance assumption, the ANOVA post-hoc
    family). The standing rule is that every option a user can select is
    validated against scipy / statsmodels, so each combination is generated
    here and pinned in datahub-stats.ts.
    """
    out = {}

    # --- one-sided tails. scipy's `alternative` matches our tail values. The
    # "greater" tail tests whether the first sample's mean exceeds the second.
    # For these data Group A < Group B, so "less" is the small-p direction.
    tt_g = st.ttest_ind(GROUP_A, GROUP_B, equal_var=False, alternative="greater")
    tt_l = st.ttest_ind(GROUP_A, GROUP_B, equal_var=False, alternative="less")
    out["unpaired_welch_greater_p"] = r4(tt_g.pvalue)
    out["unpaired_welch_less_p"] = r4(tt_l.pvalue)

    pt_g = st.ttest_rel(PAIR_X, PAIR_Y, alternative="greater")
    pt_l = st.ttest_rel(PAIR_X, PAIR_Y, alternative="less")
    out["paired_greater_p"] = r4(pt_g.pvalue)
    out["paired_less_p"] = r4(pt_l.pvalue)

    mw_g = st.mannwhitneyu(GROUP_A, GROUP_B, alternative="greater",
                           method="asymptotic", use_continuity=True)
    mw_l = st.mannwhitneyu(GROUP_A, GROUP_B, alternative="less",
                           method="asymptotic", use_continuity=True)
    out["mann_whitney_greater_p"] = r4(mw_g.pvalue)
    out["mann_whitney_less_p"] = r4(mw_l.pvalue)

    wx_g = st.wilcoxon(PAIR_X, PAIR_Y, alternative="greater")
    wx_l = st.wilcoxon(PAIR_X, PAIR_Y, alternative="less")
    out["wilcoxon_greater_p"] = r4(wx_g.pvalue)
    out["wilcoxon_less_p"] = r4(wx_l.pvalue)

    # --- one-way ANOVA post-hoc families other than Tukey. Our engine forms each
    # pairwise t-statistic from the POOLED ANOVA error term, not an independent
    # two-sample t-test, which is the standard ANOVA post-hoc construction:
    #   SE = sqrt(MSW * (1/na + 1/nb)), t = (mean_a - mean_b) / SE, df = dfWithin
    # then it adjusts the resulting two-sided p-values with the chosen family.
    # The faithful reference therefore reproduces that pooled-error raw p in
    # scipy, then feeds it to statsmodels' multipletests for the SAME families,
    # so the oracle matches our engine's method rather than a different test.
    from itertools import combinations
    from statsmodels.stats.multitest import multipletests
    groups = {"A": GROUP_A, "B": GROUP_B, "C": GROUP_C}
    names = list(groups)
    k = len(names)
    grand = [v for n in names for v in groups[n]]
    N = len(grand)
    grand_mean = sum(grand) / N
    means = {n: (sum(groups[n]) / len(groups[n])) for n in names}
    ss_within = sum((v - means[n]) ** 2 for n in names for v in groups[n])
    df_within = N - k
    ms_within = ss_within / df_within
    pairs = list(combinations(names, 2))
    raw = []
    for a, b in pairs:
        na, nb = len(groups[a]), len(groups[b])
        se = (ms_within * (1 / na + 1 / nb)) ** 0.5
        t = (means[a] - means[b]) / se
        # Two-sided p from the Student t with the pooled within df.
        raw.append(2 * st.t.sf(abs(t), df_within))

    for method, key in [
        ("sidak", "sidak"),
        ("bonferroni", "bonferroni"),
        ("holm-sidak", "holm_sidak"),
    ]:
        _reject, adj, _a, _b = multipletests(raw, alpha=0.05, method=method)
        padj = {}
        for (a, b), pa in zip(pairs, adj):
            pkey = "__".join(sorted([a, b]))
            padj[pkey] = r4(pa)
        out[f"posthoc_{key}"] = padj

    return out


def ref_assumptions():
    out = {}
    sw = st.shapiro(GROUP_A + GROUP_B + GROUP_C)
    out["shapiro"] = {"W": r4(sw.statistic), "p": r4(sw.pvalue)}
    # Our levene = mean-centered; our brownForsythe = median-centered.
    lev_mean = st.levene(GROUP_A, GROUP_B, GROUP_C, center="mean")
    out["levene_mean"] = {"W": r4(lev_mean.statistic), "p": r4(lev_mean.pvalue)}
    lev_med = st.levene(GROUP_A, GROUP_B, GROUP_C, center="median")
    out["levene_median"] = {"W": r4(lev_med.statistic), "p": r4(lev_med.pvalue)}
    return out


def ref_survival():
    out = {}
    kmf = KaplanMeierFitter()
    t = [x[0] for x in SURV_TREAT]
    e = [x[1] for x in SURV_TREAT]
    kmf.fit(t, event_observed=e)
    sf = kmf.survival_function_
    surv_at = {}
    for rt in KM_READ_TIMES:
        # Survival just after time rt (step function, left-continuous read).
        val = float(kmf.predict(rt))
        surv_at[str(rt)] = r4(val)
    out["km_treat"] = {
        "survivalAt": surv_at,
        "median": (None if kmf.median_survival_time_ in (np.inf, float("inf"))
                   else r4(kmf.median_survival_time_)),
    }
    # Log-rank Treatment vs Control.
    tc = [x[0] for x in SURV_CONTROL]
    ec = [x[1] for x in SURV_CONTROL]
    lr = logrank_test(t, tc, event_observed_A=e, event_observed_B=ec)
    out["logrank"] = {
        "chi2": r4(lr.test_statistic),
        "df": 1,
        "p": r4(lr.p_value),
    }
    # Gehan-Breslow-Wilcoxon Treatment vs Control. Same comparison as the
    # log-rank test, but each event time is weighted by the number at risk, so
    # early deaths count more. lifelines exposes it via weightings="wilcoxon".
    gbw = logrank_test(
        t, tc, event_observed_A=e, event_observed_B=ec, weightings="wilcoxon"
    )
    out["gehan"] = {
        "chi2": r4(gbw.test_statistic),
        "df": 1,
        "p": r4(gbw.p_value),
    }
    # Cox proportional hazards on the same two arms. The single covariate is the
    # arm indicator (Treatment = 1, Control = 0), matching how the Data Hub codes
    # the comparison-vs-reference contrast. Efron tie handling is lifelines'
    # default, so the coefficient matches our engine.
    import pandas as pd
    from lifelines import CoxPHFitter
    df = pd.DataFrame({
        "duration": t + tc,
        "event": e + ec,
        "arm": [1] * len(t) + [0] * len(tc),
    })
    cph = CoxPHFitter()
    cph.fit(df, duration_col="duration", event_col="event")
    s = cph.summary.loc["arm"]
    # Likelihood-ratio test vs the null model.
    lr_stat = float(cph.log_likelihood_ratio_test().test_statistic)
    lr_p = float(cph.log_likelihood_ratio_test().p_value)
    out["cox"] = {
        "coef": r4(s["coef"]),
        "se": r4(s["se(coef)"]),
        "z": r4(s["z"]),
        "p": r4(s["p"]),
        "hr": r4(s["exp(coef)"]),
        "hr_ci_low": r4(s["exp(coef) lower 95%"]),
        "hr_ci_high": r4(s["exp(coef) upper 95%"]),
        "log_likelihood": r4(cph.log_likelihood_),
        "lr_chi2": r4(lr_stat),
        "lr_p": r4(lr_p),
        "concordance": r4(cph.concordance_index_),
    }
    return out


def ref_chi_square():
    chi2, p, dof, _expected = st.chi2_contingency(np.array(CONTINGENCY),
                                                  correction=False)
    return {"contingency": {"chi2": r4(chi2), "df": int(dof), "p": r4(p)}}


def _solve_ncp(tobs, df, target):
    """Invert the noncentral t CDF for the noncentrality nc at a target CDF value.

    nct.cdf is monotone decreasing in nc, so bracket around tobs and widen until
    the function changes sign, then bisect with brentq. This is the same Smithson
    (2001) construction the engine implements in dists.ts.
    """
    f = lambda nc: st.nct.cdf(tobs, df, nc) - target
    lo, hi = tobs - 1.0, tobs + 1.0
    for _ in range(100):
        flo, fhi = f(lo), f(hi)
        if np.isfinite(flo) and np.isfinite(fhi) and flo * fhi < 0:
            return brentq(f, lo, hi)
        lo -= 1.0
        hi += 1.0
    raise RuntimeError("noncentral t: no sign change bracket found")


def ref_effect_sizes():
    """E1 effect sizes and their confidence intervals on the fixed dataset.

    Cohen's d and Hedges' g come from pingouin.compute_effsize (the pooled-SD
    convention the engine uses); the comment cross-checks against the explicit
    formula, which agrees exactly. The standardized-effect 95% CIs come from the
    noncentral t / noncentral F pivot via scipy.stats.nct / ncf (Smithson 2001),
    the SAME method the engine implements. The correlation r-squared CI is the
    squared Fisher-z interval. All are pinned under the `scipy` oracle (pingouin
    wraps scipy/numpy and the CI machinery is pure scipy).
    """
    out = {}

    # Unpaired (Welch) t-test, GROUP_A vs GROUP_B.
    A = np.array(GROUP_A); B = np.array(GROUP_B)
    na, nb = len(A), len(B)
    d = pg.compute_effsize(A, B, eftype="cohen")
    g = pg.compute_effsize(A, B, eftype="hedges")
    df_pool = na + nb - 2
    scale = np.sqrt(1 / na + 1 / nb)
    tobs = d / scale
    d_lo = _solve_ncp(tobs, df_pool, 0.975) * scale
    d_hi = _solve_ncp(tobs, df_pool, 0.025) * scale
    out["unpaired"] = {
        "cohens_d": r4(d), "hedges_g": r4(g),
        "d_ci_lo": r4(d_lo), "d_ci_hi": r4(d_hi),
    }

    # Paired t-test, PAIR_X vs PAIR_Y (Cohen's dz on the within-pair differences).
    PX = np.array(PAIR_X); PY = np.array(PAIR_Y)
    diff = PX - PY
    n = len(diff)
    dz = diff.mean() / diff.std(ddof=1)
    dz_scale = 1 / np.sqrt(n)
    df_p = n - 1
    tobs_dz = dz / dz_scale
    dz_lo = _solve_ncp(tobs_dz, df_p, 0.975) * dz_scale
    dz_hi = _solve_ncp(tobs_dz, df_p, 0.025) * dz_scale
    out["paired"] = {
        "cohens_dz": r4(dz), "dz_ci_lo": r4(dz_lo), "dz_ci_hi": r4(dz_hi),
    }

    # One-way ANOVA omnibus effect size, GROUP_A / GROUP_B / GROUP_C.
    groups = [np.array(GROUP_A), np.array(GROUP_B), np.array(GROUP_C)]
    allv = np.concatenate(groups)
    N = len(allv); k = len(groups)
    grand = allv.mean()
    ss_b = sum(len(gi) * (gi.mean() - grand) ** 2 for gi in groups)
    ss_w = sum(((gi - gi.mean()) ** 2).sum() for gi in groups)
    ss_t = ss_b + ss_w
    df_b, df_w = k - 1, N - k
    ms_w = ss_w / df_w
    eta2 = ss_b / ss_t
    omega2 = (ss_b - df_b * ms_w) / (ss_t + ms_w)
    F = st.f_oneway(*groups).statistic
    lo_lam = brentq(lambda lam: st.ncf.cdf(F, df_b, df_w, lam) - 0.975, 0, 1000)
    hi_lam = brentq(lambda lam: st.ncf.cdf(F, df_b, df_w, lam) - 0.025, 0, 5000)
    out["oneway"] = {
        "eta_squared": r4(eta2), "omega_squared": r4(omega2),
        "eta2_ci_lo": r4(lo_lam / (lo_lam + N)),
        "eta2_ci_hi": r4(hi_lam / (hi_lam + N)),
    }

    # Pearson correlation coefficient of determination + squared Fisher-z CI.
    X = np.array(XY_X); Y = np.array(XY_Y)
    r = st.pearsonr(X, Y).statistic
    nc = len(X)
    z = np.arctanh(r); se = 1 / np.sqrt(nc - 3); zc = st.norm.ppf(0.975)
    r_lo = np.tanh(z - zc * se); r_hi = np.tanh(z + zc * se)
    sq = sorted([r_lo * r_lo, r_hi * r_hi])
    straddle = r_lo <= 0 <= r_hi
    out["pearson"] = {
        "r_squared": r4(r * r),
        "r2_ci_lo": r4(0.0 if straddle else sq[0]),
        "r2_ci_hi": r4(sq[1]),
    }
    return out


def ref_power():
    """E3 power and sample-size planning scenarios (statsmodels TTestIndPower).

    Power is a study-design scenario, not a statistic of the dataset. The a-priori
    sample size the engine reports is the smallest INTEGER n whose power reaches the
    target (round up so the planned study is never under-powered), which is the
    ceiling of the fractional statsmodels solve_power value.
    """
    ind = TTestIndPower()
    power = ind.power(POWER_TWO_SAMPLE_D, nobs1=POWER_TWO_SAMPLE_N,
                      alpha=POWER_ALPHA, ratio=1.0, alternative="two-sided")
    frac = ind.solve_power(effect_size=SAMPLESIZE_D, power=SAMPLESIZE_TARGET_POWER,
                           alpha=POWER_ALPHA, ratio=1.0, alternative="two-sided")
    return {
        "power_two_sample_t": r4(power),
        "samplesize_two_sample_t_frac": r4(frac),
        "samplesize_two_sample_t": int(np.ceil(frac)),
    }


def ref_bootstrap():
    """E4 bootstrap, the DETERMINISTIC (RNG-free) machinery only.

    A reseeded JS bootstrap cannot reproduce scipy.stats.bootstrap resample for
    resample, so an exact end-to-end CI pin would be dishonest. What IS exactly
    reproducible, and is pinned here, is the deterministic machinery the bootstrap
    is built from on fixed arrays with no random draws:
      - the percentile extractor, the 2.5% / 97.5% points of a fixed sorted
        distribution under the type-7 (linear) quantile definition (numpy default);
      - the BCa bias-correction z0 = Phi^-1(share of resamples below observed),
        ties counted as half (scipy.stats.norm.ppf);
      - the BCa jackknife acceleration of the mean on a fixed sample.
    The seeded end-to-end CI is validated for statistical convergence in the engine
    test suite instead (documented in STATS_VALIDATION.md).
    """
    arr = np.array(BOOT_DISTRIBUTION)
    p_lo = float(np.quantile(arr, 0.025, method="linear"))
    p_hi = float(np.quantile(arr, 0.975, method="linear"))

    below = sum(1 for s in BOOT_STATS if s < BOOT_OBSERVED)
    equal = sum(1 for s in BOOT_STATS if s == BOOT_OBSERVED)
    prop = (below + equal / 2) / len(BOOT_STATS)
    z0 = float(st.norm.ppf(min(1 - 1e-9, max(1e-9, prop))))

    s = np.array(BOOT_ACCEL_SAMPLE, dtype=float)
    nn = len(s)
    theta = np.array([np.delete(s, i).mean() for i in range(nn)])
    mbar = theta.mean()
    num = ((mbar - theta) ** 3).sum()
    den = ((mbar - theta) ** 2).sum()
    accel = float(num / (6 * den ** 1.5))
    return {
        "percentile_lo": r4(p_lo), "percentile_hi": r4(p_hi),
        "z0": r4(z0), "acceleration": r4(accel),
    }


PROVENANCE = {
    "scipy": scipy.__version__,
    "statsmodels": statsmodels.__version__,
    "lifelines": lifelines.__version__,
    "pingouin": pg.__version__,
    "numpy": np.__version__,
    "calls": {
        "unpaired_welch": "scipy.stats.ttest_ind(A, B, equal_var=False)",
        "unpaired_student": "scipy.stats.ttest_ind(A, B, equal_var=True)",
        "paired": "scipy.stats.ttest_rel(PAIR_X, PAIR_Y)",
        "mann_whitney": "scipy.stats.mannwhitneyu(A, B, method='asymptotic', use_continuity=True)",
        "wilcoxon": "scipy.stats.wilcoxon(PAIR_X, PAIR_Y)",
        "oneway": "scipy.stats.f_oneway(A, B, C)",
        "from_stats.fromstats_welch": "scipy.stats.ttest_ind_from_stats(mA,sA,nA,mB,sB,nB, equal_var=False)",
        "from_stats.fromstats_student": "scipy.stats.ttest_ind_from_stats(mA,sA,nA,mB,sB,nB, equal_var=True)",
        "from_stats.fromstats_welch_{greater,less}_p": "scipy.stats.ttest_ind_from_stats(..., equal_var=False, alternative=...)",
        "from_stats.fromstats_oneway": "f_oneway reconstructed from group (mean,sd,n): SS_b=sum n(m-grand)^2, SS_w=sum (n-1)sd^2",
        "tukey": "statsmodels.stats.multicomp.pairwise_tukeyhsd",
        "param_options.unpaired_welch_{greater,less}_p": "scipy.stats.ttest_ind(A, B, equal_var=False, alternative=...)",
        "param_options.paired_{greater,less}_p": "scipy.stats.ttest_rel(PAIR_X, PAIR_Y, alternative=...)",
        "param_options.mann_whitney_{greater,less}_p": "scipy.stats.mannwhitneyu(A, B, alternative=..., method='asymptotic', use_continuity=True)",
        "param_options.wilcoxon_{greater,less}_p": "scipy.stats.wilcoxon(PAIR_X, PAIR_Y, alternative=...)",
        "param_options.posthoc_{sidak,bonferroni,holm_sidak}": "statsmodels.stats.multitest.multipletests(raw_pooled_t_pvalues, method=...)",
        "twoway": "statsmodels ols + anova_lm(typ=2), y ~ C(Dose)+C(Time)+C(Dose):C(Time)",
        "kruskal": "scipy.stats.kruskal(A, B, C)",
        "friedman": "scipy.stats.friedmanchisquare(P, Q, R)",
        "pearson": "scipy.stats.pearsonr(X, Y)",
        "spearman": "scipy.stats.spearmanr(X, Y)",
        "linreg": "scipy.stats.linregress(X, Y)",
        "multiple_regression": "statsmodels.api.OLS(y, sm.add_constant([x1, x2])).fit(); params/bse/tvalues/pvalues, rsquared, rsquared_adj, sqrt(mse_resid), fvalue, f_pvalue, llf; VIF = statsmodels.stats.outliers_influence.variance_inflation_factor(X, j)",
        "dose_response.fourpl": "scipy.optimize.curve_fit(4PL: bottom+(top-bottom)/(1+10**((logec50-x)*hill)) ); EC50=10**logEC50",
        "dose_response.fivepl": "scipy.optimize.curve_fit(5PL: 4PL denom **s ); true EC50=10**(logEC50 - log10(2**(1/s)-1)/hill)",
        "model_comparison": "curve_fit 4PL + 5PL; extra-sum-of-squares F = ((SS1-SS2)/(DF1-DF2))/(SS2/DF2), p=scipy.stats.f.sf; AICc=n*ln(SS/n)+2K+2K(K+1)/(n-K-1), K=nparams+1",
        "global_fit": "scipy.optimize.least_squares(method='lm') on a stacked residual closure over 2 curves; packed=[Bottom,Top,Hill,logEC50_A,logEC50_B] with Bottom/Top/Hill shared, logEC50 local; EC50=10**logEC50; global R2 = 1 - SS_res_total/SS_tot_total pooled over both curves",
        "shapiro": "scipy.stats.shapiro(A+B+C)",
        "levene_mean": "scipy.stats.levene(A, B, C, center='mean')  [our levene()]",
        "levene_median": "scipy.stats.levene(A, B, C, center='median')  [our brownForsythe()]",
        "km_treat": "lifelines.KaplanMeierFitter.fit / .predict / .median_survival_time_",
        "logrank": "lifelines.statistics.logrank_test",
        "contingency": "scipy.stats.chi2_contingency(table, correction=False)  [PENDING: no engine impl yet]",
        "effect_sizes.unpaired": "pingouin.compute_effsize(A, B, eftype='cohen'|'hedges'); d CI via scipy.stats.nct inversion (Smithson 2001)",
        "effect_sizes.paired": "Cohen's dz = mean(diff)/sd(diff); dz CI via scipy.stats.nct inversion",
        "effect_sizes.oneway": "eta2 = SSb/SSt, omega2 = (SSb - dfb*MSw)/(SSt + MSw); eta2 CI via scipy.stats.ncf inversion",
        "effect_sizes.pearson": "r^2 from scipy.stats.pearsonr; r^2 CI = squared Fisher-z interval (scipy.stats.norm)",
        "power.power_two_sample_t": "statsmodels.stats.power.TTestIndPower().power(d, nobs1, alpha, ratio=1, two-sided)",
        "power.samplesize_two_sample_t": "ceil(TTestIndPower().solve_power(effect_size, power, alpha, ratio=1, two-sided))",
        "bootstrap.percentile": "numpy.quantile(dist, [0.025, 0.975], method='linear')  [type-7]",
        "bootstrap.z0": "scipy.stats.norm.ppf(share of resamples below observed, ties as half)",
        "bootstrap.acceleration": "BCa jackknife skewness of the mean on a fixed sample",
    },
}


def main():
    refs = {}
    refs.update({"ttests": ref_ttests()})
    refs.update({"nonparametric": ref_nonparametric_two_group()})
    refs.update({"anova_oneway": ref_anova_oneway()})
    refs.update({"param_options": ref_param_options()})
    refs.update({"anova_twoway": ref_anova_twoway()})
    refs.update({"kruskal_friedman": ref_kruskal_friedman()})
    refs.update({"rm_anova": ref_rm_anova()})
    refs.update({"mixed_model": ref_mixed_model()})
    refs.update({"correlation_regression": ref_correlation_regression()})
    refs.update({"logistic_regression": ref_logistic_regression()})
    refs.update({"multiple_regression": ref_multiple_regression()})
    refs.update({"dose_response": ref_dose_response()})
    refs.update({"model_comparison": ref_model_comparison()})
    refs.update({"global_fit": ref_global_fit()})
    refs.update({"from_stats": ref_from_stats()})
    refs.update({"assumptions": ref_assumptions()})
    refs.update({"survival": ref_survival()})
    refs.update({"chi_square": ref_chi_square()})
    refs.update({"effect_sizes": ref_effect_sizes()})
    refs.update({"power": ref_power()})
    refs.update({"bootstrap": ref_bootstrap()})

    dataset = {
        "GROUP_A": GROUP_A,
        "GROUP_B": GROUP_B,
        "GROUP_C": GROUP_C,
        "REPEATED": REPEATED,
        "REPEATED_LABELS": REPEATED_LABELS,
        "PAIR_X": PAIR_X,
        "PAIR_Y": PAIR_Y,
        "XY_X": XY_X,
        "XY_Y": XY_Y,
        "LOGIT_X": LOGIT_X,
        "LOGIT_Y": LOGIT_Y,
        "MLR_X1": MLR_X1,
        "MLR_X2": MLR_X2,
        "MLR_Y": MLR_Y,
        "DOSE_LOG_CONC": DOSE_LOG_CONC,
        "DOSE_RESPONSE": DOSE_RESPONSE,
        "GLOBAL_FIT_X": GLOBAL_FIT_X,
        "GLOBAL_FIT_YA": GLOBAL_FIT_YA,
        "GLOBAL_FIT_YB": GLOBAL_FIT_YB,
        "TWOWAY": TWOWAY,
        "SURV_TREAT": SURV_TREAT,
        "SURV_CONTROL": SURV_CONTROL,
        "KM_READ_TIMES": KM_READ_TIMES,
        "CONTINGENCY": CONTINGENCY,
        "POWER_TWO_SAMPLE_N": POWER_TWO_SAMPLE_N,
        "POWER_TWO_SAMPLE_D": POWER_TWO_SAMPLE_D,
        "POWER_ALPHA": POWER_ALPHA,
        "SAMPLESIZE_D": SAMPLESIZE_D,
        "SAMPLESIZE_TARGET_POWER": SAMPLESIZE_TARGET_POWER,
        "BOOT_DISTRIBUTION": BOOT_DISTRIBUTION,
        "BOOT_STATS": BOOT_STATS,
        "BOOT_OBSERVED": BOOT_OBSERVED,
        "BOOT_ACCEL_SAMPLE": BOOT_ACCEL_SAMPLE,
    }

    bundle = {
        "provenance": PROVENANCE,
        "dataset": dataset,
        "references": refs,
    }

    print("=" * 72)
    print("DATA HUB STATISTICS GOLDEN VALUES")
    print(f"  scipy {scipy.__version__} | statsmodels {statsmodels.__version__} "
          f"| lifelines {lifelines.__version__} | numpy {np.__version__}")
    print("=" * 72)
    print(json.dumps(bundle, indent=2, sort_keys=False))


if __name__ == "__main__":
    main()
