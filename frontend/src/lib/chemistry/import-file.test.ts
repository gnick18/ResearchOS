import { describe, expect, it } from "vitest";

import { parseStructureFile } from "./import-file";

const MOL = `benzene
  app

  6  6  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0
M  END
`;

describe("parseStructureFile", () => {
  it("parses a single .mol, taking the title line as the name", () => {
    const r = parseStructureFile("ignored.mol", MOL);
    expect(r.unsupported).toBeUndefined();
    expect(r.structures).toHaveLength(1);
    expect(r.structures[0].name).toBe("benzene");
    expect(r.structures[0].isMolblock).toBe(true);
    expect(r.structures[0].structure).toContain("M  END");
  });

  it("falls back to the filename when the .mol title is blank", () => {
    const r = parseStructureFile("aspirin.mol", `\n  app\n\nM  END\n`);
    expect(r.structures[0].name).toBe("aspirin");
  });

  it("splits a multi-record .sdf on $$$$ and numbers blank titles", () => {
    const sdf = `one\n\n\nM  END\n$$$$\n\n\n\nM  END\n$$$$\n`;
    const r = parseStructureFile("lib.sdf", sdf);
    expect(r.structures).toHaveLength(2);
    expect(r.structures[0].name).toBe("one");
    expect(r.structures[1].name).toBe("lib 2");
    expect(r.structures.every((s) => s.isMolblock)).toBe(true);
  });

  it("parses .smi lines, smiles + optional name", () => {
    const smi = `CC(=O)Oc1ccccc1C(=O)O aspirin\nCn1cnc2c1c(=O)n(C)c(=O)n2C\n`;
    const r = parseStructureFile("set.smi", smi);
    expect(r.structures).toHaveLength(2);
    expect(r.structures[0]).toMatchObject({
      name: "aspirin",
      structure: "CC(=O)Oc1ccccc1C(=O)O",
      isMolblock: false,
    });
    expect(r.structures[1].name).toBe("set 2");
  });

  it("returns a helpful message for ChemDraw files, not a silent drop", () => {
    const r = parseStructureFile("drawing.cdxml", "<xml/>");
    expect(r.structures).toHaveLength(0);
    expect(r.unsupported).toMatch(/ChemDraw/i);
  });

  it("rejects an unknown extension with guidance", () => {
    const r = parseStructureFile("data.pdb", "ATOM ...");
    expect(r.structures).toHaveLength(0);
    expect(r.unsupported).toMatch(/not a supported/i);
  });
});
