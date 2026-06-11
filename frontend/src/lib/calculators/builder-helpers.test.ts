import { describe, it, expect } from "vitest";
import {
  deriveInputKey,
  insertIntoFormula,
  FORMULA_HELPER_CHIPS,
} from "./builder-helpers";

describe("deriveInputKey", () => {
  it("camelCases a multi-word label", () => {
    expect(deriveInputKey("Volume plated (mL)", [])).toBe("volumePlated");
  });

  it("lower-cases a single word", () => {
    expect(deriveInputKey("Colonies", [])).toBe("colonies");
  });

  it("strips punctuation and units in parens", () => {
    expect(deriveInputKey("Dilution plated (fraction)", [])).toBe(
      "dilutionPlated",
    );
  });

  it("prefixes a leading-digit label so the key is a valid identifier", () => {
    const key = deriveInputKey("260 reading", []);
    expect(key).toBe("v260Reading");
    expect(/^[0-9]/.test(key)).toBe(false);
  });

  it("avoids a reserved engine name by appending Value", () => {
    // `count` is a registered list helper, so a bare `count` key would break.
    expect(deriveInputKey("Count", [])).toBe("countValue");
    expect(deriveInputKey("mean", [])).toBe("meanValue");
  });

  it("disambiguates a duplicate key with a number", () => {
    expect(deriveInputKey("Colonies", ["colonies"])).toBe("colonies2");
    expect(deriveInputKey("Colonies", ["colonies", "colonies2"])).toBe(
      "colonies3",
    );
  });

  it("is case-insensitive when checking duplicates", () => {
    expect(deriveInputKey("Colonies", ["Colonies"])).toBe("colonies2");
  });

  it("falls back to value for an empty / symbol-only label", () => {
    expect(deriveInputKey("", [])).toBe("value");
    expect(deriveInputKey("###", [])).toBe("value");
  });
});

describe("insertIntoFormula", () => {
  it("appends to an empty formula with no leading space", () => {
    expect(insertIntoFormula("", "colonies")).toBe("colonies");
  });

  it("adds a separating space mid-formula", () => {
    expect(insertIntoFormula("colonies /", "dilution")).toBe(
      "colonies / dilution",
    );
  });

  it("does not double-space after a trailing space", () => {
    expect(insertIntoFormula("colonies ", "dilution")).toBe(
      "colonies dilution",
    );
  });

  it("does not add a space right after an open paren", () => {
    expect(insertIntoFormula("mean(", "live")).toBe("mean(live");
  });
});

describe("FORMULA_HELPER_CHIPS", () => {
  it("offers the common engine helpers", () => {
    const inserts = FORMULA_HELPER_CHIPS.map((c) => c.insert);
    expect(inserts).toContain("mean(");
    expect(inserts).toContain("sum(");
    expect(inserts).toContain("if(");
  });
});
