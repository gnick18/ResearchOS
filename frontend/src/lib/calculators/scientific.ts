/**
 * Math layer for the general-purpose scientific calculator tab.
 *
 * All mathjs usage lives here so the UI stays presentational and the math is
 * unit-tested. We import from the lighter `mathjs/number` build (number-only,
 * no BigNumber/Complex/Matrix/Unit) to keep the bundle small; its types resolve
 * from mathjs's main `index.d.ts`.
 *
 * Conventions chosen for a familiar handheld-calculator feel:
 *  - `ln(x)` is natural log, `log10(x)` is base-10 (mathjs's bare `log` is
 *    natural, which would be confusing, so `ln` is provided in scope).
 *  - Degrees/radians is handled by overriding the trig functions in the
 *    evaluation scope, so a bare `sin(90)` honors the selected angle mode
 *    without rewriting the user's expression.
 *  - `Ans` (last result) and `M` (memory) are always-defined scope symbols.
 */
import { evaluate } from "mathjs/number";

export type AngleMode = "deg" | "rad";

const DEG_PER_RAD = Math.PI / 180;

/** Trig overrides so `sin(90)` etc. read as degrees when the toggle is on. */
function degreeScope(): Record<string, (x: number) => number> {
  return {
    sin: (x) => Math.sin(x * DEG_PER_RAD),
    cos: (x) => Math.cos(x * DEG_PER_RAD),
    tan: (x) => Math.tan(x * DEG_PER_RAD),
    asin: (x) => Math.asin(x) / DEG_PER_RAD,
    acos: (x) => Math.acos(x) / DEG_PER_RAD,
    atan: (x) => Math.atan(x) / DEG_PER_RAD,
  };
}

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

  const scope: Record<string, unknown> = {
    Ans: ans,
    M: memory,
    ln: (x: number) => Math.log(x),
    ...(angleMode === "deg" ? degreeScope() : {}),
  };

  try {
    const value = evaluate(trimmed, scope) as unknown;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: "Not a finite number" };
    }
    return { ok: true, value, display: formatResult(value) };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || "Invalid expression" };
  }
}
