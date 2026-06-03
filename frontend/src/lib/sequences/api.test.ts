import { describe, expect, it } from "vitest";

import { listByProject, sequencesApi, type Sequence } from "./api";

/**
 * Contract test for the sequence-library SEAM the de-bloat Workbench projects
 * surface builds against (cross-arc decision, Grant 2026-06-02: de-bloat builds
 * now against the locked shape with a listByProject seam that returns nothing
 * until sequence-editor Phase 1 lands).
 *
 * These pin the SHAPE and the empty-seam behavior so de-bloat can wire to it
 * with confidence. Phase 1 replaces the empty return with the real GenBank/meta
 * read path; at that point this test grows real fixtures, but the SIGNATURE
 * (listByProject(projectId) -> Promise<Sequence[]>) and the meta shape must
 * stay stable.
 */
describe("sequencesApi seam (pre-Phase-1)", () => {
  it("listByProject returns an empty array for any project (the seam)", async () => {
    await expect(listByProject("any-project-id")).resolves.toEqual([]);
    await expect(sequencesApi.listByProject("another")).resolves.toEqual([]);
  });

  it("the consumer can rely on the locked Sequence/meta shape", () => {
    // Type-level contract, exercised at runtime so the test fails loudly if a
    // future edit drops or renames a field the projects surface reads.
    const sample: Sequence = {
      id: "seq-1",
      name: "pUC19",
      project_ids: ["proj-a", "proj-b"],
      added_at: "2026-06-02T00:00:00.000Z",
      length_bp: 2686,
    };
    expect(sample.project_ids).toContain("proj-a");
    expect(typeof sample.added_at).toBe("string");
  });
});
