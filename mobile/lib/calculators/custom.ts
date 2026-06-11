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

/** One column of a table input (Phase 5). An input column is filled per row; a
 *  computed column derives per row from expr over the other columns + scalars.
 *  Ported verbatim from the laptop shape so the math stays identical. */
export interface CustomCalculatorTableColumn {
  key: string;
  label: string;
  kind: 'input' | 'computed';
  unit?: string;
  expr?: string;
}

export interface CustomCalculatorInput {
  key: string;
  type: 'number' | 'replicate' | 'dropdown' | 'table';
  label: string;
  unit?: string;
  default?: number | number[] | string;
  options?: CustomCalculatorDropdownOption[];
  /** Columns for a table input (Phase 5). */
  columns?: CustomCalculatorTableColumn[];
  /** Optional seed rows for a table input, each keyed by column key. */
  rows?: Record<string, number | string>[];
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
  /** How the numeric value is rendered. Omitted = "auto" (the clean default).
   *  Mirrors the laptop record so phone display matches the laptop. */
  format?: 'auto' | 'scientific' | 'fixed';
  /** Decimal places for "scientific" / "fixed". Defaults to 2 when omitted. */
  decimals?: number;
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

/** Extract one column of a table input value as a numeric list, so a step or
 *  output can aggregate it (e.g. sum(col(reagents, "totalUL"))). Non-array
 *  tables, a missing key, and non-numeric cells degrade to an empty / shorter
 *  list rather than throwing. Ported verbatim from the laptop engine. */
function col(table: unknown, key: unknown): number[] {
  if (!Array.isArray(table)) return [];
  const k = String(key);
  const out: number[] = [];
  for (const row of table) {
    if (row && typeof row === 'object') {
      const cell = (row as Record<string, unknown>)[k];
      const n = typeof cell === 'number' ? cell : Number(cell);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
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
    col: (table: unknown, key: unknown) => col(table, key),
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

/** Per-output number format. "auto" is the clean default (`formatCalcValue`).
 *  "scientific" renders `2.5e8` via toExponential; "fixed" pins decimals via
 *  toFixed. The "—" non-finite guard is preserved. `decimals` defaults to 2.
 *  Verbatim mirror of the laptop engine so phone display matches. */
export function formatCalcValueAs(
  n: number,
  format?: 'auto' | 'scientific' | 'fixed',
  decimals?: number,
): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  const d = Number.isFinite(decimals)
    ? Math.min(100, Math.max(0, Math.trunc(decimals as number)))
    : 2;
  if (format === 'scientific') return n.toExponential(d);
  if (format === 'fixed') return n.toFixed(d);
  return formatCalcValue(n);
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
export type CustomCalcInputValues = Record<
  string,
  number | number[] | string | Record<string, number | string>[]
>;

/** A value bound into the evaluation scope. A table input is bound as an array
 *  of row objects (each cell a number or string); scalars stay numbers,
 *  strings, or number arrays. */
type ScopeValue =
  | number
  | number[]
  | string
  | Record<string, number | string>[];

/** Bind one table input's INPUT columns into an array of row objects. Computed
 *  columns are derived later (after steps) by deriveTableColumns. A blank cell
 *  binds as NaN; a descriptive cell stays a string. Ported verbatim. */
function bindTableRows(
  input: CustomCalculatorInput,
  supplied: unknown,
): Record<string, number | string>[] {
  const inputCols = (input.columns ?? []).filter((c) => c.kind === 'input');
  const sourceRows: Record<string, unknown>[] = Array.isArray(supplied)
    ? (supplied as Record<string, unknown>[])
    : Array.isArray(input.rows)
      ? (input.rows as Record<string, unknown>[])
      : [];
  return sourceRows.map((raw) => {
    const row: Record<string, number | string> = {};
    for (const c of inputCols) {
      const cell = raw?.[c.key];
      if (typeof cell === 'number') {
        row[c.key] = cell;
      } else if (cell !== undefined && cell !== null && cell !== '') {
        const n = Number(cell);
        row[c.key] = Number.isFinite(n) ? n : String(cell);
      } else {
        row[c.key] = NaN;
      }
    }
    return row;
  });
}

/** Derive each table input's computed columns in place, per row, against that
 *  row overlaid on the (step-complete) scope. Run after steps. */
function deriveTableColumns(
  calc: CustomCalculatorSpec,
  scope: Record<string, ScopeValue>,
): void {
  for (const input of calc.inputs) {
    if (input.type !== 'table') continue;
    const computedCols = (input.columns ?? []).filter(
      (c) => c.kind === 'computed',
    );
    if (computedCols.length === 0) continue;
    const rows = scope[input.key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Record<string, number | string>[]) {
      for (const c of computedCols) {
        const rowScope: Record<string, unknown> = { ...scope, ...row };
        const result = evalExpr(c.expr ?? '', rowScope);
        row[c.key] = typeof result === 'number' ? result : NaN;
      }
    }
  }
}

/** Coerce raw input values into the evaluation scope, applying each input's
 *  declared default when the supplied value is missing / blank. A replicate
 *  input always becomes an array (empty -> []); a dropdown falls back to its
 *  first option's value; a table binds its INPUT columns (computed columns
 *  derived later, after steps). */
function buildScope(
  calc: CustomCalculatorSpec,
  values: CustomCalcInputValues,
): Record<string, ScopeValue> {
  const scope: Record<string, ScopeValue> = {};
  for (const input of calc.inputs) {
    if (input.type === 'table') continue;
    const supplied = values[input.key];
    if (input.type === 'replicate') {
      if (Array.isArray(supplied)) {
        scope[input.key] = (supplied as unknown[])
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
  // Bind table input columns (computed columns derived after steps).
  for (const input of calc.inputs) {
    if (input.type !== 'table') continue;
    scope[input.key] = bindTableRows(input, values[input.key]);
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

  // Derive table computed columns now that scalar inputs AND steps are bound.
  deriveTableColumns(calc, scope);

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
      display: formatCalcValueAs(value, out.format, out.decimals),
      ...(out.unit ? { unit: out.unit } : {}),
    };
  });

  return { outputs, messages };
}

/** Resolve one table input's rows with computed columns filled in, exactly as
 *  the full evaluation would, so a read-only grid can render computed cells.
 *  Pure and non-throwing. Ported verbatim from the laptop engine. */
export function deriveTableRows(
  calc: CustomCalculatorSpec,
  values: CustomCalcInputValues,
  tableKey: string,
): Record<string, number | string>[] {
  const input = calc.inputs.find(
    (i) => i.key === tableKey && i.type === 'table',
  );
  if (!input) return [];
  const scope = buildScope(calc, values);
  for (const step of calc.steps) {
    if (!step.key) continue;
    const result = evalExpr(step.expr, scope);
    scope[step.key] =
      typeof result === 'number' || typeof result === 'string'
        ? (result as number | string)
        : NaN;
  }
  deriveTableColumns(calc, scope);
  const rows = scope[tableKey];
  return Array.isArray(rows)
    ? (rows as Record<string, number | string>[])
    : [];
}
