/**
 * Engine for the Custom Calculator Builder (Phase 1, 2026-06-10).
 *
 * A pure, dependency-light evaluator for a user-authored `CustomCalculator`
 * spec. It reuses `expr-eval-fork` (the same MIT, ~8KB parser that powers the
 * scientific-calculator tab, see `scientific.ts`) so the builder adds no new
 * runtime dependency and inherits the same hardened, non-prototype-polluting
 * expression engine (not affected by CVE-2025-12735).
 *
 * Evaluation order, given a spec + a map of input values:
 *   1. Bind inputs into the scope (a `replicate` input is bound as an array; a
 *      `number` as a number; a `dropdown` as the selected option value, which
 *      may be a number OR a string so `mode == "rpm"` works).
 *   2. Evaluate `steps` in array order. Each step name becomes available to
 *      later steps, conditionals, and outputs.
 *   3. Evaluate `conditionals`. A non-empty STRING result is collected as a
 *      guidance message (the common shape is `if(cond, "warn ...", "")`).
 *   4. Evaluate `outputs`.
 *
 * The result is `{ outputs: {label, value, display, unit}[], messages: string[] }`.
 * A per-expression failure (bad formula, missing variable, divide-by-zero to
 * NaN) is swallowed into a NaN value with a "—" display rather than throwing,
 * so a half-built calculator still renders in the live preview while the author
 * is mid-edit. The catalog files test asserts each shipped template evaluates
 * cleanly on its defaults.
 *
 * Registered helpers (in addition to expr-eval-fork built-ins, plus lowercase
 * `pi`/`e`, `ln`, `sqrt`, and `^`, mirroring scientific.ts):
 *   List-aware: mean, sum, count, sd (SAMPLE, n-1), min, max, shannon (Shannon
 *   entropy H), simpson (Gini-Simpson 1 - Sum p^2), geomean, sumproduct(a,b),
 *   linfit_slope(xs,ys), linfit_intercept(xs,ys).
 *   `if(cond, a, b)` is a built-in ternary; comparison + and/or work inside.
 */
import { Parser, type Values } from "expr-eval-fork";
import type { CustomCalculator } from "@/lib/types";

// ── List helpers ─────────────────────────────────────────────────────────────
//
// expr-eval-fork passes a `replicate` input through as a JS array. These
// helpers accept either a single array argument or a spread of numbers
// (`mean(a, b, c)`), coercing each element to a number and dropping non-finite
// entries, so an empty replicate box does not poison the whole list.

function toNumbers(args: unknown[]): number[] {
  const flat: unknown[] =
    args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  const nums: number[] = [];
  for (const v of flat) {
    const n = typeof v === "number" ? v : Number(v);
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

/** Extract one column of a `table` input value as a numeric list, so a step or
 *  output can aggregate it (e.g. `sum(col(reagents, "totalUL"))`). The first
 *  argument is the table value (an array of row objects, as bound into the
 *  scope by `buildScope`), the second is the column key. Non-array tables, a
 *  missing key, and non-numeric cells degrade to an empty / shorter list rather
 *  than throwing, matching the engine's NaN-not-crash contract. */
function col(table: unknown, key: unknown): number[] {
  if (!Array.isArray(table)) return [];
  const k = String(key);
  const out: number[] = [];
  for (const row of table) {
    if (row && typeof row === "object") {
      const cell = (row as Record<string, unknown>)[k];
      const n = typeof cell === "number" ? cell : Number(cell);
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
// A single shared parser is safe: `parse()` returns a fresh Expression each
// call and the helper tables are immutable after construction (same pattern as
// scientific.ts). `if`, the comparison operators, `and`/`or`, `^`, `ln`, and
// `sqrt` are all native to expr-eval-fork (verified); we ONLY add the list
// helpers + lowercase `pi`/`e` constants.

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

// ── Reserved names ───────────────────────────────────────────────────────────
//
// An input / step / column key must never equal a name the engine already
// resolves, or the formula silently breaks. A key named `count`, for example,
// makes `count * 10000` resolve the built-in `count()` list helper instead of
// the value, yielding NaN with no error. RESERVED_NAMES is derived from the
// SAME parser instance the evaluator uses, so it can never drift from what is
// actually registered (a new helper like `col` is reserved automatically). The
// keyword operators (and/or/not/in) are tokenizer syntax rather than entries in
// the function / constant tables, so they are added explicitly.

export const RESERVED_NAMES: ReadonlySet<string> = new Set(
  [
    ...Object.keys(customParser.functions),
    ...Object.keys(customParser.consts),
    "and",
    "or",
    "not",
    "in",
  ].map((n) => n.toLowerCase()),
);

/** True when a proposed key collides with a reserved engine name
 *  (case-insensitive, so `Count` collides too). */
export function isReservedName(key: string): boolean {
  return RESERVED_NAMES.has(key.trim().toLowerCase());
}

// ── Display formatting ───────────────────────────────────────────────────────

/** Trim binary floating-point noise and render a clean numeric string. Mirrors
 *  scientific.ts `formatResult`, with "—" for a non-finite (failed) value. */
export function formatCalcValue(n: number): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  if (n === 0) return "0";
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

/** One row of a `table` input value, keyed by column key. A cell is a number
 *  or a descriptive string; `computed` columns are derived during evaluation
 *  and need not be present here. */
export type CustomCalcTableRow = Record<string, number | string>;

/** A map from input `key` to the value the user supplied. A `replicate` input
 *  is a number array; a `number` is a number; a `dropdown` is the selected
 *  option value (number or string); a `table` is an array of row objects. */
export type CustomCalcInputValues = Record<
  string,
  number | number[] | string | CustomCalcTableRow[]
>;

/** A value bound into the evaluation scope. A `table` input is bound as an
 *  array of row objects (each cell a number or string), which the `col` helper
 *  reads; the scalar inputs / steps stay numbers, strings, or number arrays. */
type ScopeValue =
  | number
  | number[]
  | string
  | Record<string, number | string>[];

/** Bind one `table` input's INPUT columns into an array of row objects. Each
 *  row carries its user-filled `input` cells (coerced to number where they
 *  parse, else kept as the raw string for descriptive columns). Computed
 *  columns are NOT derived here; they are filled in by `deriveTableColumns`
 *  after the calculator's steps run, so a computed column can reference both
 *  scalar inputs AND step results. A blank cell binds as NaN. */
function bindTableRows(
  input: CustomCalculator["inputs"][number],
  supplied: unknown,
): Record<string, number | string>[] {
  const inputCols = (input.columns ?? []).filter((c) => c.kind === "input");
  const sourceRows: Record<string, unknown>[] = Array.isArray(supplied)
    ? (supplied as Record<string, unknown>[])
    : Array.isArray(input.rows)
      ? (input.rows as Record<string, unknown>[])
      : [];

  return sourceRows.map((raw) => {
    const row: Record<string, number | string> = {};
    for (const c of inputCols) {
      const cell = raw?.[c.key];
      if (typeof cell === "number") {
        row[c.key] = cell;
      } else if (cell !== undefined && cell !== null && cell !== "") {
        const n = Number(cell);
        row[c.key] = Number.isFinite(n) ? n : String(cell);
      } else {
        row[c.key] = NaN;
      }
    }
    return row;
  });
}

/** Derive each `table` input's `computed` columns in place, per row, against
 *  that row's input cells overlaid on the (now step-complete) scope. Run after
 *  steps so a per-row formula can reference scalar inputs AND step results; a
 *  bad cell degrades to NaN. */
function deriveTableColumns(
  calc: CustomCalculator,
  scope: Record<string, ScopeValue>,
): void {
  for (const input of calc.inputs) {
    if (input.type !== "table") continue;
    const computedCols = (input.columns ?? []).filter(
      (c) => c.kind === "computed",
    );
    if (computedCols.length === 0) continue;
    const rows = scope[input.key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Record<string, number | string>[]) {
      for (const c of computedCols) {
        const rowScope: Record<string, unknown> = { ...scope, ...row };
        const result = evalExpr(c.expr ?? "", rowScope);
        row[c.key] = typeof result === "number" ? result : NaN;
      }
    }
  }
}

/** Coerce raw input values into the evaluation scope, applying each input's
 *  declared default when the supplied value is missing / blank. A `replicate`
 *  input always becomes an array (empty -> []); a `dropdown` falls back to its
 *  first option's value; a `table` binds its INPUT columns as an array of row
 *  objects (computed columns are derived later, after steps). */
function buildScope(
  calc: CustomCalculator,
  values: CustomCalcInputValues,
): Record<string, ScopeValue> {
  const scope: Record<string, ScopeValue> = {};
  // Pass 1: scalar inputs (number / replicate / dropdown).
  for (const input of calc.inputs) {
    if (input.type === "table") continue;
    const supplied = values[input.key];
    if (input.type === "replicate") {
      if (Array.isArray(supplied)) {
        scope[input.key] = supplied
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v));
      } else if (Array.isArray(input.default)) {
        scope[input.key] = input.default as number[];
      } else {
        scope[input.key] = [];
      }
    } else if (input.type === "dropdown") {
      if (supplied !== undefined && supplied !== null && supplied !== "") {
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
      if (supplied !== undefined && supplied !== null && supplied !== "") {
        const n = Number(supplied);
        scope[input.key] = Number.isFinite(n) ? n : NaN;
      } else if (typeof input.default === "number") {
        scope[input.key] = input.default;
      } else {
        scope[input.key] = NaN;
      }
    }
  }
  // Pass 2: bind table input columns (computed columns derived after steps).
  for (const input of calc.inputs) {
    if (input.type !== "table") continue;
    scope[input.key] = bindTableRows(input, values[input.key]);
  }
  return scope;
}

/** Evaluate one expression against a scope, returning the raw value or a thrown
 *  error swallowed to `undefined`. */
function evalExpr(
  expr: string,
  scope: Record<string, unknown>,
): unknown {
  const trimmed = (expr ?? "").trim();
  if (trimmed === "") return undefined;
  try {
    // expr-eval-fork accepts arrays in the scope at runtime (the list helpers
    // depend on it), but its `Value` type omits arrays, so the scope is cast
    // through `Values` here. The result type is `any`, narrowed by the caller.
    return customParser.parse(trimmed).evaluate(scope as unknown as Values);
  } catch {
    return undefined;
  }
}

/**
 * Run a `CustomCalculator` over a map of input values. Pure (no I/O); safe to
 * call on every keystroke for the live preview. Never throws: a malformed
 * expression yields a NaN output value with a "—" display.
 */
export function evaluateCustomCalculator(
  calc: CustomCalculator,
  values: CustomCalcInputValues,
): CustomCalcResult {
  const scope = buildScope(calc, values);

  // Steps mutate the shared scope so later steps / outputs see them.
  for (const step of calc.steps) {
    if (!step.key) continue;
    const result = evalExpr(step.expr, scope);
    scope[step.key] =
      typeof result === "number" || typeof result === "string"
        ? (result as number | string)
        : NaN;
  }

  // Derive table computed columns now that scalar inputs AND steps are bound,
  // so a per-row formula can reference either.
  deriveTableColumns(calc, scope);

  const messages: string[] = [];
  for (const cond of calc.conditionals) {
    const result = evalExpr(cond.expr, scope);
    if (typeof result === "string" && result.trim() !== "") {
      messages.push(result.trim());
    }
  }

  const outputs: CustomCalcOutputResult[] = calc.outputs.map((out) => {
    const result = evalExpr(out.expr, scope);
    const value = typeof result === "number" ? result : NaN;
    return {
      label: out.label,
      value,
      display: formatCalcValue(value),
      ...(out.unit ? { unit: out.unit } : {}),
    };
  });

  return { outputs, messages };
}

/**
 * Resolve one `table` input's rows with its computed columns filled in, exactly
 * as the full evaluation would, so the Use-mode grid can render computed cells
 * live as the user edits input cells. Returns an array of row objects keyed by
 * column key (each cell a number or a descriptive string); a non-table or
 * unknown key yields an empty array. Pure and non-throwing, like the engine.
 */
export function deriveTableRows(
  calc: CustomCalculator,
  values: CustomCalcInputValues,
  tableKey: string,
): Record<string, number | string>[] {
  const input = calc.inputs.find(
    (i) => i.key === tableKey && i.type === "table",
  );
  if (!input) return [];
  const scope = buildScope(calc, values);
  for (const step of calc.steps) {
    if (!step.key) continue;
    const result = evalExpr(step.expr, scope);
    scope[step.key] =
      typeof result === "number" || typeof result === "string"
        ? (result as number | string)
        : NaN;
  }
  deriveTableColumns(calc, scope);
  const rows = scope[tableKey];
  return Array.isArray(rows)
    ? (rows as Record<string, number | string>[])
    : [];
}
