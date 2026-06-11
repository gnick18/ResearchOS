import { describe, expect, it } from "vitest";

import { formulaFromInchi, lipinski, type MoleculeIdentity } from "./rdkit";

function identity(over: Partial<MoleculeIdentity>): MoleculeIdentity {
  return {
    smiles: "",
    inchikey: "",
    formula: "",
    mol_weight: null,
    exact_mass: null,
    heavy_atoms: null,
    rings: null,
    rotatable_bonds: null,
    clogp: null,
    tpsa: null,
    h_donors: null,
    h_acceptors: null,
    aromatic_rings: null,
    ...over,
  };
}

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

describe("lipinski", () => {
  it("passes a drug-like molecule with no violations", () => {
    // Aspirin-ish: MW 180, logP 1.2, 1 donor, 4 acceptors.
    const r = lipinski(
      identity({ mol_weight: 180, clogp: 1.2, h_donors: 1, h_acceptors: 4 }),
    );
    expect(r.count).toBe(0);
    expect(r.pass).toBe(true);
    expect(r.complete).toBe(true);
  });

  it("still passes with exactly one violation (classic Ro5)", () => {
    const r = lipinski(
      identity({ mol_weight: 560, clogp: 3, h_donors: 2, h_acceptors: 6 }),
    );
    expect(r.count).toBe(1);
    expect(r.pass).toBe(true);
    expect(r.violations.find((v) => v.rule.startsWith("MW"))?.ok).toBe(false);
  });

  it("fails with two or more violations", () => {
    const r = lipinski(
      identity({ mol_weight: 700, clogp: 7, h_donors: 2, h_acceptors: 6 }),
    );
    expect(r.count).toBe(2);
    expect(r.pass).toBe(false);
  });

  it("treats missing descriptors as non-violations but marks the verdict partial", () => {
    const r = lipinski(identity({ mol_weight: 180 }));
    expect(r.count).toBe(0);
    expect(r.pass).toBe(true);
    expect(r.complete).toBe(false);
  });

  it("counts the boundary values as passing (<= limits)", () => {
    const r = lipinski(
      identity({ mol_weight: 500, clogp: 5, h_donors: 5, h_acceptors: 10 }),
    );
    expect(r.count).toBe(0);
    expect(r.complete).toBe(true);
  });
});
