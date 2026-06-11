import { describe, it, expect } from "vitest";
import {
  deriveInputKey,
  insertIntoFormula,
  buildDraftPartsFromWizard,
  emptyWizardState,
  FORMULA_HELPER_CHIPS,
} from "./builder-helpers";
import { evaluateCustomCalculator } from "./custom";

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

describe("buildDraftPartsFromWizard", () => {
  it("assembles a valid, evaluable draft from a finished wizard state", () => {
    const state = {
      ...emptyWizardState(),
      name: "CFU per mL",
      field: "Microbiology",
      measurements: [
        { label: "Colonies counted", key: "colonies" },
        { label: "Dilution plated", key: "dilution" },
        { label: "Volume plated", key: "platedVol", unit: "mL" },
      ],
      formula: "colonies / (dilution * platedVol)",
      answerLabel: "CFU per mL",
      answerUnit: "CFU/mL",
      warnings: [{ condition: "colonies < 30", message: "Count is too low" }],
      steps: [],
    };
    const parts = buildDraftPartsFromWizard(state);

    expect(parts.name).toBe("CFU per mL");
    expect(parts.field).toBe("Microbiology");
    expect(parts.inputs).toHaveLength(3);
    expect(parts.inputs[2]).toMatchObject({ key: "platedVol", unit: "mL" });
    expect(parts.outputs).toHaveLength(1);
    expect(parts.outputs[0]).toMatchObject({
      label: "CFU per mL",
      expr: "colonies / (dilution * platedVol)",
      unit: "CFU/mL",
    });
    // A warning becomes an if(...) conditional.
    expect(parts.conditionals).toHaveLength(1);
    expect(parts.conditionals[0].expr).toContain("if(colonies < 30");

    // The assembled spec actually evaluates through the real engine.
    const calc = {
      id: 0,
      description: "",
      shared_with: [],
      created_at: "",
      updated_at: "",
      ...parts,
    };
    const result = evaluateCustomCalculator(calc, {
      colonies: 150,
      dilution: 1e-5,
      platedVol: 0.1,
    });
    expect(result.outputs[0].value).toBeCloseTo(1.5e8, -3);
  });

  it("drops empty measurements, warnings and steps", () => {
    const state = {
      ...emptyWizardState(),
      name: "Trivial",
      measurements: [
        { label: "x", key: "x" },
        { label: "", key: "" },
      ],
      formula: "x * 2",
      warnings: [
        { condition: "x < 1", message: "" },
        { condition: "", message: "low" },
      ],
      steps: [{ key: "", expr: "" }],
    };
    const parts = buildDraftPartsFromWizard(state);
    expect(parts.inputs).toHaveLength(1);
    expect(parts.conditionals).toHaveLength(0);
    expect(parts.steps).toHaveLength(0);
  });

  it("falls back to the calculator name when no answer label is given", () => {
    const state = {
      ...emptyWizardState(),
      name: "My calc",
      measurements: [{ label: "a", key: "a" }],
      formula: "a",
      answerLabel: "",
    };
    const parts = buildDraftPartsFromWizard(state);
    expect(parts.outputs[0].label).toBe("My calc");
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
