/**
 * Math layer for the general-purpose scientific calculator tab.
 *
 * The expression engine lives here so the UI stays presentational and the math
 * is unit-tested. We use `expr-eval-fork` (MIT, zero-dependency, ~8KB gzipped):
 * a small, safe Pratt-style expression evaluator. It replaced the `mathjs/number`
 * build, which added ~100KB gzipped to every page's first-load JS for what this
 * one tab needs; bundle weight matters in a local-first / no-backend app.
 * `expr-eval-fork` is the maintained fork of `expr-eval` and is not affected by
 * CVE-2025-12735 (the prototype-pollution / arbitrary-code issue in the original
 * silentmatt/expr-eval package).
 *
 * Conventions chosen for a familiar handheld-calculator feel:
 *  - `ln(x)` is natural log, `log10(x)` is base-10 (both are built-in unary
 *    operators in expr-eval; `lg`/`log` also exist but the UI only advertises
 *    `ln` and `log10`).
 *  - Degrees/radians is handled by overriding the trig unary operators on a
 *    dedicated parser, so a bare `sin(90)` honors the selected angle mode
 *    without rewriting the user's expression. expr-eval resolves `sin`, `cos`,
 *    etc. from the parser's `unaryOps` table (NOT from the evaluation scope),
 *    so the override has to live on the parser, not in the per-call scope.
 *  - `pi` and `e` are registered as lowercase constants (expr-eval ships only
 *    uppercase `PI`/`E`), matching the lowercase names the UI and tests use.
 *  - `Ans` (last result) and `M` (memory) are passed in per evaluation; they
 *    default to 0.
 */
import { Parser } from "expr-eval-fork";

export type AngleMode = "deg" | "rad";

const DEG_PER_RAD = Math.PI / 180;

/**
 * Build a parser for the given angle mode. `pi`/`e` are added as lowercase
 * constants on both; in degree mode the trig unary operators are overridden so
 * `sin(90)` etc. read as degrees. Each `new Parser()` gets its own `unaryOps`
 * and `consts` objects, so mutating one parser never affects the other.
 */
function makeParser(angleMode: AngleMode): Parser {
  const parser = new Parser();
  parser.consts = { ...parser.consts, pi: Math.PI, e: Math.E };
  if (angleMode === "deg") {
    parser.unaryOps = {
      ...parser.unaryOps,
      sin: (x: number) => Math.sin(x * DEG_PER_RAD),
      cos: (x: number) => Math.cos(x * DEG_PER_RAD),
      tan: (x: number) => Math.tan(x * DEG_PER_RAD),
      asin: (x: number) => Math.asin(x) / DEG_PER_RAD,
      acos: (x: number) => Math.acos(x) / DEG_PER_RAD,
      atan: (x: number) => Math.atan(x) / DEG_PER_RAD,
    };
  }
  return parser;
}

// Built once and reused: `parse()` returns a fresh Expression each call, so a
// shared Parser instance per mode is safe and avoids rebuilding the op tables
// on every keystroke.
const radParser = makeParser("rad");
const degParser = makeParser("deg");

export interface EvalSuccess {
  ok: true;
  value: number;
  /** Clean display string (binary float noise trimmed). */
  display: string;
}
export interface EvalFailure {
  ok: false;
  /** Empty string when the expression is simply blank (render nothing). */
  error: string;
}
export type EvalOutcome = EvalSuccess | EvalFailure;

/** Trim binary floating-point noise and render a clean result string. */
export function formatResult(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  if (n === 0) return "0";
  // Exact integers in the safe range print verbatim (don't let toPrecision
  // mangle a 16-digit count); everything else rounds to 12 significant digits
  // to kill artifacts like 0.1 + 0.2 = 0.30000000000000004.
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(12)));
}

/**
 * Evaluate a typed expression. Returns a clean numeric result or a failure with
 * a human-readable message (empty message for an empty expression, so the UI
 * can render nothing while the user is mid-type).
 */
export function evaluateExpression(
  expr: string,
  opts: { angleMode?: AngleMode; ans?: number; memory?: number } = {},
): EvalOutcome {
  const trimmed = (expr ?? "").trim();
  if (trimmed === "") return { ok: false, error: "" };
  const { angleMode = "rad", ans = 0, memory = 0 } = opts;

  const parser = angleMode === "deg" ? degParser : radParser;

  try {
    const value = parser.parse(trimmed).evaluate({ Ans: ans, M: memory }) as unknown;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: "Not a finite number" };
    }
    return { ok: true, value, display: formatResult(value) };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || "Invalid expression" };
  }
}
