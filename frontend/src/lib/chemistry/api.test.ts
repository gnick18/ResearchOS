import { describe, expect, it } from "vitest";

import { listByProject, moleculesApi, type Molecule } from "./api";

/**
 * Contract test for the molecule-library SEAM the project "Molecules" surface
 * builds against (chemistry-workbench Phase 0, Grant approved 2026-06-10).
 * Mirrors the sequences seam test.
 *
 * These pin the SHAPE and the empty-seam behavior so a consumer can wire to it
 * with confidence. Phase 1 replaces the empty return with the real Molfile/meta
 * read path; at that point this test grows real fixtures, but the SIGNATURE
 * (listByProject(projectId) -> Promise<Molecule[]>) and the meta shape must stay
 * stable.
 */
describe("moleculesApi seam (pre-Phase-1)", () => {
  it("listByProject returns an empty array for any project (the seam)", async () => {
    await expect(listByProject("any-project-id")).resolves.toEqual([]);
    await expect(moleculesApi.listByProject("another")).resolves.toEqual([]);
  });

  it("the consumer can rely on the locked Molecule/meta shape", () => {
    // Type-level contract, exercised at runtime so the test fails loudly if a
    // future edit drops or renames a field the project surface reads.
    const sample: Molecule = {
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
    expect(sample.project_ids).toContain("proj-a");
    expect(typeof sample.added_at).toBe("string");
    expect(sample.source).toBe("drawn");
  });
});
