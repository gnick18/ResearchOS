// E1 validation suite: effect sizes and their confidence intervals, pinned
// against scipy / pingouin reference values. The math correctness IS the
// feature, so every new statistic and every CI is checked against an external
// library with the exact Python call recorded above the assertion.
//
// CI method note. The standardized-effect CIs (Cohen's d / dz, eta-squared) use
// the NONCENTRAL t / noncentral F pivot. pingouin's compute_esci uses a
// different (approximate, normal-based) interval for d, so where the two methods
// disagree we validate against the SAME method we implemented, namely scipy's
// stats.nct / stats.ncf inverted for the noncentrality parameter. This is the
// Smithson (2001) confidence-interval construction.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe as suite, it, expect } from "vitest";

import { oneWayAnova, kruskalWallis } from "../anova";
import { pearson } from "../correlation";
import {
  noncentralFCdf,
  noncentralTCdf,
} from "../dists";
import { pairedTTest, unpairedTTest } from "../ttests";

// Fixed datasets, hardcoded so the Python references below reproduce exactly.
const A = [5.1, 6.2, 5.8, 6.5, 5.9, 6.1, 5.7, 6.3];
const B = [6.8, 7.1, 6.9, 7.5, 7.2, 6.7, 7.0, 7.3];

const P1 = [5.1, 6.2, 5.8, 6.5, 5.9, 6.1, 5.7, 6.3];
const P2 = [5.4, 6.5, 5.7, 6.9, 6.2, 6.3, 6.1, 6.4];

const G1 = [20, 22, 19, 24, 25];
const G2 = [28, 31, 26, 30, 34];
const G3 = [18, 15, 20, 17, 16];

const CORR_X = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const CORR_Y = [
  2.1, 3.9, 6.2, 7.8, 10.1, 11.8, 14.2, 15.9, 18.1, 20.2,
];

suite("noncentral t / F CDFs match scipy", () => {
  it("noncentral t CDF matches scipy.stats.nct.cdf", () => {
    // from scipy.stats import nct
    //   nct.cdf(2.5, 10, 1.0)  = 0.896545604397644
    //   nct.cdf(-1.0, 15, 2.0) = 0.0016562401312168878
    //   nct.cdf(0.5, 8, -1.5)  = 0.9755845102920497
    //   nct.cdf(3.0, 20, 0.5)  = 0.9873305732598614
    expect(noncentralTCdf(2.5, 10, 1.0)).toBeCloseTo(0.896545604397644, 8);
    expect(noncentralTCdf(-1.0, 15, 2.0)).toBeCloseTo(
      0.0016562401312168878,
      8,
    );
    expect(noncentralTCdf(0.5, 8, -1.5)).toBeCloseTo(0.9755845102920497, 8);
    expect(noncentralTCdf(3.0, 20, 0.5)).toBeCloseTo(0.9873305732598614, 8);
  });

  it("noncentral F CDF matches scipy.stats.ncf.cdf", () => {
    // from scipy.stats import ncf
    //   ncf.cdf(3.0, 2, 12, 4.0)  = 0.5544450621632142
    //   ncf.cdf(5.0, 3, 30, 10.0) = 0.6336123790330136
    //   ncf.cdf(1.5, 4, 20, 2.0)  = 0.5601049238733471
    expect(noncentralFCdf(3.0, 2, 12, 4.0)).toBeCloseTo(0.5544450621632142, 8);
    expect(noncentralFCdf(5.0, 3, 30, 10.0)).toBeCloseTo(
      0.6336123790330136,
      8,
    );
    expect(noncentralFCdf(1.5, 4, 20, 2.0)).toBeCloseTo(0.5601049238733471, 8);
  });
});

suite("independent t test effect sizes (Cohen's d, Hedges' g, noncentral CI)", () => {
  it("matches pingouin's d and g and scipy's noncentral-t d CI", () => {
    const r = unpairedTTest(A, B);
    if (!r.ok) throw new Error("expected ok");

    // pingouin.compute_effsize(A, B, eftype='cohen') = -3.086579975477256
    // pingouin.compute_effsize(A, B, eftype='hedges') = -2.918221067723951
    expect(r.effectSize).toBeCloseTo(-3.086579975477256, 6);
    expect(r.hedgesG).toBeCloseTo(-2.918221067723951, 6);

    // 95% CI of Cohen's d via the noncentral t pivot (the method we implement):
    //   na = nb = 8, df = 14, scale = sqrt(1/8 + 1/8), tobs = d / scale
    //   lo_ncp = brentq(lambda nc: nct.cdf(tobs, 14, nc) - 0.975)
    //   hi_ncp = brentq(lambda nc: nct.cdf(tobs, 14, nc) - 0.025)
    //   d_CI = [lo_ncp * scale, hi_ncp * scale]
    //        = [-4.5600509560802625, -1.5660909699184786]
    expect(r.effectSizeCI95).not.toBeNull();
    expect(r.effectSizeCI95![0]).toBeCloseTo(-4.5600509560802625, 3);
    expect(r.effectSizeCI95![1]).toBeCloseTo(-1.5660909699184786, 3);
  });
});

suite("paired t test effect sizes (Cohen's dz, noncentral CI)", () => {
  it("matches Cohen's dz and the scipy noncentral-t dz CI", () => {
    const r = pairedTTest(P1, P2);
    if (!r.ok) throw new Error("expected ok");

    // dz = mean(diff) / sd(diff), diff = P1 - P2, n = 8.
    //   numpy: dz = -1.409480478802666
    expect(r.effectSize).toBeCloseTo(-1.409480478802666, 6);

    // 95% CI of dz via noncentral t (scale = 1/sqrt(n), df = n - 1 = 7):
    //   lo_ncp = brentq(lambda nc: nct.cdf(dz/scale, 7, nc) - 0.975)
    //   hi_ncp = brentq(lambda nc: nct.cdf(dz/scale, 7, nc) - 0.025)
    //   dz_CI = [-2.388543931979808, -0.3855315680055361]
    expect(r.effectSizeCI95).not.toBeNull();
    expect(r.effectSizeCI95![0]).toBeCloseTo(-2.388543931979808, 3);
    expect(r.effectSizeCI95![1]).toBeCloseTo(-0.3855315680055361, 3);
  });
});

suite("one-way ANOVA effect sizes (eta-squared, omega-squared, noncentral-F CI)", () => {
  it("matches manual eta2 / omega2 and the scipy noncentral-F eta2 CI", () => {
    const r = oneWayAnova({ G1, G2, G3 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.effectSize).not.toBeNull();
    const es = r.effectSize!;

    // scipy.stats.f_oneway(G1, G2, G3): F = 31.26804123711339
    //   SS_between/SS_total = eta2  = 0.8390041493775934
    //   omega2 = (SSb - dfb*MSw)/(SSt + MSw) = 0.8014194076702608
    expect(es.etaSquared).toBeCloseTo(0.8390041493775934, 6);
    expect(es.omegaSquared).toBeCloseTo(0.8014194076702608, 6);
    expect(es.label).toBe("eta-squared");

    // eta2 95% CI via noncentral F (df1 = 2, df2 = 12, N = 15):
    //   lo_lam = brentq(lambda lam: ncf.cdf(F,2,12,lam) - 0.975) = 16.52884439709621
    //   hi_lam = brentq(lambda lam: ncf.cdf(F,2,12,lam) - 0.025) = 132.36701351343993
    //   eta2_CI = [lam/(lam+N)] = [0.5242451701978176, 0.8982133135334796]
    expect(es.etaSquaredCI95).not.toBeNull();
    expect(es.etaSquaredCI95![0]).toBeCloseTo(0.5242451701978176, 3);
    expect(es.etaSquaredCI95![1]).toBeCloseTo(0.8982133135334796, 3);
  });
});

suite("Kruskal-Wallis effect size (epsilon-squared)", () => {
  it("matches the epsilon-squared formula and leaves omega / CI null", () => {
    const r = kruskalWallis({ G1, G2, G3 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.effectSize).not.toBeNull();
    const es = r.effectSize!;

    // scipy.stats.kruskal(G1, G2, G3): H = 11.816100178890885 (tie-corrected).
    //   epsilon2 = H * (N + 1) / (N^2 - 1), N = 15
    //            = 0.8440071556350632
    expect(es.label).toBe("epsilon-squared");
    expect(es.etaSquared).toBeCloseTo(0.8440071556350632, 6);
    // A rank test has no parametric omega-squared or noncentral-F CI.
    expect(es.omegaSquared).toBeNull();
    expect(es.etaSquaredCI95).toBeNull();
  });
});

suite("correlation effect size (r-squared + CI)", () => {
  it("matches scipy r^2 and the squared Fisher-z CI", () => {
    const r = pearson(CORR_X, CORR_Y);
    if (!r.ok) throw new Error("expected ok");

    // scipy.stats.pearsonr(X, Y): r = 0.9996518970189223, r2 = 0.9993039152135301
    expect(r.rSquared).toBeCloseTo(0.9993039152135301, 8);

    // Fisher-z 95% CI of r = [0.9984692696152877, 0.9999208741713951]; squaring
    // the bounds (interval does not straddle zero) gives
    //   r2_CI = [0.9969408823660861, 0.999841754603687]
    expect(r.rSquaredCI95[0]).toBeCloseTo(0.9969408823660861, 6);
    expect(r.rSquaredCI95[1]).toBeCloseTo(0.999841754603687, 6);
  });

  it("clamps the r-squared lower bound to zero when the r CI straddles zero", () => {
    // A near-zero correlation whose Fisher CI spans negative and positive r must
    // give an r-squared lower bound of exactly 0 (r^2 cannot be negative).
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = [3, 1, 4, 1, 5, 2, 6, 2];
    const r = pearson(x, y);
    if (!r.ok) throw new Error("expected ok");
    if (r.ci95[0] <= 0 && r.ci95[1] >= 0) {
      expect(r.rSquaredCI95[0]).toBe(0);
    }
  });
});
