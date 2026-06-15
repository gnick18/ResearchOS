import { describe, it, expect } from "vitest";
import {
  validateReformat,
  extractNumerics,
  extractWords,
  DEFAULT_COVERAGE_FLOOR,
} from "../reformat-validate";

// A realistic messy free-form method body (what a researcher actually writes).
const MESSY_SOURCE = `Mini-prep protocol
Resuspend the pellet in 250 uL of buffer P1 and vortex. Add 250 uL P2, invert 6 times, incubate 5 min at room temperature. Neutralize with 350 uL N3 and spin at 13000 rpm for 10 min. Wash with 500 uL PE, elute in 30 uL water.`;

// A faithful structural reformat of the same body: numbered steps, a phase
// heading, every number/reagent verbatim, no new values.
const FAITHFUL_REFORMAT = `## Mini-prep protocol

1. Resuspend the pellet in 250 uL of buffer P1 and vortex.
2. Add 250 uL P2, invert 6 times, incubate 5 min at room temperature.
3. Neutralize with 350 uL N3 and spin at 13000 rpm for 10 min.
4. Wash with 500 uL PE, elute in 30 uL water.`;

describe("extractNumerics", () => {
  it("pulls distinct decimal and integer values", () => {
    const n = extractNumerics("Heat 1.5 mL at 37 C for 10 min, repeat 10 times.");
    expect(n.has("1.5")).toBe(true);
    expect(n.has("37")).toBe(true);
    expect(n.has("10")).toBe(true); // distinct, the two 10s collapse
    expect(n.size).toBe(3);
  });

  it("does NOT count an ordered-list index as a value", () => {
    // "1." and "2." are list scaffolding; only the real "5" should survive.
    const n = extractNumerics("1. Add buffer\n2. Mix for 5 min");
    expect(n.has("5")).toBe(true);
    expect(n.has("1")).toBe(false);
    expect(n.has("2")).toBe(false);
  });

  it("keeps a real decimal that looks like it follows a list marker", () => {
    // "1.5" must not be shredded into the list-index "1." path.
    const n = extractNumerics("Add 1.5 mL");
    expect(n.has("1.5")).toBe(true);
  });

  it("splits scientific notation into component numbers (multiply sign safe)", () => {
    const a = extractNumerics("Seed at 5*10^6 cells");
    const b = extractNumerics("Seed at 5 x 10^6 cells");
    expect([...a].sort()).toEqual(["10", "5", "6"]);
    // unicode/ascii multiply tokenize the same, so a faithful copy validates
    expect([...b].sort()).toEqual(["10", "5", "6"]);
  });
});

describe("extractWords", () => {
  it("captures hyphenated reagent names and drops markdown emphasis", () => {
    const w = extractWords("Add **Tris-HCl** and _EDTA_");
    expect(w.has("tris-hcl")).toBe(true);
    expect(w.has("edta")).toBe(true);
  });
});

describe("validateReformat", () => {
  it("passes a faithful structural reformat", () => {
    const r = validateReformat(MESSY_SOURCE, FAITHFUL_REFORMAT);
    expect(r.ok).toBe(true);
    expect(r.inventedNumerics).toEqual([]);
    expect(r.inventedWords).toEqual([]);
    expect(r.coverage).toBe(1);
  });

  it("REJECTS a changed quantity (the core safety case)", () => {
    const tampered = FAITHFUL_REFORMAT.replace("350 uL N3", "850 uL N3");
    const r = validateReformat(MESSY_SOURCE, tampered);
    expect(r.ok).toBe(false);
    expect(r.inventedNumerics).toContain("850");
  });

  it("REJECTS an invented reagent name", () => {
    const tampered = FAITHFUL_REFORMAT.replace(
      "elute in 30 uL water",
      "elute in 30 uL chloroform",
    );
    const r = validateReformat(MESSY_SOURCE, tampered);
    expect(r.ok).toBe(false);
    expect(r.inventedWords).toContain("chloroform");
  });

  it("REJECTS a merged value the source never stated", () => {
    // Model collapses "250 + 250" into "500" uL P1/P2 -> 500 IS in source (PE
    // wash) but the structural duplication is fine; the dangerous case is a value
    // with no source at all. Use a genuinely novel sum.
    const tampered = FAITHFUL_REFORMAT.replace(
      "Add 250 uL P2",
      "Add 1250 uL P2",
    );
    const r = validateReformat(MESSY_SOURCE, tampered);
    expect(r.ok).toBe(false);
    expect(r.inventedNumerics).toContain("1250");
  });

  it("allows structural scaffolding words (Step, Materials) not in the source", () => {
    const reformat = `## Materials

- 250 uL P1
- 250 uL P2

## Step 1

Resuspend the pellet in 250 uL of buffer P1 and vortex.`;
    const r = validateReformat(MESSY_SOURCE, reformat);
    // "materials" and "step" are allowlisted; everything else is from source.
    expect(r.inventedWords).toEqual([]);
    // coverage may dip (this excerpt omits later steps) so check the word gate
    // independently of the coverage gate.
    expect(r.inventedWords.length).toBe(0);
  });

  it("REJECTS a reformat that silently drops most steps (coverage floor)", () => {
    const stub = `## Mini-prep protocol\n\n1. Resuspend the pellet in 250 uL of buffer P1 and vortex.`;
    const r = validateReformat(MESSY_SOURCE, stub);
    expect(r.coverageShort).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.coverage).toBeLessThan(DEFAULT_COVERAGE_FLOOR);
  });

  it("does not add ordered-list indices as invented numbers", () => {
    // The reformat introduces "1." "2." "3." "4." that the prose source lacks;
    // these must NOT be flagged as invented values.
    const r = validateReformat(MESSY_SOURCE, FAITHFUL_REFORMAT);
    expect(r.inventedNumerics).toEqual([]);
  });

  it("treats a source with no numbers as fully covered", () => {
    // Faithful reformat uses only source words (no invented heading label).
    const r = validateReformat(
      "Mix gently and observe under the scope.",
      "1. Mix gently and observe under the scope.",
    );
    expect(r.coverage).toBe(1);
    expect(r.ok).toBe(true);
  });

  it("flags an invented heading/label word the source never used", () => {
    // The model must title from the source's own words; a generic invented
    // label like "Protocol" (not in source, not structural) is rejected.
    const r = validateReformat(
      "Mix gently and observe under the scope.",
      "## Protocol\n\n1. Mix gently and observe under the scope.",
    );
    expect(r.ok).toBe(false);
    expect(r.inventedWords).toContain("protocol");
  });
});
