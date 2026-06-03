import { describe, expect, it } from "vitest";

import { evaluateExpression, formatResult } from "./scientific";

/**
 * The scientific calculator's math layer (mathjs wrapper). Pins the contract
 * the UI relies on: arithmetic precedence, the scientific function set, the
 * degrees/radians toggle, ln vs log10, Ans/memory symbols, clean formatting,
 * and graceful failure on incomplete/invalid input.
 */

function val(expr: string, opts?: Parameters<typeof evaluateExpression>[1]): number {
  const r = evaluateExpression(expr, opts);
  if (!r.ok) throw new Error(`expected ok for "${expr}", got error: ${r.error}`);
  return r.value;
}

describe("evaluateExpression — arithmetic + functions", () => {
  it("respects operator precedence and parentheses", () => {
    expect(val("2 + 3 * 4")).toBe(14);
    expect(val("(2 + 3) * 4")).toBe(20);
  });

  it("powers, roots, factorial", () => {
    expect(val("2^10")).toBe(1024);
    expect(val("sqrt(3^2 + 4^2)")).toBe(5);
    expect(val("cbrt(27)")).toBeCloseTo(3, 9);
    expect(val("5!")).toBe(120);
  });

  it("ln is natural log, log10 is base-10", () => {
    expect(val("ln(e)")).toBeCloseTo(1, 9);
    expect(val("log10(1000)")).toBeCloseTo(3, 9);
  });

  it("constants pi and e", () => {
    expect(val("pi")).toBeCloseTo(Math.PI, 9);
    expect(val("e")).toBeCloseTo(Math.E, 9);
  });
});

describe("evaluateExpression — angle mode", () => {
  it("radians by default: sin(pi/2) = 1", () => {
    expect(val("sin(pi/2)")).toBeCloseTo(1, 9);
  });

  it("degrees mode: sin(90) = 1, cos(180) = -1", () => {
    expect(val("sin(90)", { angleMode: "deg" })).toBeCloseTo(1, 9);
    expect(val("cos(180)", { angleMode: "deg" })).toBeCloseTo(-1, 9);
  });

  it("inverse trig honors the mode (asin(1) = 90 deg)", () => {
    expect(val("asin(1)", { angleMode: "deg" })).toBeCloseTo(90, 9);
    expect(val("atan(1)", { angleMode: "rad" })).toBeCloseTo(Math.PI / 4, 9);
  });

  it("same expression differs between deg and rad", () => {
    expect(val("sin(1)", { angleMode: "deg" })).not.toBeCloseTo(
      val("sin(1)", { angleMode: "rad" }),
      3,
    );
  });
});

describe("evaluateExpression — Ans / memory", () => {
  it("Ans references the last answer", () => {
    expect(val("2 + Ans", { ans: 10 })).toBe(12);
  });
  it("M references memory", () => {
    expect(val("M * 2", { memory: 5 })).toBe(10);
  });
  it("Ans and M default to 0", () => {
    expect(val("Ans + M")).toBe(0);
  });
});

describe("evaluateExpression — formatting + guards", () => {
  it("trims binary float noise", () => {
    expect(evaluateExpression("0.1 + 0.2")).toMatchObject({ ok: true, display: "0.3" });
    expect(formatResult(0.1 + 0.2)).toBe("0.3");
  });

  it("keeps exact integers verbatim", () => {
    expect(formatResult(120)).toBe("120");
    expect(formatResult(1024)).toBe("1024");
  });

  it("empty expression is a silent (message-less) failure", () => {
    const r = evaluateExpression("   ");
    expect(r).toEqual({ ok: false, error: "" });
  });

  it("incomplete / invalid expressions fail with a message, not a throw", () => {
    expect(evaluateExpression("2 +").ok).toBe(false);
    expect(evaluateExpression("sin(").ok).toBe(false);
    const bad = evaluateExpression("2 +");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.length).toBeGreaterThan(0);
  });

  it("non-finite results fail rather than printing Infinity/NaN as a value", () => {
    expect(evaluateExpression("1/0").ok).toBe(false);
  });
});
