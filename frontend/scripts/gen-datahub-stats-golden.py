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
from scipy.optimize import brentq, curve_fit
import statsmodels
import statsmodels.api as sm
from statsmodels.formula.api import ols
from statsmodels.stats.multicomp import pairwise_tukeyhsd
from statsmodels.stats.power import TTestIndPower
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

# A dose-response dataset for the 4PL / 5PL curve fit (D1). x = log10(dose in M),
# an 11-point serial dilution; y = response. Mirrored verbatim in datahub-stats.ts.
DOSE_LOG_CONC = [-9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0, -4.5, -4.0]
DOSE_RESPONSE = [4.8, 6.1, 7.9, 12.5, 24.0, 47.0, 70.0, 86.0, 93.5, 96.8, 98.1]

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
        "dose_response.fourpl": "scipy.optimize.curve_fit(4PL: bottom+(top-bottom)/(1+10**((logec50-x)*hill)) ); EC50=10**logEC50",
        "dose_response.fivepl": "scipy.optimize.curve_fit(5PL: 4PL denom **s ); true EC50=10**(logEC50 - log10(2**(1/s)-1)/hill)",
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
    refs.update({"correlation_regression": ref_correlation_regression()})
    refs.update({"dose_response": ref_dose_response()})
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
        "DOSE_LOG_CONC": DOSE_LOG_CONC,
        "DOSE_RESPONSE": DOSE_RESPONSE,
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
