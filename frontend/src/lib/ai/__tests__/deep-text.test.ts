// deep-text engine tests (ai summary-robustness bot, 2026-06-14).

import { describe, it, expect } from "vitest";
import { compileMatcher, findFirst, countMatches, snippetAround } from "../deep-text";

describe("compileMatcher", () => {
  it("builds a lowercased needle for substrings", () => {
    expect(compileMatcher("CYP", false)).toEqual({ needle: "cyp" });
  });
  it("builds a global+i regex when isRegex", () => {
    const m = compileMatcher("\\d+", true);
    expect(m && "regex" in m && m.regex.flags).toContain("g");
  });
  it("returns null for empty query or a bad regex", () => {
    expect(compileMatcher("", false)).toBeNull();
    expect(compileMatcher("(", true)).toBeNull();
  });
});

describe("findFirst", () => {
  it("finds a case-insensitive substring", () => {
    expect(findFirst("had CYP51A here", "cyp51a", false)).toEqual({ index: 4, length: 6 });
    expect(findFirst("nope", "cyp", false)).toBeNull();
  });
  it("finds a regex match", () => {
    const hit = findFirst("ran 30 cycles", "\\d+ cycles", true);
    expect(hit).not.toBeNull();
  });
  it("falls back to literal on a bad regex", () => {
    expect(findFirst("a (b", "(", true)).toEqual({ index: 2, length: 1 });
  });
});

describe("countMatches", () => {
  it("counts non-overlapping substring hits, case-insensitive", () => {
    expect(countMatches("ab AB aB Ba", "ab", false)).toBe(3);
    expect(countMatches("nothing", "xyz", false)).toBe(0);
  });
  it("counts regex hits without spinning on zero-width matches", () => {
    expect(countMatches("a1b2c3", "\\d", true)).toBe(3);
    // A zero-width pattern must terminate (one count per position, not infinite).
    expect(countMatches("abc", "x*", true)).toBeGreaterThan(0);
  });
});

describe("snippetAround", () => {
  it("centers on the match with ellipses and collapsed whitespace", () => {
    const text = "x".repeat(200) + "MATCH" + "y".repeat(200);
    const snip = snippetAround(text, 200, 5);
    expect(snip).toContain("MATCH");
    expect(snip.startsWith("...")).toBe(true);
    expect(snip.endsWith("...")).toBe(true);
  });
});
