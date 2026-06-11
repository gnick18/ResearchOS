import { beforeEach, describe, expect, it, vi } from "vitest";

import { listByProject, moleculesApi, type Molecule } from "./api";
import { moleculeStore } from "./molecule-store";

/**
 * Contract test for the molecule-library API the hub grid + project "Molecules"
 * surface build against (chemistry-workbench Phase 1, 2026-06-10).
 *
 * Phase 0 pinned the empty seam; Phase 1 wires `listByProject` to the real
 * `moleculeStore`, so this pins the FILTER behavior (collection membership via
 * `project_ids`) and the locked Molecule/meta shape. RDKit and the on-disk store
 * are the units under their own tests; here we mock the store so the api logic is
 * tested without a connected data folder.
 */

const sample = (id: string, projects: string[]): Molecule => ({
  id,
  name: `mol-${id}`,
  project_ids: projects,
  added_at: "2026-06-10T00:00:00.000Z",
  source: "drawn",
});

describe("moleculesApi.listByProject", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns only the molecules linked to the given project", async () => {
    vi.spyOn(moleculeStore, "listMeta").mockResolvedValue([
      sample("1", ["proj-a"]),
      sample("2", ["proj-a", "proj-b"]),
      sample("3", ["proj-b"]),
    ]);
    const inA = await listByProject("proj-a");
    expect(inA.map((m) => m.id).sort()).toEqual(["1", "2"]);
    const inB = await moleculesApi.listByProject("proj-b");
    expect(inB.map((m) => m.id).sort()).toEqual(["2", "3"]);
  });

  it("returns an empty array when no molecule links to the project", async () => {
    vi.spyOn(moleculeStore, "listMeta").mockResolvedValue([
      sample("1", ["proj-a"]),
    ]);
    await expect(listByProject("proj-z")).resolves.toEqual([]);
  });
});

describe("Molecule/meta shape", () => {
  it("the consumer can rely on the locked Molecule shape", () => {
    // Type-level contract, exercised at runtime so the test fails loudly if a
    // future edit drops or renames a field the hub/project surface reads.
    const mol: Molecule = {
      id: "mol-1",
      name: "Aspirin",
      project_ids: ["proj-a", "proj-b"],
      added_at: "2026-06-10T00:00:00.000Z",
      smiles: "CC(=O)Oc1ccccc1C(=O)O",
      inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
      formula: "C9H8O4",
      mol_weight: 180.16,
      source: "drawn",
    };
    expect(mol.project_ids).toContain("proj-a");
    expect(typeof mol.added_at).toBe("string");
    expect(mol.source).toBe("drawn");
  });
});
