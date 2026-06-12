// BeakerBot study-design coworker tool (ai plan-study bot, 2026-06-12).
//
// plan_study answers the study-design questions a researcher asks BEFORE any data
// is collected, the same job GraphPad Prism and G*Power do. THE ENGINE COMPUTES,
// the model only maps the user's words to the right engine call and relays the
// number. A wrong sample-size answer is worse than no tool, so every number here
// comes from the project's validated power / sample-size engine
// (lib/datahub/engine/power.ts, reference-validated against statsmodels in its
// pin suite). This tool holds NO statistics of its own; it is pure arg-mapping.
//
// Three modes, each over four design families:
//   - sampleSize       given an effect size, alpha, and desired power, what N?
//   - power            given N, an effect size, and alpha, what power do I have?
//   - detectableEffect given N, alpha, and a desired power, what is the smallest
//                      effect I can detect (the sensitivity)?
//
// Designs:
//   - twoSampleT   independent two-group t-test, effect = Cohen's d, N is per group
//   - pairedT      paired / one-sample t-test, effect = Cohen's dz, N is pairs
//   - oneWayAnova  one-way ANOVA over k groups, effect = Cohen's f, N is TOTAL
//   - correlation  Pearson correlation, effect = r, N is pairs
//
// Read-only, non-gated. It neither reads the user's data nor writes anything; it is
// a calculator the model invokes and relays.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  powerTwoSampleT,
  sampleSizeTwoSampleT,
  detectableDTwoSampleT,
  powerPairedT,
  sampleSizePairedT,
  detectableDzPairedT,
  powerOneWayAnova,
  sampleSizeOneWayAnova,
  detectableFOneWayAnova,
  powerCorrelation,
  sampleSizeCorrelation,
  detectableRCorrelation,
} from "@/lib/datahub/engine/power";
import type { AiTool } from "./types";

// The four design families and the three modes the planner answers.
export type StudyDesign =
  | "twoSampleT"
  | "pairedT"
  | "oneWayAnova"
  | "correlation";
export type StudyMode = "sampleSize" | "power" | "detectableEffect";

const DESIGNS: StudyDesign[] = [
  "twoSampleT",
  "pairedT",
  "oneWayAnova",
  "correlation",
];
const MODES: StudyMode[] = ["sampleSize", "power", "detectableEffect"];

/** The effect-size unit each design uses, for the human-readable result label. */
const EFFECT_UNIT: Record<StudyDesign, string> = {
  twoSampleT: "Cohen's d",
  pairedT: "Cohen's dz",
  oneWayAnova: "Cohen's f",
  correlation: "Pearson r",
};

/** What the returned N counts, for the human-readable result label. */
const N_MEANING: Record<StudyDesign, string> = {
  twoSampleT: "per group",
  pairedT: "pairs",
  oneWayAnova: "total (across all groups)",
  correlation: "pairs",
};

/** Return value from plan_study. */
export type PlanStudyResult =
  | {
      ok: true;
      design: StudyDesign;
      mode: StudyMode;
      /** The number the engine returned, named by mode. */
      result: number;
      /** A short unit label for the result, so the model can report it plainly. */
      result_label: string;
      /** The inputs the engine actually used (after defaults applied). */
      inputs: {
        alpha: number;
        power?: number;
        n?: number;
        k?: number;
        effect?: number;
      };
    }
  | { ok: false; error: string };

// Coerce a possibly-string numeric arg to a finite number, or undefined.
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export const planStudyTool: AiTool = {
  name: "plan_study",
  description:
    "plan_study answers study-design questions BEFORE any data is collected, how many samples do I need, what power do I have, or what is the smallest effect I could detect. It mirrors the power / sample-size planner in GraphPad Prism and G*Power. The validated engine computes every number; the model NEVER computes a sample size or a power itself, it maps the request to the engine and relays the result. Four designs: twoSampleT (independent two-group t-test, effect = Cohen's d, N per group), pairedT (paired / one-sample t-test, effect = Cohen's dz, N = pairs), oneWayAnova (one-way ANOVA over k groups, effect = Cohen's f, N = TOTAL across groups), correlation (Pearson correlation, effect = r, N = pairs). Three modes: sampleSize (given effect + alpha + power, returns the integer N), power (given n + effect + alpha, returns the achieved power as a probability in 0..1), detectableEffect (given n + alpha + power, returns the smallest detectable effect size). Cohen's conventional effects: d/dz 0.2 small, 0.5 medium, 0.8 large; f 0.1 small, 0.25 medium, 0.4 large; r 0.1 small, 0.3 medium, 0.5 large. Example, how many mice per group for a medium effect at 80% power maps to design twoSampleT, mode sampleSize, effect 0.5, alpha 0.05, power 0.8.",
  parameters: {
    type: "object",
    properties: {
      design: {
        type: "string",
        description:
          'The test family: "twoSampleT" (independent two-group t-test, effect = Cohen\'s d), "pairedT" (paired / one-sample t-test, effect = Cohen\'s dz), "oneWayAnova" (one-way ANOVA, effect = Cohen\'s f, also pass k groups), or "correlation" (Pearson correlation, effect = r).',
      },
      mode: {
        type: "string",
        description:
          'What to solve for: "sampleSize" (needs effect, alpha, power), "power" (needs n, effect, alpha), or "detectableEffect" (needs n, alpha, power).',
      },
      effect: {
        type: "number",
        description:
          "The effect size in the design's unit (Cohen's d for twoSampleT, dz for pairedT, f for oneWayAnova, r for correlation). Required for sampleSize and power modes; ignored for detectableEffect.",
      },
      n: {
        type: "number",
        description:
          "The sample size. For twoSampleT this is PER GROUP, for pairedT and correlation it is the number of pairs, for oneWayAnova it is the TOTAL across all groups. Required for power and detectableEffect modes.",
      },
      k: {
        type: "number",
        description:
          "Number of groups, for oneWayAnova only. Ignored for the other designs.",
      },
      alpha: {
        type: "number",
        description:
          "Two-sided significance level. Default 0.05.",
      },
      power: {
        type: "number",
        description:
          "Desired power (probability of detecting a true effect), a value in 0..1. Default 0.8. Used by sampleSize and detectableEffect modes.",
      },
    },
    required: ["design", "mode"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const design = args.design as StudyDesign;
    const mode = args.mode as StudyMode;

    if (!DESIGNS.includes(design)) {
      return {
        ok: false,
        error: `Unknown design "${String(args.design)}". Use one of: ${DESIGNS.join(", ")}.`,
      } satisfies PlanStudyResult;
    }
    if (!MODES.includes(mode)) {
      return {
        ok: false,
        error: `Unknown mode "${String(args.mode)}". Use one of: ${MODES.join(", ")}.`,
      } satisfies PlanStudyResult;
    }

    const alpha = num(args.alpha) ?? 0.05;
    const power = num(args.power) ?? 0.8;
    const effect = num(args.effect);
    const n = num(args.n);
    const k = num(args.k);

    if (!(alpha > 0 && alpha < 1)) {
      return {
        ok: false,
        error: `alpha must be between 0 and 1 (got ${alpha}).`,
      } satisfies PlanStudyResult;
    }

    // Mode-specific required-arg checks, then dispatch to the engine. The engine
    // returns null / NaN on a degenerate request (an effect of zero has no finite
    // N, an n below a family floor has no defined power); we relay that plainly.
    if (mode === "sampleSize" || mode === "power") {
      if (effect === undefined) {
        return {
          ok: false,
          error: `Mode "${mode}" needs an effect size (${EFFECT_UNIT[design]}). Pass the effect argument.`,
        } satisfies PlanStudyResult;
      }
    }
    if (mode === "power" || mode === "detectableEffect") {
      if (n === undefined) {
        return {
          ok: false,
          error: `Mode "${mode}" needs a sample size n (${N_MEANING[design]}). Pass the n argument.`,
        } satisfies PlanStudyResult;
      }
    }
    if (mode === "sampleSize" || mode === "detectableEffect") {
      if (!(power > 0 && power < 1)) {
        return {
          ok: false,
          error: `Mode "${mode}" needs a target power between 0 and 1 (got ${power}).`,
        } satisfies PlanStudyResult;
      }
    }
    if (design === "oneWayAnova" && (k === undefined || k < 2)) {
      return {
        ok: false,
        error: "oneWayAnova needs k (the number of groups), at least 2.",
      } satisfies PlanStudyResult;
    }

    let result: number | null = null;
    let resultLabel = "";

    if (mode === "sampleSize") {
      resultLabel = `N (${N_MEANING[design]})`;
      switch (design) {
        case "twoSampleT":
          result = sampleSizeTwoSampleT(effect!, alpha, power);
          break;
        case "pairedT":
          result = sampleSizePairedT(effect!, alpha, power);
          break;
        case "oneWayAnova":
          result = sampleSizeOneWayAnova(k!, effect!, alpha, power);
          break;
        case "correlation":
          result = sampleSizeCorrelation(effect!, alpha, power);
          break;
      }
    } else if (mode === "power") {
      resultLabel = "achieved power";
      switch (design) {
        case "twoSampleT":
          result = powerTwoSampleT(n!, effect!, alpha);
          break;
        case "pairedT":
          result = powerPairedT(n!, effect!, alpha);
          break;
        case "oneWayAnova":
          result = powerOneWayAnova(n!, k!, effect!, alpha);
          break;
        case "correlation":
          result = powerCorrelation(n!, effect!, alpha);
          break;
      }
    } else {
      // detectableEffect
      resultLabel = `smallest detectable ${EFFECT_UNIT[design]}`;
      switch (design) {
        case "twoSampleT":
          result = detectableDTwoSampleT(n!, alpha, power);
          break;
        case "pairedT":
          result = detectableDzPairedT(n!, alpha, power);
          break;
        case "oneWayAnova":
          result = detectableFOneWayAnova(n!, k!, alpha, power);
          break;
        case "correlation":
          result = detectableRCorrelation(n!, alpha, power);
          break;
      }
    }

    if (result === null || !Number.isFinite(result)) {
      return {
        ok: false,
        error:
          "The planner could not return a finite answer for those inputs. An effect of zero has no finite sample size, and an n below the design's floor has no defined power (n >= 2 per group / pair for a t-test, n > k for ANOVA, n >= 4 for correlation).",
      } satisfies PlanStudyResult;
    }

    return {
      ok: true,
      design,
      mode,
      result,
      result_label: resultLabel,
      inputs: {
        alpha,
        ...(mode === "sampleSize" || mode === "detectableEffect" ? { power } : {}),
        ...(n !== undefined ? { n } : {}),
        ...(design === "oneWayAnova" && k !== undefined ? { k } : {}),
        ...(effect !== undefined && mode !== "detectableEffect"
          ? { effect }
          : {}),
      },
    } satisfies PlanStudyResult;
  },
};
