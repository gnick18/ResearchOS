// Model comparison for the nonlinear curve fitter, matching GraphPad Prism's
// "Compare models". Two complementary methods, both computed from real fit
// output (residual sum of squares + parameter count), never a reimplementation:
//
//   1. Extra-sum-of-squares F test, for NESTED models (the simpler model is a
//      special case of the more complex one, e.g. a 4PL is the 5PL with S = 1,
//      or one-site is two-site with the second site removed). It asks whether
//      the more complex model's smaller residual sum of squares is worth the
//      extra parameters it spent, or is just the overfit a freer model always
//      buys. Formula (Prism, Motulsky & Christopoulos):
//        F = ((SS1 - SS2) / (DF1 - DF2)) / (SS2 / DF2)
//      where model 2 is the MORE COMPLEX one (more parameters, fewer DF),
//      SS = residual sum of squares, DF = n - n_params. Under the null (the
//      simpler model is adequate) F follows an F distribution with
//      (DF1 - DF2, DF2) degrees of freedom, and a small p-value rejects the
//      simpler model in favor of the complex one.
//
//   2. AICc, the small-sample-corrected Akaike Information Criterion, which
//      compares models whether or not they are nested and trades goodness of
//      fit against parameter count without a null-hypothesis test:
//        AICc = n * ln(SS / n) + 2K + (2K(K+1)) / (n - K - 1)
//      with K = n_params + 1 (the +1 is the estimated residual variance) and
//      n = the number of points. The model with the LOWER AICc is preferred;
//      the difference and the Akaike weights (the probability each model is the
//      better of the set) quantify by how much.
//
// Both methods need the SAME n points, so the caller fits both models on one
// XY dataset. The F test additionally needs the two models to be genuinely
// nested; we cannot prove nesting from numbers alone, so the F result carries a
// `nested` intent the caller asserts and we still report the AICc verdict as the
// always-valid companion.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fPValue } from "../dists";

/** The fit summary one model contributes to a comparison. */
export interface ModelFitSummary {
  /** Stable model id (e.g. "logistic4pl"). */
  id: string;
  /** Human label for the verdict text. */
  label: string;
  /** Residual sum of squares at the converged fit. */
  ssr: number;
  /** Number of fitted parameters (NOT counting the variance). */
  nParams: number;
  /** Number of points the model was fit to (shared across both models). */
  n: number;
}

/** The extra-sum-of-squares F test outcome. */
export interface FTestComparison {
  /** F statistic, or NaN when the test is undefined (see notes below). */
  f: number;
  /** Numerator df = DF_simple - DF_complex = n_params_complex - n_params_simple. */
  dfNumerator: number;
  /** Denominator df = DF_complex = n - n_params_complex. */
  dfDenominator: number;
  /** Upper-tail p-value from F(dfNumerator, dfDenominator). */
  pValue: number;
  /** Preferred model id at alpha = 0.05 (complex when p < alpha, else simple). */
  preferredId: string;
  /** The alpha used for the preference decision. */
  alpha: number;
}

/** One model's AICc line in the comparison. */
export interface AiccModelLine {
  id: string;
  label: string;
  /** K = nParams + 1 (the +1 for the estimated variance). */
  k: number;
  aicc: number;
  /** AICc minus the minimum AICc across the set (0 for the preferred model). */
  delta: number;
  /** Akaike weight: probability this model is the best of the set. */
  probability: number;
}

/** The AICc comparison outcome. */
export interface AiccComparison {
  models: AiccModelLine[];
  /** The model id with the lowest AICc. */
  preferredId: string;
  /**
   * Evidence ratio of the preferred model over the other, prob_pref / prob_other.
   * For a two-model comparison this is "how many times more likely" the preferred
   * model is. NaN when there are not exactly two models or the other prob is 0.
   */
  evidenceRatio: number;
}

/** AICc for one model. Returns NaN when n - K - 1 <= 0 (correction undefined). */
export function aicc(ssr: number, nParams: number, n: number): number {
  if (!(ssr > 0) || !(n > 0)) return NaN;
  const k = nParams + 1; // +1 for the estimated residual variance.
  const denom = n - k - 1;
  if (denom <= 0) return NaN;
  return n * Math.log(ssr / n) + 2 * k + (2 * k * (k + 1)) / denom;
}

/**
 * Extra-sum-of-squares F test between a SIMPLER model (fewer params) and a MORE
 * COMPLEX model (more params) fit to the same points. The caller is responsible
 * for passing genuinely nested models; the math here only enforces that the
 * "complex" model has strictly more parameters and that the simpler model's SSR
 * is at least the complex one's (a freer model can never fit worse, up to
 * optimizer noise, so a tiny SS1 < SS2 is clamped to F = 0 rather than negative).
 */
export function extraSumOfSquaresF(
  simple: ModelFitSummary,
  complex: ModelFitSummary,
  alpha = 0.05,
): FTestComparison {
  const dfNumerator = complex.nParams - simple.nParams; // = DF_simple - DF_complex
  const dfDenominator = complex.n - complex.nParams; // = DF_complex
  // Guard a non-nested or degenerate call: the F test is only defined when the
  // complex model spends strictly more parameters and keeps positive residual df.
  if (dfNumerator <= 0 || dfDenominator <= 0 || !(complex.ssr > 0)) {
    return {
      f: NaN,
      dfNumerator,
      dfDenominator,
      pValue: NaN,
      preferredId: simple.id,
      alpha,
    };
  }
  // A freer model cannot fit worse; clamp optimizer noise so F stays >= 0.
  const ssDiff = Math.max(0, simple.ssr - complex.ssr);
  const f = ssDiff / dfNumerator / (complex.ssr / dfDenominator);
  const pValue = fPValue(f, dfNumerator, dfDenominator);
  const preferredId = pValue < alpha ? complex.id : simple.id;
  return { f, dfNumerator, dfDenominator, pValue, preferredId, alpha };
}

/**
 * AICc comparison across two or more models fit to the same points. Computes
 * each model's AICc, the delta from the best, and the Akaike weights
 * prob_i = exp(-0.5 delta_i) / sum_j exp(-0.5 delta_j). The preferred model is
 * the lowest AICc; for a two-model set the evidence ratio is reported.
 */
export function aiccCompare(models: ModelFitSummary[]): AiccComparison {
  const raw = models.map((m) => ({
    id: m.id,
    label: m.label,
    k: m.nParams + 1,
    aicc: aicc(m.ssr, m.nParams, m.n),
  }));
  const finite = raw.filter((r) => Number.isFinite(r.aicc));
  const minAicc = finite.length ? Math.min(...finite.map((r) => r.aicc)) : NaN;
  // Akaike weights, normalized over the models whose AICc is defined.
  const weights = raw.map((r) =>
    Number.isFinite(r.aicc) ? Math.exp(-0.5 * (r.aicc - minAicc)) : 0,
  );
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const lines: AiccModelLine[] = raw.map((r, i) => ({
    id: r.id,
    label: r.label,
    k: r.k,
    aicc: r.aicc,
    delta: Number.isFinite(r.aicc) ? r.aicc - minAicc : NaN,
    probability: weightSum > 0 ? weights[i] / weightSum : NaN,
  }));
  // Preferred = lowest defined AICc; fall back to the first model if none defined.
  let preferredId = lines[0]?.id ?? "";
  let best = Infinity;
  for (const l of lines) {
    if (Number.isFinite(l.aicc) && l.aicc < best) {
      best = l.aicc;
      preferredId = l.id;
    }
  }
  let evidenceRatio = NaN;
  if (lines.length === 2) {
    const pref = lines.find((l) => l.id === preferredId);
    const other = lines.find((l) => l.id !== preferredId);
    if (pref && other && other.probability > 0) {
      evidenceRatio = pref.probability / other.probability;
    }
  }
  return { models: lines, preferredId, evidenceRatio };
}
