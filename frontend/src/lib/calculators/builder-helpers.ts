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

/** Insert chip text into an existing formula string, adding a separating space
 *  only when the current value does not already end in whitespace or an open
 *  paren. Pure so both the form and wizard share identical insert behaviour. */
export function insertIntoFormula(current: string, insert: string): string {
  if (current === "" || /[\s(]$/.test(current)) return current + insert;
  return current + " " + insert;
}
