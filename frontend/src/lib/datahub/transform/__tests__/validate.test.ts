import { describe, it, expect } from "vitest";
import { recipeIssues, humanizeEngineError } from "../validate";
import type { TransformOp } from "../pipeline";

describe("recipeIssues", () => {
  const filter = (op: string, value: unknown): TransformOp =>
    ({
      kind: "filter",
      node: { type: "condition", condition: { column: "yield", op, value } },
    }) as unknown as TransformOp;

  it("flags an empty operand for a numeric comparison", () => {
    const issues = recipeIssues([filter("lt", "")]);
    expect(issues.size).toBe(1);
    expect(issues.get(0)).toMatch(/Enter a number/i);
  });

  it("flags a non-numeric operand for a numeric comparison", () => {
    expect(recipeIssues([filter("gt", "abc")]).get(0)).toMatch(/Enter a number/i);
  });

  it("accepts a finite number operand for a numeric comparison", () => {
    for (const op of ["lt", "le", "gt", "ge"]) {
      expect(recipeIssues([filter(op, 0.05)]).size).toBe(0);
    }
  });

  it("does not flag equality / contains with a text operand", () => {
    expect(recipeIssues([filter("eq", "")]).size).toBe(0);
    expect(recipeIssues([filter("contains", "abc")]).size).toBe(0);
  });

  it("does not flag is_empty, which takes no operand", () => {
    expect(recipeIssues([filter("is_empty", undefined)]).size).toBe(0);
  });

  it("walks nested and/or/not trees", () => {
    const op = {
      kind: "filter",
      node: {
        type: "and",
        children: [
          { type: "condition", condition: { column: "a", op: "gt", value: 1 } },
          {
            type: "not",
            child: { type: "condition", condition: { column: "b", op: "lt", value: "" } },
          },
        ],
      },
    } as unknown as TransformOp;
    expect(recipeIssues([op]).get(0)).toMatch(/Enter a number/i);
  });

  it("reports the offending step index in a multi-step recipe", () => {
    const issues = recipeIssues([filter("eq", "x"), filter("ge", "")]);
    expect(issues.has(0)).toBe(false);
    expect(issues.has(1)).toBe(true);
  });

  it("validates a setwhere predicate too", () => {
    const op = {
      kind: "set-where",
      column: "y",
      where: { type: "condition", condition: { column: "y", op: "lt", value: "" } },
      valueKind: "constant",
      value: 1,
    } as unknown as TransformOp;
    expect(recipeIssues([op]).size).toBe(1);
  });
});

describe("humanizeEngineError", () => {
  it("strips the trailing LINE pointer and step alias from a DuckDB conversion error", () => {
    const raw =
      "Conversion Error: Could not convert string '' to DOUBLE LINE 1: ...AST(\"Biofuel yield (g/L)\" AS DOUBLE) < '')) SELECT * FROM __step1 LIMIT 25 OF... ^";
    const out = humanizeEngineError(raw);
    expect(out).toBe("Conversion Error: Could not convert string '' to DOUBLE");
    expect(out).not.toMatch(/LINE 1/);
    expect(out).not.toMatch(/__step/);
    expect(out).not.toMatch(/\^/);
  });

  it("rewrites internal step aliases even without a LINE pointer", () => {
    expect(humanizeEngineError("Binder Error: Referenced table __step2 not found")).toBe(
      "Binder Error: Referenced table the working table not found",
    );
  });

  it("returns a fallback for an empty message", () => {
    expect(humanizeEngineError("")).toMatch(/could not run/i);
  });

  it("leaves a clean message untouched", () => {
    expect(humanizeEngineError("Out of memory")).toBe("Out of memory");
  });
});
