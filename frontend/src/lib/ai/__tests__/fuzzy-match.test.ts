// fuzzy-match tests (ai summary-robustness bot, 2026-06-14).

import { describe, it, expect } from "vitest";
import { normalizeForMatch, editDistance, distanceBudget, fuzzyResolve } from "../fuzzy-match";

describe("normalizeForMatch", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeForMatch("  Kritika   Nguyen ")).toBe("kritika nguyen");
  });
});

describe("editDistance", () => {
  it("is 0 for equal strings", () => {
    expect(editDistance("abc", "abc")).toBe(0);
  });
  it("counts single edits", () => {
    expect(editDistance("kritka", "kritika")).toBe(1); // one insertion
    expect(editDistance("cat", "bat")).toBe(1); // one substitution
    expect(editDistance("", "abc")).toBe(3);
  });
  it("scores an adjacent transposition as one edit", () => {
    expect(editDistance("teh", "the")).toBe(1);
    expect(editDistance("grnat", "grant")).toBe(1);
  });
});

describe("distanceBudget", () => {
  it("scales ~30%, floor 1, cap 3", () => {
    expect(distanceBudget(3)).toBe(1);
    expect(distanceBudget(6)).toBe(1);
    expect(distanceBudget(7)).toBe(2);
    expect(distanceBudget(100)).toBe(3);
  });
});

describe("fuzzyResolve", () => {
  const members = ["kritika", "grant", "alex chen"];

  it("returns null for empty input or no match", () => {
    expect(fuzzyResolve("", members)).toBeNull();
    expect(fuzzyResolve("zzzzzz", members)).toBeNull();
  });

  it("tier 1: exact normalized match (case-insensitive)", () => {
    expect(fuzzyResolve("Kritika", members)).toBe("kritika");
    expect(fuzzyResolve("  GRANT ", members)).toBe("grant");
  });

  it("tier 2: first-name / token containment", () => {
    expect(fuzzyResolve("alex", members)).toBe("alex chen");
    expect(fuzzyResolve("chen", members)).toBe("alex chen");
  });

  it("tier 2: prefix containment, shortest key wins", () => {
    expect(fuzzyResolve("cyp51", ["cyp51A knockout", "cyp51A knockout v2"])).toBe("cyp51A knockout");
  });

  it("tier 3: small typo resolves via edit distance", () => {
    expect(fuzzyResolve("kritka", members)).toBe("kritika");
    expect(fuzzyResolve("grnat", members)).toBe("grant");
  });

  it("tier 3: typo in one word of a multi-word name still resolves", () => {
    expect(fuzzyResolve("alax", members)).toBe("alex chen");
  });

  it("exact beats fuzzy when both are present", () => {
    expect(fuzzyResolve("grant", ["grnat", "grant"])).toBe("grant");
  });

  it("respects a tighter maxDistance override (0 = exact only)", () => {
    // "kritka" is one edit from "kritika"; a budget of 0 rejects any non-exact hit.
    expect(fuzzyResolve("kritka", ["kritika"], { maxDistance: 0 })).toBeNull();
  });
});
