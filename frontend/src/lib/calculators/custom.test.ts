/**
 * Unit tests for the Custom Calculator Builder engine (`custom.ts`).
 *
 * Covers the registered list helpers (mean, sum, count, sd, min, max, shannon,
 * simpson, geomean, sumproduct, linfit_slope/intercept), the if/comparison/
 * and-or operators, dropdown enum-string equality, step chaining, conditional
 * guidance collection, default fallbacks, and graceful failure (a bad formula
 * yields NaN + "—", never a throw). The 10 shipped templates are pinned to
 * hand-computed oracle values in custom.golden.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateCustomCalculator,
  formatCalcValue,
  type CustomCalcInputValues,
} from "./custom";
import type { CustomCalculator } from "@/lib/types";

/** Build a minimal valid calculator for a single output expression over the
 *  given inputs, so a test can probe one helper at a time. */
function calcOf(
  inputs: CustomCalculator["inputs"],
  outExpr: string,
  steps: CustomCalculator["steps"] = [],
): CustomCalculator {
  return {
    id: 1,
    name: "t",
    description: "",
    inputs,
    steps,
    conditionals: [],
    outputs: [{ label: "out", expr: outExpr }],
    shared_with: [],
    created_at: "2026-06-10T00:00:00.000Z",
    updated_at: "2026-06-10T00:00:00.000Z",
  };
}

function run(calc: CustomCalculator, values: CustomCalcInputValues) {
  return evaluateCustomCalculator(calc, values);
}

const rep = (key: string): CustomCalculator["inputs"] => [
  { key, type: "replicate", label: key },
];

const REL_TOL = 1e-12;
function near(actual: number, expected: number) {
  const denom = expected === 0 ? 1 : Math.abs(expected);
  expect(Math.abs(actual - expected) / denom).toBeLessThan(REL_TOL);
}

describe("list helpers", () => {
  it("mean / sum / count over a replicate array", () => {
    const r = run(calcOf(rep("xs"), "mean(xs)"), { xs: [2, 4, 6] });
    near(r.outputs[0].value, 4);
    near(run(calcOf(rep("xs"), "sum(xs)"), { xs: [2, 4, 6] }).outputs[0].value, 12);
    near(run(calcOf(rep("xs"), "count(xs)"), { xs: [2, 4, 6] }).outputs[0].value, 3);
  });

  it("sd is the SAMPLE standard deviation (n-1)", () => {
    // [2,4,4,4,5,5,7,9] has sample sd = sqrt(32/7) = 2.138089935...
    const r = run(calcOf(rep("xs"), "sd(xs)"), { xs: [2, 4, 4, 4, 5, 5, 7, 9] });
    near(r.outputs[0].value, Math.sqrt(32 / 7));
  });

  it("min / max over a list", () => {
    near(run(calcOf(rep("xs"), "min(xs)"), { xs: [3, 1, 2] }).outputs[0].value, 1);
    near(run(calcOf(rep("xs"), "max(xs)"), { xs: [3, 1, 2] }).outputs[0].value, 3);
  });

  it("shannon entropy of [40,30,20,10]", () => {
    // -Sum p ln p, p = {0.4,0.3,0.2,0.1}
    const total = 100;
    const expected = -[40, 30, 20, 10].reduce((h, n) => {
      const p = n / total;
      return h + p * Math.log(p);
    }, 0);
    near(run(calcOf(rep("xs"), "shannon(xs)"), { xs: [40, 30, 20, 10] }).outputs[0].value, expected);
  });

  it("simpson Gini-Simpson diversity 1 - Sum p^2", () => {
    // [50,50] -> 1 - (0.25+0.25) = 0.5
    near(run(calcOf(rep("xs"), "simpson(xs)"), { xs: [50, 50] }).outputs[0].value, 0.5);
  });

  it("geomean = exp(mean ln x)", () => {
    // geomean([1,10,100]) = 10
    near(run(calcOf(rep("xs"), "geomean(xs)"), { xs: [1, 10, 100] }).outputs[0].value, 10);
  });

  it("sumproduct of two equal-length lists", () => {
    const calc = calcOf(
      [
        { key: "a", type: "replicate", label: "a" },
        { key: "b", type: "replicate", label: "b" },
      ],
      "sumproduct(a, b)",
    );
    // 1*4 + 2*5 + 3*6 = 32
    near(run(calc, { a: [1, 2, 3], b: [4, 5, 6] }).outputs[0].value, 32);
  });

  it("linfit_slope / linfit_intercept (OLS of ys on xs)", () => {
    const inputs: CustomCalculator["inputs"] = [
      { key: "x", type: "replicate", label: "x" },
      { key: "y", type: "replicate", label: "y" },
    ];
    // y = 2x + 1 exactly -> slope 2, intercept 1
    const xs = [1, 2, 3, 4];
    const ys = [3, 5, 7, 9];
    near(run(calcOf(inputs, "linfit_slope(x, y)"), { x: xs, y: ys }).outputs[0].value, 2);
    near(run(calcOf(inputs, "linfit_intercept(x, y)"), { x: xs, y: ys }).outputs[0].value, 1);
  });
});

describe("operators and constants", () => {
  it("supports ^, ln, sqrt, pi, e", () => {
    const inputs: CustomCalculator["inputs"] = [{ key: "x", type: "number", label: "x" }];
    near(run(calcOf(inputs, "x^3"), { x: 2 }).outputs[0].value, 8);
    near(run(calcOf(inputs, "ln(x)"), { x: Math.E }).outputs[0].value, 1);
    near(run(calcOf(inputs, "sqrt(x)"), { x: 9 }).outputs[0].value, 3);
    near(run(calcOf([], "pi"), {}).outputs[0].value, Math.PI);
    near(run(calcOf([], "e"), {}).outputs[0].value, Math.E);
  });

  it("if ternary with comparison and and/or", () => {
    const inputs: CustomCalculator["inputs"] = [
      { key: "a", type: "number", label: "a" },
      { key: "b", type: "number", label: "b" },
    ];
    near(run(calcOf(inputs, "if(a < b, 10, 20)"), { a: 1, b: 2 }).outputs[0].value, 10);
    near(run(calcOf(inputs, "if(a > 1 and b < 3, 1, 0)"), { a: 2, b: 2 }).outputs[0].value, 1);
    near(run(calcOf(inputs, "if(a > 1 or b > 3, 1, 0)"), { a: 0, b: 2 }).outputs[0].value, 0);
  });

  it("dropdown enum-string equality branches", () => {
    const calc: CustomCalculator = {
      ...calcOf(
        [
          { key: "mode", type: "dropdown", label: "mode", options: [{ label: "RPM", value: "rpm" }, { label: "g", value: "g" }] },
          { key: "v", type: "number", label: "v" },
        ],
        "if(mode == \"rpm\", v*2, v*3)",
      ),
    };
    near(run(calc, { mode: "rpm", v: 5 }).outputs[0].value, 10);
    near(run(calc, { mode: "g", v: 5 }).outputs[0].value, 15);
  });
});

describe("steps, conditionals, defaults, failure", () => {
  it("chains steps so a later step sees an earlier one", () => {
    const calc = calcOf(
      [{ key: "x", type: "number", label: "x" }],
      "b",
      [
        { key: "a", expr: "x*2" },
        { key: "b", expr: "a+1" },
      ],
    );
    near(run(calc, { x: 3 }).outputs[0].value, 7);
  });

  it("collects non-empty conditional strings as guidance, drops empties", () => {
    const calc: CustomCalculator = {
      ...calcOf([{ key: "v", type: "number", label: "v" }], "v"),
      conditionals: [
        { expr: "if(v < 80, \"warn low\", \"\")" },
        { expr: "if(v > 200, \"warn high\", \"\")" },
      ],
    };
    expect(run(calc, { v: 50 }).messages).toEqual(["warn low"]);
    expect(run(calc, { v: 100 }).messages).toEqual([]);
  });

  it("applies a number/replicate/dropdown default when the value is missing", () => {
    const calc = calcOf(
      [{ key: "d", type: "number", label: "d", default: 2 }],
      "d*10",
    );
    near(run(calc, {}).outputs[0].value, 20);

    const repCalc = calcOf(
      [{ key: "xs", type: "replicate", label: "xs", default: [2, 4] }],
      "mean(xs)",
    );
    near(run(repCalc, {}).outputs[0].value, 3);

    const dd = calcOf(
      [{ key: "o", type: "dropdown", label: "o", options: [{ label: "A", value: 7 }, { label: "B", value: 9 }] }],
      "o",
    );
    near(run(dd, {}).outputs[0].value, 7); // first option
  });

  it("a bad formula yields NaN + dash display, never throws", () => {
    const calc = calcOf([{ key: "x", type: "number", label: "x" }], "x +* )(");
    const r = run(calc, { x: 1 });
    expect(Number.isNaN(r.outputs[0].value)).toBe(true);
    expect(r.outputs[0].display).toBe("—");
  });
});

describe("formatCalcValue", () => {
  it("renders integers verbatim, trims float noise, dashes non-finite", () => {
    expect(formatCalcValue(19000000)).toBe("19000000");
    expect(formatCalcValue(0.1 + 0.2)).toBe("0.3");
    expect(formatCalcValue(NaN)).toBe("—");
    expect(formatCalcValue(0)).toBe("0");
  });
});
