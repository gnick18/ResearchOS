/**
 * Phone engine for the Custom Calculator Builder (Phase 3, 2026-06-10).
 *
 * A VERBATIM port of the laptop evaluator in
 * frontend/src/lib/calculators/custom.ts. The math MUST match the laptop
 * exactly so a calculator the researcher builds at their desk computes the same
 * answer at the bench. mobile/lib/calculators/custom.test.ts pins the same
 * oracle values the laptop golden suite uses, so any drift between the two
 * engines fails the test.
 *
 * It reuses expr-eval-fork (the same MIT, ~8KB parser the scientific tab uses,
 * see scientific.ts), so the phone adds no new runtime dependency and inherits
 * the same hardened expression engine.
 *
 * Read mode only on the phone: the spec is fetched from the synced
 * "calculators" snapshot (lib/snapshots.ts), never authored here. The builder
 * stays on the laptop.
 *
 * Registered helpers (identical to the laptop): mean, sum, count, sd (SAMPLE,
 * n-1), min, max, shannon (Shannon entropy H), simpson (Gini-Simpson), geomean,
 * sumproduct, linfit_slope, linfit_intercept; plus lowercase pi / e, ln, sqrt,
 * and ^, all native to expr-eval-fork. if(cond, a, b) is a built-in ternary.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import { Parser, type Values } from 'expr-eval-fork';

// ── Calculator spec types ─────────────────────────────────────────────────────
//
// These mirror the laptop CustomCalculator shape (frontend/src/lib/types.ts),
// kept local because the phone has no shared types package. They match the
// "calculators" snapshot the laptop publishes (SnapshotCalculator), so the
// synced spec drops straight into evaluateCustomCalculator.

export interface CustomCalculatorDropdownOption {
  label: string;
  value: number | string;
}

export interface CustomCalculatorInput {
  key: string;
  type: 'number' | 'replicate' | 'dropdown';
  label: string;
  unit?: string;
  default?: number | number[] | string;
  options?: CustomCalculatorDropdownOption[];
}

export interface CustomCalculatorStep {
  key: string;
  expr: string;
}

export interface CustomCalculatorConditional {
  expr: string;
}

export interface CustomCalculatorOutput {
  label: string;
  expr: string;
  unit?: string;
}

/** The runnable spec the phone evaluates (the subset of the laptop record + the
 *  snapshot carries; id / sharing metadata is not needed by the engine). */
export interface CustomCalculatorSpec {
  name: string;
  description: string;
  field?: string;
  inputs: CustomCalculatorInput[];
  steps: CustomCalculatorStep[];
  conditionals: CustomCalculatorConditional[];
  outputs: CustomCalculatorOutput[];
}

// ── List helpers ─────────────────────────────────────────────────────────────
//
// expr-eval-fork passes a replicate input through as a JS array. These helpers
// accept either a single array argument or a spread of numbers (mean(a, b, c)),
// coercing each element to a number and dropping non-finite entries, so an
// empty replicate box does not poison the whole list.

function toNumbers(args: unknown[]): number[] {
  const flat: unknown[] =
    args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  const nums: number[] = [];
  for (const v of flat) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

function listSum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

function listMean(xs: number[]): number {
  return xs.length === 0 ? NaN : listSum(xs) / xs.length;
}

/** SAMPLE standard deviation (n-1 denominator). NaN for fewer than 2 points. */
function listSd(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = listMean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (n - 1));
}

/** Shannon entropy H = -Sum p_i * ln(p_i) over p_i > 0, with p_i = n_i/Sum. */
function shannon(xs: number[]): number {
  const total = listSum(xs);
  if (!(total > 0)) return NaN;
  let h = 0;
  for (const x of xs) {
    if (x > 0) {
      const p = x / total;
      h -= p * Math.log(p);
    }
  }
  return h;
}

/** Gini-Simpson diversity = 1 - Sum p_i^2. */
function simpson(xs: number[]): number {
  const total = listSum(xs);
  if (!(total > 0)) return NaN;
  let s = 0;
  for (const x of xs) {
    const p = x / total;
    s += p * p;
  }
  return 1 - s;
}

/** Geometric mean = exp(mean of ln(x)) over x > 0. */
function geomean(xs: number[]): number {
  const positives = xs.filter((x) => x > 0);
  if (positives.length === 0) return NaN;
  let lnSum = 0;
  for (const x of positives) lnSum += Math.log(x);
  return Math.exp(lnSum / positives.length);
}

/** Dot product of two equal-length lists (truncated to the shorter). */
function sumproduct(a: unknown, b: unknown): number {
  const xs = toNumbers([a]);
  const ys = toNumbers([b]);
  const n = Math.min(xs.length, ys.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += xs[i] * ys[i];
  return s;
}

/** Ordinary-least-squares fit of ys on xs. Returns { slope, intercept }. */
function ols(xsRaw: unknown, ysRaw: unknown): { slope: number; intercept: number } {
  const xs = toNumbers([xsRaw]);
  const ys = toNumbers([ysRaw]);
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: NaN, intercept: NaN };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  const slope = den === 0 ? NaN : num / den;
  const intercept = my - slope * mx;
  return { slope, intercept };
}

// ── Parser construction ──────────────────────────────────────────────────────
//
// A single shared parser is safe: parse() returns a fresh Expression each call
// and the helper tables are immutable after construction (same pattern as
// scientific.ts). if, the comparison operators, and/or, ^, ln, and sqrt are all
// native to expr-eval-fork; we ONLY add the list helpers + lowercase pi / e.

function makeCustomParser(): Parser {
  const parser = new Parser();
  parser.consts = { ...parser.consts, pi: Math.PI, e: Math.E };
  parser.functions = {
    ...parser.functions,
    mean: (...args: unknown[]) => listMean(toNumbers(args)),
    sum: (...args: unknown[]) => listSum(toNumbers(args)),
    count: (...args: unknown[]) => toNumbers(args).length,
    sd: (...args: unknown[]) => listSd(toNumbers(args)),
    min: (...args: unknown[]) => {
      const xs = toNumbers(args);
      return xs.length === 0 ? NaN : Math.min(...xs);
    },
    max: (...args: unknown[]) => {
      const xs = toNumbers(args);
      return xs.length === 0 ? NaN : Math.max(...xs);
    },
    shannon: (...args: unknown[]) => shannon(toNumbers(args)),
    simpson: (...args: unknown[]) => simpson(toNumbers(args)),
    geomean: (...args: unknown[]) => geomean(toNumbers(args)),
    sumproduct: (a: unknown, b: unknown) => sumproduct(a, b),
    linfit_slope: (xs: unknown, ys: unknown) => ols(xs, ys).slope,
    linfit_intercept: (xs: unknown, ys: unknown) => ols(xs, ys).intercept,
  };
  return parser;
}

const customParser = makeCustomParser();

// ── Display formatting ───────────────────────────────────────────────────────

/** Trim binary floating-point noise and render a clean numeric string. Mirrors
 *  the laptop formatCalcValue, with "—" for a non-finite (failed) value. */
export function formatCalcValue(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  if (n === 0) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(12)));
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export interface CustomCalcOutputResult {
  label: string;
  /** Numeric result; NaN when the expression failed or was non-numeric. */
  value: number;
  /** Clean display string ("—" on failure). */
  display: string;
  unit?: string;
}

export interface CustomCalcResult {
  outputs: CustomCalcOutputResult[];
  /** Non-empty guidance strings from the conditionals, in spec order. */
  messages: string[];
}

/** A map from input key to the value the user supplied. A replicate input is a
 *  number array; a number is a number; a dropdown is the selected option value
 *  (number or string). */
export type CustomCalcInputValues = Record<string, number | number[] | string>;

/** Coerce raw input values into the evaluation scope, applying each input's
 *  declared default when the supplied value is missing / blank. A replicate
 *  input always becomes an array (empty -> []); a dropdown falls back to its
 *  first option's value. */
function buildScope(
  calc: CustomCalculatorSpec,
  values: CustomCalcInputValues,
): Record<string, number | number[] | string> {
  const scope: Record<string, number | number[] | string> = {};
  for (const input of calc.inputs) {
    const supplied = values[input.key];
    if (input.type === 'replicate') {
      if (Array.isArray(supplied)) {
        scope[input.key] = supplied
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v));
      } else if (Array.isArray(input.default)) {
        scope[input.key] = input.default as number[];
      } else {
        scope[input.key] = [];
      }
    } else if (input.type === 'dropdown') {
      if (supplied !== undefined && supplied !== null && supplied !== '') {
        scope[input.key] = supplied as number | string;
      } else if (input.default !== undefined && !Array.isArray(input.default)) {
        scope[input.key] = input.default;
      } else if (input.options && input.options.length > 0) {
        scope[input.key] = input.options[0].value;
      } else {
        scope[input.key] = 0;
      }
    } else {
      // number
      if (supplied !== undefined && supplied !== null && supplied !== '') {
        const n = Number(supplied);
        scope[input.key] = Number.isFinite(n) ? n : NaN;
      } else if (typeof input.default === 'number') {
        scope[input.key] = input.default;
      } else {
        scope[input.key] = NaN;
      }
    }
  }
  return scope;
}

/** Evaluate one expression against a scope, returning the raw value or a thrown
 *  error swallowed to undefined. */
function evalExpr(expr: string, scope: Record<string, unknown>): unknown {
  const trimmed = (expr ?? '').trim();
  if (trimmed === '') return undefined;
  try {
    // expr-eval-fork accepts arrays in the scope at runtime (the list helpers
    // depend on it), but its Value type omits arrays, so the scope is cast
    // through Values here. The result type is any, narrowed by the caller.
    return customParser.parse(trimmed).evaluate(scope as unknown as Values);
  } catch {
    return undefined;
  }
}

/**
 * Run a CustomCalculatorSpec over a map of input values. Pure (no I/O); safe to
 * call on every keystroke for the live preview. Never throws: a malformed
 * expression yields a NaN output value with a "—" display.
 */
export function evaluateCustomCalculator(
  calc: CustomCalculatorSpec,
  values: CustomCalcInputValues,
): CustomCalcResult {
  const scope = buildScope(calc, values);

  // Steps mutate the shared scope so later steps / outputs see them.
  for (const step of calc.steps) {
    if (!step.key) continue;
    const result = evalExpr(step.expr, scope);
    scope[step.key] =
      typeof result === 'number' || typeof result === 'string'
        ? (result as number | string)
        : NaN;
  }

  const messages: string[] = [];
  for (const cond of calc.conditionals) {
    const result = evalExpr(cond.expr, scope);
    if (typeof result === 'string' && result.trim() !== '') {
      messages.push(result.trim());
    }
  }

  const outputs: CustomCalcOutputResult[] = calc.outputs.map((out) => {
    const result = evalExpr(out.expr, scope);
    const value = typeof result === 'number' ? result : NaN;
    return {
      label: out.label,
      value,
      display: formatCalcValue(value),
      ...(out.unit ? { unit: out.unit } : {}),
    };
  });

  return { outputs, messages };
}
