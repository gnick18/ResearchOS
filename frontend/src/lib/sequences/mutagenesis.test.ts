// SDM primer bot — site-directed mutagenesis primer-design tests.
// Covers: point substitution centers the mismatch with matching flanks + Tm in
// range; insertion primer carries the inserted bases; deletion primer joins the
// flanks across the removed range; reported mismatch positions match the change.

import { describe, it, expect } from "vitest";
import { designMutagenicPrimer } from "./mutagenesis";
import { reverseComplement } from "./primer";

// A 60 bp template with a known center so we can target a middle base and get
// full-length arms on both sides. Position 30 (0-based) is the 'A' below.
//                         0         1         2         3         4         5
//                         0123456789012345678901234567890123456789012345678901234567890
const TEMPLATE =
  "GGCCATGCATGCATGCATGCATGCATGCATAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGC";

describe("designMutagenicPrimer — point substitution", () => {
  it("centers the single mismatch with matching homology arms", () => {
    const pos = 30;
    const original = TEMPLATE[pos];
    const newBase = original === "A" ? "G" : "A";
    const r = designMutagenicPrimer(TEMPLATE, {
      type: "substitution",
      position: pos,
      newBases: newBase,
    });

    // One edited column, carrying the new base over the original template base.
    const editedCols = r.columns.filter((c) => c.edited);
    expect(editedCols).toHaveLength(1);
    expect(editedCols[0].primer).toBe(newBase);
    expect(editedCols[0].template).toBe(original);
    expect(editedCols[0].match).toBe(false);

    // Arms are matching homology on each side, at least the default min (12).
    expect(r.leftArm).toBeGreaterThanOrEqual(12);
    expect(r.rightArm).toBeGreaterThanOrEqual(12);
    // The arm columns are all matches.
    const armCols = r.columns.filter((c) => !c.edited);
    expect(armCols.every((c) => c.match)).toBe(true);

    // The edit sits between the arms (centered-ish): there are exactly leftArm
    // matching columns before the single edited column.
    const firstEditedIdx = r.columns.findIndex((c) => c.edited);
    expect(firstEditedIdx).toBe(r.leftArm);

    // The primer is leftArm + 1 (edit) + rightArm bases long.
    expect(r.length).toBe(r.leftArm + 1 + r.rightArm);

    // The primer's sequence equals template arms with the new base swapped in.
    const expected =
      TEMPLATE.slice(pos - r.leftArm, pos) + newBase + TEMPLATE.slice(pos + 1, pos + 1 + r.rightArm);
    expect(r.primer).toBe(expected);

    // Tm reaches the default ~60 C target (template is long enough here).
    expect(r.tm).toBeGreaterThanOrEqual(59);
    expect(r.tm).toBeLessThan(90);

    // The reported template-side mismatch position is the substituted base.
    expect(r.mismatchTemplatePositions).toEqual([pos]);

    // The persisted footprint covers both arms around the edit.
    expect(r.templateStart).toBe(pos - r.leftArm);
    expect(r.templateEnd).toBe(pos + 1 + r.rightArm);
  });

  it("supports a multi-base substitution (swap 1 base for 3)", () => {
    const pos = 30;
    const r = designMutagenicPrimer(TEMPLATE, {
      type: "substitution",
      position: pos,
      newBases: "TTT",
      replaceLength: 1,
    });
    const editedCols = r.columns.filter((c) => c.edited);
    // 3 new bases over 1 replaced base => 3 columns, the last two have "-" template.
    expect(editedCols.map((c) => c.primer).join("")).toBe("TTT");
    expect(editedCols[0].template).toBe(TEMPLATE[pos]);
    expect(editedCols[1].template).toBe("-");
    // Only the one replaced template base is a mismatch position.
    expect(r.mismatchTemplatePositions).toEqual([pos]);
    // Primer = leftArm + "TTT" + rightArm.
    expect(r.primer).toBe(
      TEMPLATE.slice(pos - r.leftArm, pos) + "TTT" + TEMPLATE.slice(pos + 1, pos + 1 + r.rightArm),
    );
  });
});

describe("designMutagenicPrimer — insertion", () => {
  it("carries the inserted bases with no template partner", () => {
    const pos = 30;
    const insert = "GAATTC"; // an EcoRI site, say
    const r = designMutagenicPrimer(TEMPLATE, {
      type: "insertion",
      position: pos,
      newBases: insert,
    });

    // The inserted bases are present as edited columns with "-" template.
    const editedCols = r.columns.filter((c) => c.edited);
    expect(editedCols.map((c) => c.primer).join("")).toBe(insert);
    expect(editedCols.every((c) => c.template === "-" && !c.match)).toBe(true);

    // The primer literally contains the insert between the arms.
    expect(r.primer).toBe(
      TEMPLATE.slice(pos - r.leftArm, pos) + insert + TEMPLATE.slice(pos, pos + r.rightArm),
    );
    expect(r.mutationPrimerStart).toBe(r.leftArm);
    expect(r.mutationPrimerEnd).toBe(r.leftArm + insert.length);

    // A pure insertion changes no existing template base.
    expect(r.mismatchTemplatePositions).toEqual([]);

    // Footprint = the two arms (no template base removed): coreStart === coreEnd.
    expect(r.templateStart).toBe(pos - r.leftArm);
    expect(r.templateEnd).toBe(pos + r.rightArm);
  });
});

describe("designMutagenicPrimer — deletion", () => {
  it("joins the flanks directly across the removed range", () => {
    const pos = 28;
    const delLen = 4;
    const r = designMutagenicPrimer(TEMPLATE, {
      type: "deletion",
      position: pos,
      length: delLen,
    });

    // No edited primer columns (the deleted bases are simply absent).
    expect(r.columns.filter((c) => c.edited)).toHaveLength(0);
    expect(r.mutationPrimerStart).toBe(r.mutationPrimerEnd); // empty range = join point
    expect(r.mutationPrimerStart).toBe(r.leftArm);

    // The primer is the left arm joined straight to the right arm (deleted bases
    // gone), so it equals template[start..pos) + template[pos+delLen..end).
    const expected =
      TEMPLATE.slice(pos - r.leftArm, pos) + TEMPLATE.slice(pos + delLen, pos + delLen + r.rightArm);
    expect(r.primer).toBe(expected);
    expect(r.length).toBe(r.leftArm + r.rightArm);

    // The deleted template bases are reported as the change positions.
    expect(r.mismatchTemplatePositions).toEqual([pos, pos + 1, pos + 2, pos + 3]);

    // Footprint straddles the removed range (both arms + the gap).
    expect(r.templateStart).toBe(pos - r.leftArm);
    expect(r.templateEnd).toBe(pos + delLen + r.rightArm);

    // Every primer column is a homology-arm match (no mismatch in a clean del).
    expect(r.columns.every((c) => c.match)).toBe(true);
  });
});

describe("designMutagenicPrimer — flank growth + edges", () => {
  it("respects the template edges when the edit is near the start", () => {
    const r = designMutagenicPrimer(TEMPLATE, {
      type: "substitution",
      position: 3,
      newBases: "A",
    });
    // Only 3 bases of template exist 5' of position 3, so the left arm cannot
    // exceed 3 even though the default min is 12.
    expect(r.leftArm).toBe(3);
    expect(r.rightArm).toBeGreaterThan(0);
  });

  it("grows arms past the minimum to reach the Tm target when AT-rich", () => {
    // An AT-rich template needs longer arms to hit 60 C, so at least one arm
    // should exceed the default minimum of 12.
    const atTemplate = "AAATTTAAATTTAAATTTAAATTTAAATTTAAATTTAAATTTAAATTTAAATTT";
    const r = designMutagenicPrimer(atTemplate, {
      type: "substitution",
      position: 26,
      newBases: "G",
    });
    expect(Math.max(r.leftArm, r.rightArm)).toBeGreaterThanOrEqual(12);
    // Tm should be pushed toward the target (or capped by available template).
    expect(r.tm).toBeGreaterThan(40);
  });

  it("is deterministic", () => {
    const spec = { type: "substitution" as const, position: 30, newBases: "C" };
    const a = designMutagenicPrimer(TEMPLATE, spec);
    const b = designMutagenicPrimer(TEMPLATE, spec);
    expect(a.primer).toBe(b.primer);
    expect(a.tm).toBe(b.tm);
  });

  it("throws on an empty edit", () => {
    expect(() =>
      designMutagenicPrimer(TEMPLATE, { type: "substitution", position: 10, newBases: "" }),
    ).toThrow();
    expect(() =>
      designMutagenicPrimer(TEMPLATE, { type: "deletion", position: 10, length: 0 }),
    ).toThrow();
  });
});

describe("designMutagenicPrimer — sanity vs reverseComplement", () => {
  it("a substitution primer's arms still match the template top strand", () => {
    const pos = 30;
    const r = designMutagenicPrimer(TEMPLATE, {
      type: "substitution",
      position: pos,
      newBases: "T",
    });
    const leftArmSeq = r.primer.slice(0, r.leftArm);
    expect(leftArmSeq).toBe(TEMPLATE.slice(pos - r.leftArm, pos));
    // revcomp round-trips (guards the import being used + a quick sanity check).
    expect(reverseComplement(reverseComplement(r.primer))).toBe(r.primer);
  });
});
