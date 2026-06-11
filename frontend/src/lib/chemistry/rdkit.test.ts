import { describe, expect, it } from "vitest";

import { formulaFromInchi } from "./rdkit";

// The wasm-backed identity + render paths are validated live (stack spike +
// mockup). This pins the one pure helper: parsing the Hill formula out of an
// InChI, since RDKit MinimalLib's descriptors do not include the formula.

describe("formulaFromInchi", () => {
  it("extracts the formula layer from a standard InChI", () => {
    expect(
      formulaFromInchi("InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12"),
    ).toBe("C9H8O4");
  });

  it("handles a multi-component formula layer", () => {
    expect(formulaFromInchi("InChI=1S/C2H6O.C9H8O4/c...")).toBe("C2H6O.C9H8O4");
  });

  it("returns empty for a malformed or empty InChI", () => {
    expect(formulaFromInchi("")).toBe("");
    expect(formulaFromInchi("not-an-inchi")).toBe("");
  });
});
