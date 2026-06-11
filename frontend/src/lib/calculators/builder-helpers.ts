// Builder helpers shared by the simplified form (CalculatorEditView) and the
// guided wizard (CalculatorWizard), 2026-06-10 hybrid redesign.
//
// Two jobs:
//   1. Derive a valid formula identifier from a plain-language input label, so
//      the author types "Colonies counted" and gets `colonies` without ever
//      hand-editing a separate key field. The why: a separate "key" field was
//      the single most confusing part of the old builder.
//   2. Provide the clickable variable + helper chips shown above each formula
//      box, with a live result. The helper set mirrors the most common engine
//      functions (mean, sum, count, if, col) registered in custom.ts.

import { isReservedName } from "@/lib/calculators/custom";
import type {
  CustomCalculatorInput,
  CustomCalculatorStep,
  CustomCalculatorConditional,
  CustomCalculatorOutput,
} from "@/lib/types";

/** The formula helpers surfaced as clickable chips. The inserted text drops the
 *  caret-ready opening paren so the author types the argument straight away.
 *  These mirror engine functions registered in custom.ts (mean/sum/count/col)
 *  plus the `if(` conditional, which is native to expr-eval-fork. */
export const FORMULA_HELPER_CHIPS: { label: string; insert: string }[] = [
  { label: "mean( )", insert: "mean(" },
  { label: "sum( )", insert: "sum(" },
  { label: "count( )", insert: "count(" },
  { label: "if( )", insert: "if(" },
  { label: "col( )", insert: "col(" },
];

/** Lower-camelCase a plain-language label into a candidate identifier:
 *  "Volume plated (mL)" -> "volumePlated", "Colonies counted" -> "colonies"
 *  (first significant word wins when short), stripping anything that is not a
 *  valid JS identifier character. Returns "" when nothing usable remains. */
function camelFromLabel(label: string): string {
  // Drop parenthetical groups first; they are almost always a unit or an aside
  // ("Volume plated (mL)" -> "Volume plated"), not part of the variable name.
  const withoutParens = label.replace(/\([^)]*\)/g, " ");
  // Split on any run of non-alphanumeric characters, drop empties.
  const words = withoutParens
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  const parts = words.map((w, i) => {
    const lower = w.toLowerCase();
    if (i === 0) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  let key = parts.join("");
  // An identifier cannot start with a digit. Prefix a `v` so a label like
  // "260 reading" still yields a usable key (`v260Reading`).
  if (/^[0-9]/.test(key)) key = "v" + key;
  return key;
}

/**
 * Derive a unique, valid, non-reserved formula key from a plain-language label.
 *
 * @param label    the input's human label (e.g. "Colonies counted")
 * @param taken    keys already used by other inputs / steps (collision guard)
 * @returns a camelCase identifier guaranteed not to be empty, reserved, or a
 *          duplicate. Falls back to "value" then appends a number as needed.
 */
export function deriveInputKey(label: string, taken: readonly string[]): string {
  const used = new Set(taken.map((k) => k.trim().toLowerCase()));
  const base = camelFromLabel(label) || "value";

  // If the bare base collides with a reserved engine name, append "Value" so it
  // reads naturally ("count" -> "countValue") before falling back to numbers.
  const candidates: string[] = [];
  if (!isReservedName(base)) {
    candidates.push(base);
  } else {
    candidates.push(base + "Value");
  }
  // Numbered fallbacks: base2, base3, ... covering both reserved + duplicate.
  for (let n = 2; n <= 999; n++) candidates.push(base + n);

  for (const c of candidates) {
    if (!isReservedName(c) && !used.has(c.toLowerCase())) return c;
  }
  // Pathological exhaustion guard (effectively unreachable).
  return base + Date.now().toString(36);
}

// ── Wizard draft assembly ────────────────────────────────────────────────────
//
// The guided wizard collects its answers as a flat, plain state object, then
// this pure function turns that state into the spec arrays a CalcDraft needs.
// Keeping it pure means the wizard and a unit test agree on exactly what gets
// saved, and the form (which shares the CalcDraft shape) can pick the draft up
// unchanged when the author switches over.

/** A single measurement the author enters at the bench. */
export interface WizardMeasurement {
  /** Plain-language label, e.g. "Colonies counted". */
  label: string;
  /** Auto-derived formula key; the wizard fills this via deriveInputKey. */
  key: string;
  /** Optional unit shown next to the field, e.g. "mL". */
  unit?: string;
}

/** A warning rule the author can add on the optional step. */
export interface WizardWarning {
  /** The condition under which the message shows, e.g. "colonies < 30". */
  condition: string;
  /** The message to surface when the condition holds. */
  message: string;
}

/** A named intermediate value the author can add on the optional step. */
export interface WizardStep {
  key: string;
  expr: string;
}

export interface WizardState {
  name: string;
  field: string;
  measurements: WizardMeasurement[];
  formula: string;
  answerLabel: string;
  answerUnit: string;
  warnings: WizardWarning[];
  steps: WizardStep[];
}

export function emptyWizardState(): WizardState {
  return {
    name: "",
    field: "",
    measurements: [],
    formula: "",
    answerLabel: "",
    answerUnit: "",
    warnings: [],
    steps: [],
  };
}

/** Assemble the four spec arrays plus identity from a finished wizard state. The
 *  result is the shape a CalcDraft expects (sans sharing, which the wizard
 *  always saves as private). A warning becomes a conditional of the form
 *  if(condition, "message", ""); a blank message or condition is dropped. */
export function buildDraftPartsFromWizard(state: WizardState): {
  name: string;
  field: string;
  inputs: CustomCalculatorInput[];
  steps: CustomCalculatorStep[];
  conditionals: CustomCalculatorConditional[];
  outputs: CustomCalculatorOutput[];
} {
  const inputs: CustomCalculatorInput[] = state.measurements
    .filter((m) => m.label.trim() !== "" || m.key.trim() !== "")
    .map((m) => ({
      key: m.key,
      type: "number" as const,
      label: m.label,
      ...(m.unit && m.unit.trim() !== "" ? { unit: m.unit.trim() } : {}),
    }));

  const steps: CustomCalculatorStep[] = state.steps
    .filter((s) => s.key.trim() !== "" && s.expr.trim() !== "")
    .map((s) => ({ key: s.key.trim(), expr: s.expr.trim() }));

  const conditionals: CustomCalculatorConditional[] = state.warnings
    .filter((w) => w.condition.trim() !== "" && w.message.trim() !== "")
    .map((w) => ({
      // Escape any double quotes in the message so the expression stays valid.
      expr: `if(${w.condition.trim()}, "${w.message.trim().replace(/"/g, "'")}", "")`,
    }));

  const outputs: CustomCalculatorOutput[] = [
    {
      label: state.answerLabel.trim() || state.name.trim(),
      expr: state.formula.trim(),
      ...(state.answerUnit && state.answerUnit.trim() !== ""
        ? { unit: state.answerUnit.trim() }
        : {}),
    },
  ];

  return {
    name: state.name.trim(),
    field: state.field.trim(),
    inputs,
    steps,
    conditionals,
    outputs,
  };
}

// ── Hybrid entry routing ─────────────────────────────────────────────────────
//
// Build your own routes a first-timer to the guided wizard and a returning
// author to the simpler full form. A first-timer is anyone who has not yet
// SAVED a calculator they own; calculators shared into their lab do not count,
// since reading someone else's does not teach you the builder. While the list
// is still loading we route to the wizard, the safer default for a likely
// first-timer. Pure so the routing rule is unit-testable.

export function shouldRouteToWizard(opts: {
  loaded: boolean;
  /** Whether the user owns at least one saved calculator (shared-in excluded). */
  hasOwnCalculator: boolean;
}): boolean {
  if (!opts.loaded) return true;
  return !opts.hasOwnCalculator;
}

/** Insert chip text into an existing formula string, adding a separating space
 *  only when the current value does not already end in whitespace or an open
 *  paren. Pure so both the form and wizard share identical insert behaviour. */
export function insertIntoFormula(current: string, insert: string): string {
  if (current === "" || /[\s(]$/.test(current)) return current + insert;
  return current + " " + insert;
}
