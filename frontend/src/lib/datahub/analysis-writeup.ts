// Data Hub analysis writeup: turn a finished analysis into copy-able paragraphs
// for a paper, in two registers, plus the reference list a reviewer expects.
//
//   - methodsParagraph(result): the Methods-section text. Describes WHAT was done
//     and cites the canonical reference for each method, e.g. "Two independent
//     groups were compared with Welch's unpaired t-test (Welch 1947) ..."
//   - resultsParagraph(result): the Results-section text. Reports the FINDING with
//     the inline statistics, reusing the engine's validated plain-language verdict.
//   - collectReferences(result): the methods cited above plus the open-source
//     software the engine computed with, as a formatted reference list.
//
// Numbers come ONLY from the engine (via plainLanguageSummary / the normalized
// result); this module never recomputes a statistic. The method phrasing + the
// citations are the curation. Deterministic, no model, no DOM.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { NormalizedResult } from "@/lib/datahub/run-analysis";
import { plainLanguageSummary } from "@/lib/datahub/plain-language";
import {
  REFERENCES,
  SOFTWARE_CITATIONS,
  formatReference,
  inTextCite,
  type Reference,
} from "@/lib/datahub/method-citations";

/** A method sentence plus the reference ids it cites (keys into REFERENCES). */
interface MethodDescription {
  sentence: string;
  refIds: string[];
}

/** Append an in-text "(Author year)" citation for each existing reference id. */
function withCites(sentence: string, refIds: string[]): string {
  const cited = refIds.filter((id) => REFERENCES[id]).map((id) => inTextCite(REFERENCES[id]));
  if (cited.length === 0) return sentence;
  return `${sentence} (${cited.join("; ")})`;
}

/**
 * The Methods-section description of the procedure for one analysis, with its
 * canonical citations. Falls back to the engine's own test label when a kind has
 * no bespoke sentence yet, so coverage degrades gracefully rather than wrongly.
 */
function describeMethod(result: NormalizedResult): MethodDescription {
  switch (result.kind) {
    case "ttest": {
      if (result.type === "mannWhitneyU") {
        return {
          sentence: withCites(
            "Two independent groups were compared with the Mann-Whitney U (rank-sum) test, which does not assume normality",
            ["mannWhitney"],
          ),
          refIds: ["mannWhitney"],
        };
      }
      if (result.type === "wilcoxonSignedRank") {
        return {
          sentence: withCites(
            "Two paired groups were compared with the Wilcoxon signed-rank test, which does not assume normality",
            ["wilcoxonSignedRank"],
          ),
          refIds: ["wilcoxonSignedRank"],
        };
      }
      // The engine reports Cohen's d (named in the sentence) and, on the
      // parametric path, its bias-corrected companion Hedges' g; cite both.
      const esRefs = result.hedgesG !== null ? ["cohensD", "hedgesG"] : ["cohensD"];
      if (result.type === "pairedTTest") {
        const refs = ["studentT", ...esRefs];
        return {
          sentence: withCites(
            "Two paired groups were compared with a paired t-test, with the standardized effect reported as Cohen's dz",
            refs,
          ),
          refIds: refs,
        };
      }
      // Unpaired t-test: Welch (default) vs Student, per the resolved variance.
      const welch = result.variance !== "student";
      const tRef = welch ? "welchT" : "studentT";
      const refs = [tRef, ...esRefs];
      return {
        sentence: withCites(
          welch
            ? "Two independent groups were compared with Welch's unpaired t-test, which does not assume equal variances; the standardized effect is reported as Cohen's d"
            : "Two independent groups were compared with Student's unpaired t-test; the standardized effect is reported as Cohen's d",
          refs,
        ),
        refIds: refs,
      };
    }

    case "anova": {
      const refs = ["fisherAnova"];
      let s = "Group means were compared by one-way analysis of variance (ANOVA)";
      if (result.comparisons.length > 0) {
        // Tukey HSD is the all-pairs default in the engine.
        s += ", with Tukey's HSD for pairwise comparisons";
        refs.push("tukeyHSD");
      }
      if (result.effectSize) s += ", reporting eta-squared as the effect size";
      return { sentence: withCites(s, refs), refIds: refs };
    }

    case "twoWayAnova":
      return {
        sentence: withCites(
          "Main effects and their interaction were assessed by two-way analysis of variance (ANOVA)",
          ["fisherAnova"],
        ),
        refIds: ["fisherAnova"],
      };

    case "rmAnova":
      return {
        sentence: withCites(
          "Within-subject means were compared by repeated-measures ANOVA, with the Greenhouse-Geisser and Huynh-Feldt corrections reported for sphericity",
          ["fisherAnova"],
        ),
        refIds: ["fisherAnova"],
      };

    case "nestedTTest":
    case "nestedOneWayAnova":
      return {
        sentence: withCites(
          "Groups were compared by a nested (hierarchical) analysis that accounts for clustered, non-independent replicates",
          ["fisherAnova"],
        ),
        refIds: ["fisherAnova"],
      };

    case "correlation": {
      if (result.method === "spearman") {
        return {
          sentence: withCites(
            "The monotonic association between the two variables was assessed by Spearman rank correlation",
            ["spearman"],
          ),
          refIds: ["spearman"],
        };
      }
      return {
        sentence:
          "The linear association between the two variables was assessed by Pearson correlation.",
        refIds: [],
      };
    }

    case "regression":
      return {
        sentence:
          "A straight line was fit by ordinary least-squares linear regression.",
        refIds: [],
      };

    case "multipleRegression":
      return {
        sentence:
          "Predictors were modeled by ordinary least-squares multiple linear regression, with the variance inflation factor (VIF) reported per predictor to flag collinearity.",
        refIds: [],
      };

    case "logisticRegression": {
      // The engine sets method "firth" when separation forced the penalized fit.
      const firth = (result as { method?: string }).method === "firth";
      if (firth) {
        return {
          sentence: withCites(
            "A binary outcome was modeled by logistic regression, using Firth's penalized-likelihood correction because the data were separable",
            ["firth"],
          ),
          refIds: ["firth"],
        };
      }
      return {
        sentence:
          "A binary outcome was modeled by maximum-likelihood logistic regression, reporting the odds ratio per unit predictor.",
        refIds: [],
      };
    }

    case "doseResponse":
    case "globalFit":
      return {
        sentence: withCites(
          "A four-parameter logistic dose-response curve was fit by nonlinear least-squares regression, with the EC50 estimated on the log10(dose) scale",
          ["fourPL"],
        ),
        refIds: ["fourPL"],
      };

    case "modelComparison":
      return {
        sentence: withCites(
          "Candidate models were compared by the extra sum-of-squares F test and by the small-sample-corrected Akaike information criterion (AICc)",
          ["aicc"],
        ),
        refIds: ["aicc"],
      };

    case "survival": {
      const refs = ["kaplanMeier"];
      let s = "Survival was estimated by the Kaplan-Meier product-limit method";
      if (result.logRank) {
        s += " and groups were compared by the log-rank (Mantel-Cox) test";
        refs.push("logRankMantel");
      }
      if (result.gehanBreslowWilcoxon) {
        s += ", with the Gehan-Breslow-Wilcoxon test as an early-event-weighted alternative";
        refs.push("gehan");
      }
      return { sentence: withCites(s, refs), refIds: refs };
    }

    case "coxRegression":
      return {
        sentence: withCites(
          "The effect of covariates on the hazard was modeled by Cox proportional-hazards regression, reporting hazard ratios with 95% confidence intervals",
          ["coxPH"],
        ),
        refIds: ["coxPH"],
      };

    case "mixedModel":
      return {
        sentence:
          "Repeated observations were modeled by a linear mixed-effects model with a random intercept per subject, fit by restricted maximum likelihood (REML).",
        refIds: [],
      };

    case "grubbsOutlier":
      return {
        sentence: withCites(
          "Outliers were screened with Grubbs' test (the extreme studentized deviate), applied iteratively",
          ["grubbs"],
        ),
        refIds: ["grubbs"],
      };

    case "rocCurve":
      return {
        sentence: withCites(
          "Classifier performance was summarized by the area under the receiver operating characteristic (ROC) curve",
          ["rocHanley"],
        ),
        refIds: ["rocHanley"],
      };

    case "contingency":
      return {
        sentence: withCites(
          "Association in the contingency table was tested by Pearson's chi-square test (or Fisher's exact test for small expected counts)",
          ["pearsonChiSquare", "fisherExact"],
        ),
        refIds: ["pearsonChiSquare", "fisherExact"],
      };

    default: {
      // Unreachable for the known kinds; keeps coverage honest for any new kind.
      const test = (result as { test?: string }).test;
      return {
        sentence: test
          ? `The analysis was performed using ${test}.`
          : "The analysis was performed using the test named in the result.",
        refIds: [],
      };
    }
  }
}

/** Software citation lines the analysis always carries (the app, plus any libs). */
function softwareRefs(): Reference[] {
  return [...SOFTWARE_CITATIONS];
}

/** The Methods-section paragraph: the procedure + its citations + the software. */
export function methodsParagraph(result: NormalizedResult): string {
  const { sentence } = describeMethod(result);
  const software = SOFTWARE_CITATIONS[0];
  const softwareLine = software
    ? ` Statistical analyses were performed in ResearchOS Data Hub (${inTextCite(software)}).`
    : "";
  return `${sentence}${softwareLine}`;
}

/** The Results-section paragraph: the validated plain-language finding. */
export function resultsParagraph(result: NormalizedResult): string {
  return plainLanguageSummary(result);
}

/** The deduped reference list: methods cited + the open-source software used. */
export function collectReferences(result: NormalizedResult): Reference[] {
  const { refIds } = describeMethod(result);
  const seen = new Set<string>();
  const out: Reference[] = [];
  for (const id of refIds) {
    const ref = REFERENCES[id];
    if (ref && !seen.has(id)) {
      seen.add(id);
      out.push(ref);
    }
  }
  for (const ref of softwareRefs()) {
    if (!seen.has(ref.id)) {
      seen.add(ref.id);
      out.push(ref);
    }
  }
  return out;
}

/** The reference list as a numbered plain-text block, ready to paste. */
export function referencesText(result: NormalizedResult): string {
  return collectReferences(result)
    .map((r, i) => `${i + 1}. ${formatReference(r)}`)
    .join("\n");
}
