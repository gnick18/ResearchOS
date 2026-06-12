// Unit tests for BeakerBot chemistry coworker tools (ai chemistry-tools bot, 2026-06-11).
//
// Test strategy:
//   - Pure-logic tests (arg parsing, mapToMatch, describeAction helpers) run in
//     isolation with no I/O.
//   - Wiring tests stub all four injectable deps (searchPubChem, fetchSdf,
//     fetchCompoundByCid, computeIdentity, toMolblock, createMolecule) and assert
//     that each tool passes the right values to its deps and returns the right shape.
//   - Error paths: bad SMILES, CID not found, network failure, missing args.
//   - RDKit note: RDKit.js is browser-only (loads /rdkit/RDKit_minimal.js from the
//     public folder). It cannot load in the Node/jsdom test environment. All tests
//     use the injectable seam (chemToolsDeps.computeIdentity / toMolblock) via vi.fn
//     stubs, so no real wasm is required. This is by design and stated in the file
//     header.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  // Tools under test.
  searchPubChemTool,
  createMoleculeTool,
  importMoleculeTool,
  // Exported pure helpers.
  mapToMatch,
  molblockFromSdf,
  parseCreateMoleculeArgs,
  parseImportMoleculeArgs,
  describeCreateMolecule,
  describeImportMolecule,
  // Injectable deps (we stub them per test).
  chemToolsDeps,
  type PubChemMatch,
  type SearchPubChemResult,
  type CreateMoleculeResult,
  type ImportMoleculeResult,
} from "./chemistry-tools";

import type { PubChemCompound } from "@/lib/chemistry/pubchem";
import type { MoleculeDetail, MoleculeMeta } from "@/lib/chemistry/api";
import type { MoleculeIdentity } from "@/lib/chemistry/rdkit";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePubChemCompound(overrides: Partial<PubChemCompound> = {}): PubChemCompound {
  return {
    cid: 2519,
    name: "Caffeine",
    formula: "C8H10N4O2",
    mol_weight: 194.19,
    inchikey: "RYYVLZVUVIJVGH-UHFFFAOYSA-N",
    pngUrl: "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2519/PNG",
    xlogp: -0.1,
    h_bond_donor_count: 0,
    h_bond_acceptor_count: 6,
    tpsa: 58.4,
    ...overrides,
  };
}

function makeMoleculeIdentity(overrides: Partial<MoleculeIdentity> = {}): MoleculeIdentity {
  return {
    smiles: "Cn1cnc2c1c(=O)n(c(=O)n2C)C",
    inchikey: "RYYVLZVUVIJVGH-UHFFFAOYSA-N",
    formula: "C8H10N4O2",
    mol_weight: 194.19,
    exact_mass: 194.08,
    heavy_atoms: 14,
    rings: 2,
    rotatable_bonds: 0,
    clogp: -0.07,
    tpsa: 58.44,
    h_donors: 0,
    h_acceptors: 6,
    aromatic_rings: 1,
    ...overrides,
  };
}

function makeMoleculeMeta(overrides: Partial<MoleculeMeta> = {}): MoleculeMeta {
  return {
    id: "mol-abc-123",
    name: "Caffeine",
    project_ids: [],
    added_at: new Date().toISOString(),
    smiles: "Cn1cnc2c1c(=O)n(c(=O)n2C)C",
    inchikey: "RYYVLZVUVIJVGH-UHFFFAOYSA-N",
    formula: "C8H10N4O2",
    mol_weight: 194.19,
    source: "drawn",
    ...overrides,
  };
}

function makeMoleculeDetail(overrides: Partial<MoleculeDetail> = {}): MoleculeDetail {
  return {
    meta: makeMoleculeMeta(),
    molfile: "\n  Mrv2211 01012400002D\n\n  0  0  0  0  0  0            999 V2000\nM  END\n",
    ...overrides,
  };
}

const SAMPLE_SDF =
  "\n  -OEChem-01012400002D\n\n  0  0  0  0  0  0            999 V2000\nM  END\n$$$$\n";

const SAMPLE_MOLFILE =
  "\n  -OEChem-01012400002D\n\n  0  0  0  0  0  0            999 V2000\nM  END\n";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("mapToMatch", () => {
  it("maps a PubChemCompound to a PubChemMatch, setting canonical_smiles to empty", () => {
    const compound = makePubChemCompound();
    const match = mapToMatch(compound);
    expect(match.cid).toBe(2519);
    expect(match.name).toBe("Caffeine");
    expect(match.formula).toBe("C8H10N4O2");
    expect(match.mol_weight).toBe(194.19);
    expect(match.canonical_smiles).toBe("");
  });

  it("surfaces the physicochemical descriptors (XLogP, HBD, HBA, TPSA)", () => {
    const compound = makePubChemCompound({
      xlogp: -0.1,
      h_bond_donor_count: 0,
      h_bond_acceptor_count: 6,
      tpsa: 58.4,
    });
    const match = mapToMatch(compound);
    expect(match.xlogp).toBe(-0.1);
    expect(match.h_bond_donor_count).toBe(0);
    expect(match.h_bond_acceptor_count).toBe(6);
    expect(match.tpsa).toBe(58.4);
  });

  it("passes a missing descriptor through as null, never a throw", () => {
    const compound = makePubChemCompound({ tpsa: null });
    const match = mapToMatch(compound);
    expect(match.tpsa).toBeNull();
    // The others still surface.
    expect(match.xlogp).toBe(-0.1);
  });

  it("handles a compound with null mol_weight", () => {
    const compound = makePubChemCompound({ mol_weight: null });
    const match = mapToMatch(compound);
    expect(match.mol_weight).toBeNull();
  });
});

describe("molblockFromSdf", () => {
  it("trims an SDF to the Molfile (up to and including M  END)", () => {
    const result = molblockFromSdf(SAMPLE_SDF);
    expect(result.includes("M  END")).toBe(true);
    expect(result.includes("$$$$")).toBe(false);
  });

  it("returns the full input when M  END is absent", () => {
    const input = "some data without a terminator";
    expect(molblockFromSdf(input)).toBe(input);
  });
});

describe("parseCreateMoleculeArgs", () => {
  it("trims name and smiles", () => {
    const parsed = parseCreateMoleculeArgs({ name: "  aspirin  ", smiles: "  CC(=O)O  " });
    expect(parsed.name).toBe("aspirin");
    expect(parsed.smiles).toBe("CC(=O)O");
  });

  it("defaults name to Untitled molecule when absent", () => {
    const parsed = parseCreateMoleculeArgs({ smiles: "CCO" });
    expect(parsed.name).toBe("Untitled molecule");
  });

  it("returns empty smiles for a non-string value", () => {
    const parsed = parseCreateMoleculeArgs({ name: "test", smiles: 42 });
    expect(parsed.smiles).toBe("");
  });
});

describe("parseImportMoleculeArgs", () => {
  it("parses a numeric CID", () => {
    const parsed = parseImportMoleculeArgs({ cid: 2519 });
    expect(parsed.cid).toBe(2519);
  });

  it("parses a string CID", () => {
    const parsed = parseImportMoleculeArgs({ cid: "2519" });
    expect(parsed.cid).toBe(2519);
  });

  it("returns null for a non-numeric CID", () => {
    const parsed = parseImportMoleculeArgs({ cid: "caffeine" });
    expect(parsed.cid).toBeNull();
  });

  it("returns null for a missing CID", () => {
    const parsed = parseImportMoleculeArgs({});
    expect(parsed.cid).toBeNull();
  });

  it("returns null for a negative CID", () => {
    const parsed = parseImportMoleculeArgs({ cid: -1 });
    expect(parsed.cid).toBeNull();
  });
});

describe("describeCreateMolecule", () => {
  it("includes name and a truncated SMILES in the summary", () => {
    const { summary } = describeCreateMolecule({ name: "caffeine", smiles: "Cn1c" });
    expect(summary).toContain("caffeine");
    expect(summary).toContain("Cn1c");
  });

  it("truncates a long SMILES in the summary with ellipsis", () => {
    const longSmiles = "C".repeat(50);
    const { summary } = describeCreateMolecule({ name: "X", smiles: longSmiles });
    expect(summary).toContain("…");
  });
});

describe("describeImportMolecule", () => {
  it("includes the CID when valid", () => {
    const { summary } = describeImportMolecule({ cid: 2519 });
    expect(summary).toContain("2519");
  });

  it("returns a fallback when CID is null", () => {
    const { summary } = describeImportMolecule({ cid: null });
    expect(summary).toContain("PubChem");
  });
});

// ---------------------------------------------------------------------------
// search_pubchem tool (stubbed deps)
// ---------------------------------------------------------------------------

describe("search_pubchem tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok: true with matches on success", async () => {
    vi.spyOn(chemToolsDeps, "searchPubChem").mockResolvedValueOnce([
      makePubChemCompound(),
    ]);
    const result = (await searchPubChemTool.execute({ query: "caffeine" })) as SearchPubChemResult;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.count).toBe(1);
    expect(result.matches[0].name).toBe("Caffeine");
    expect(result.matches[0].cid).toBe(2519);
  });

  it("respects a max argument up to 8", async () => {
    const spy = vi.spyOn(chemToolsDeps, "searchPubChem").mockResolvedValueOnce([
      makePubChemCompound(),
    ]);
    await searchPubChemTool.execute({ query: "caffeine", max: 3 });
    expect(spy).toHaveBeenCalledWith("caffeine", 3);
  });

  it("clamps max to 8", async () => {
    const spy = vi.spyOn(chemToolsDeps, "searchPubChem").mockResolvedValueOnce([
      makePubChemCompound(),
    ]);
    await searchPubChemTool.execute({ query: "caffeine", max: 100 });
    expect(spy).toHaveBeenCalledWith("caffeine", 8);
  });

  it("returns ok: false on network error", async () => {
    vi.spyOn(chemToolsDeps, "searchPubChem").mockRejectedValueOnce(
      new Error("No PubChem match"),
    );
    const result = (await searchPubChemTool.execute({ query: "xyzxyzxyz" })) as SearchPubChemResult;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.error).toContain("No PubChem match");
  });

  it("returns ok: false when no matches returned", async () => {
    vi.spyOn(chemToolsDeps, "searchPubChem").mockResolvedValueOnce([]);
    const result = (await searchPubChemTool.execute({ query: "xyzxyzxyz" })) as SearchPubChemResult;
    expect(result.ok).toBe(false);
  });

  it("returns ok: false when query is empty", async () => {
    const result = (await searchPubChemTool.execute({ query: "" })) as SearchPubChemResult;
    expect(result.ok).toBe(false);
  });

  it("is not an action tool (read-only)", () => {
    expect(searchPubChemTool.action).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// create_molecule tool (stubbed deps)
// ---------------------------------------------------------------------------

describe("create_molecule tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function setupCreateMoleculeStubs(overrides?: { identityError?: boolean; saveError?: boolean }) {
    if (overrides?.identityError) {
      vi.spyOn(chemToolsDeps, "toMolblock").mockRejectedValueOnce(
        new Error("RDKit could not parse the structure"),
      );
    } else {
      vi.spyOn(chemToolsDeps, "toMolblock").mockResolvedValueOnce(SAMPLE_MOLFILE);
      vi.spyOn(chemToolsDeps, "computeIdentity").mockResolvedValueOnce(makeMoleculeIdentity());
    }

    if (overrides?.saveError) {
      vi.spyOn(chemToolsDeps, "createMolecule").mockRejectedValueOnce(
        new Error("Folder not connected"),
      );
    } else {
      vi.spyOn(chemToolsDeps, "createMolecule").mockResolvedValueOnce(
        makeMoleculeDetail({ meta: makeMoleculeMeta({ source: "drawn" }) }),
      );
    }
  }

  it("is an action tool with isDestructive false", () => {
    expect(createMoleculeTool.action).toBe(true);
    expect(createMoleculeTool.isDestructive!({})).toBe(false);
  });

  it("returns ok: true and wires RDKit-derived fields through moleculesApi.create", async () => {
    setupCreateMoleculeStubs();
    const result = (await createMoleculeTool.execute({
      name: "Caffeine",
      smiles: "Cn1cnc2c1c(=O)n(c(=O)n2C)C",
    })) as CreateMoleculeResult;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.name).toBe("Caffeine");
    expect(result.source).toBe("drawn");
    // The tool wires the identity from the meta returned by moleculesApi.create.
    expect(result.formula).toBe("C8H10N4O2");
    expect(result.mol_weight).toBe(194.19);
  });

  it("passes the molfile (from toMolblock) to moleculesApi.create", async () => {
    vi.spyOn(chemToolsDeps, "toMolblock").mockResolvedValueOnce(SAMPLE_MOLFILE);
    vi.spyOn(chemToolsDeps, "computeIdentity").mockResolvedValueOnce(makeMoleculeIdentity());
    const createSpy = vi
      .spyOn(chemToolsDeps, "createMolecule")
      .mockResolvedValueOnce(makeMoleculeDetail());

    await createMoleculeTool.execute({ name: "Test", smiles: "CCO" });

    expect(createSpy).toHaveBeenCalledWith(
      SAMPLE_MOLFILE,
      expect.objectContaining({ name: "Test", source: "drawn" }),
    );
  });

  it("returns ok: false when SMILES is empty", async () => {
    const result = (await createMoleculeTool.execute({ name: "Test", smiles: "" })) as CreateMoleculeResult;
    expect(result.ok).toBe(false);
  });

  it("returns ok: false when toMolblock (RDKit) rejects bad SMILES", async () => {
    setupCreateMoleculeStubs({ identityError: true });
    const result = (await createMoleculeTool.execute({
      name: "garbage",
      smiles: "NOTSMILES!!!",
    })) as CreateMoleculeResult;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.error).toContain("RDKit");
  });

  it("returns ok: false when moleculesApi.create throws", async () => {
    setupCreateMoleculeStubs({ saveError: true });
    const result = (await createMoleculeTool.execute({
      name: "Test",
      smiles: "CCO",
    })) as CreateMoleculeResult;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.error).toContain("Save failed");
  });

  it("describeAction includes the molecule name", () => {
    const { summary } = createMoleculeTool.describeAction!({ name: "aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O" });
    expect(summary).toContain("aspirin");
  });
});

// ---------------------------------------------------------------------------
// import_molecule tool (stubbed deps)
// ---------------------------------------------------------------------------

describe("import_molecule tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function setupImportStubs(overrides?: { fetchError?: boolean; saveError?: boolean }) {
    if (overrides?.fetchError) {
      vi.spyOn(chemToolsDeps, "fetchCompoundByCid").mockRejectedValueOnce(
        new Error("PubChem property lookup failed (HTTP 404)"),
      );
      vi.spyOn(chemToolsDeps, "fetchSdf").mockRejectedValueOnce(
        new Error("PubChem SDF fetch failed (HTTP 404)"),
      );
    } else {
      vi.spyOn(chemToolsDeps, "fetchCompoundByCid").mockResolvedValueOnce(
        makePubChemCompound(),
      );
      vi.spyOn(chemToolsDeps, "fetchSdf").mockResolvedValueOnce(SAMPLE_SDF);
    }

    if (overrides?.saveError) {
      vi.spyOn(chemToolsDeps, "createMolecule").mockRejectedValueOnce(
        new Error("Folder not connected"),
      );
    } else {
      vi.spyOn(chemToolsDeps, "createMolecule").mockResolvedValueOnce(
        makeMoleculeDetail({
          meta: makeMoleculeMeta({ source: "pubchem", pubchem_cid: 2519 }),
        }),
      );
    }
  }

  it("is an action tool with isDestructive false", () => {
    expect(importMoleculeTool.action).toBe(true);
    expect(importMoleculeTool.isDestructive!({})).toBe(false);
  });

  it("returns ok: true with correct shape on success", async () => {
    setupImportStubs();
    const result = (await importMoleculeTool.execute({ cid: 2519 })) as ImportMoleculeResult;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.pubchem_cid).toBe(2519);
    expect(result.source).toBe("pubchem");
    expect(result.name).toBe("Caffeine");
  });

  it("passes source pubchem and the CID to moleculesApi.create", async () => {
    vi.spyOn(chemToolsDeps, "fetchCompoundByCid").mockResolvedValueOnce(
      makePubChemCompound(),
    );
    vi.spyOn(chemToolsDeps, "fetchSdf").mockResolvedValueOnce(SAMPLE_SDF);
    const createSpy = vi
      .spyOn(chemToolsDeps, "createMolecule")
      .mockResolvedValueOnce(
        makeMoleculeDetail({ meta: makeMoleculeMeta({ source: "pubchem", pubchem_cid: 2519 }) }),
      );

    await importMoleculeTool.execute({ cid: 2519 });

    expect(createSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source: "pubchem", pubchem_cid: 2519 }),
    );
  });

  it("trims the SDF to a Molfile before saving", async () => {
    vi.spyOn(chemToolsDeps, "fetchCompoundByCid").mockResolvedValueOnce(
      makePubChemCompound(),
    );
    vi.spyOn(chemToolsDeps, "fetchSdf").mockResolvedValueOnce(SAMPLE_SDF);
    const createSpy = vi
      .spyOn(chemToolsDeps, "createMolecule")
      .mockResolvedValueOnce(makeMoleculeDetail());

    await importMoleculeTool.execute({ cid: 2519 });

    // The first argument to createMolecule should be the molfile (no $$$$).
    const molfileArg = createSpy.mock.calls[0][0] as string;
    expect(molfileArg.includes("$$$$")).toBe(false);
    expect(molfileArg.includes("M  END")).toBe(true);
  });

  it("returns ok: false when the CID is missing", async () => {
    const result = (await importMoleculeTool.execute({})) as ImportMoleculeResult;
    expect(result.ok).toBe(false);
  });

  it("returns ok: false for a non-numeric CID", async () => {
    const result = (await importMoleculeTool.execute({ cid: "caffeine" })) as ImportMoleculeResult;
    expect(result.ok).toBe(false);
  });

  it("returns ok: false when PubChem fetch fails", async () => {
    setupImportStubs({ fetchError: true });
    const result = (await importMoleculeTool.execute({ cid: 9999999999 })) as ImportMoleculeResult;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.error).toContain("PubChem");
  });

  it("returns ok: false when moleculesApi.create throws", async () => {
    setupImportStubs({ saveError: true });
    const result = (await importMoleculeTool.execute({ cid: 2519 })) as ImportMoleculeResult;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.error).toContain("Save failed");
  });

  it("describeAction includes the CID", () => {
    const { summary } = importMoleculeTool.describeAction!({ cid: 2519 });
    expect(summary).toContain("2519");
  });
});
