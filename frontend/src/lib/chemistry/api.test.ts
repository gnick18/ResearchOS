import { beforeEach, describe, expect, it, vi } from "vitest";

import { listByProject, moleculesApi, setStarredPapers, type Molecule, type StarredPaper } from "./api";
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

  it("starred_papers is an optional field on MoleculeMeta (back-compat)", () => {
    // Old molecules without starred_papers parse fine (no required field).
    const mol: Molecule = {
      id: "mol-2",
      name: "Gliotoxin",
      project_ids: [],
      added_at: "2026-06-12T00:00:00.000Z",
    };
    expect(mol.starred_papers).toBeUndefined();
  });
});

describe("moleculesApi.setStarredPapers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("writes starred_papers via updateMeta and returns the updated sidecar", async () => {
    const existing: Molecule = {
      id: "42",
      name: "Gliotoxin",
      project_ids: [],
      added_at: "2026-06-12T00:00:00.000Z",
    };
    const starred: StarredPaper[] = [
      {
        doi: "10.1099/mic.0.27847-0",
        title: "Gliotoxin and the epipolythiodioxopiperazines, a review",
        year: "2005",
        type: "review",
        journal: "Microbiology",
        starred_at: "2026-06-12T10:00:00.000Z",
      },
    ];
    const updated: Molecule = { ...existing, starred_papers: starred };

    vi.spyOn(moleculeStore, "updateMeta").mockResolvedValue(updated);

    const result = await setStarredPapers("42", starred);
    expect(result).not.toBeNull();
    expect(result?.starred_papers).toHaveLength(1);
    expect(result?.starred_papers?.[0].doi).toBe("10.1099/mic.0.27847-0");
    expect(result?.starred_papers?.[0].type).toBe("review");

    // Confirm updateMeta was called with the starred_papers patch.
    expect(moleculeStore.updateMeta).toHaveBeenCalledWith(
      "42",
      { starred_papers: starred },
      expect.any(String),
    );
  });

  it("returns null when the molecule does not exist", async () => {
    vi.spyOn(moleculeStore, "updateMeta").mockResolvedValue(null);
    const result = await setStarredPapers("nonexistent", []);
    expect(result).toBeNull();
  });
});
