import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rankJoinCandidates, type JoinCandidate } from "@/lib/phylo/smart-binding";
import { setBeakerContext } from "@/components/ai/context-bridge";
import { suggestTreeOverlaysTool, phyloToolsDeps } from "./phylo-tools";
import { overlayWizardFromResult } from "@/lib/ai/overlay-wizard";
import type { PhyloMeta } from "@/lib/phylo/api";

// The engine is unit-tested separately (smart-binding.test.ts); mock it so this
// suite covers the TOOL's resolve + assemble + _ui behavior in isolation.
vi.mock("@/lib/phylo/smart-binding", () => ({
  rankJoinCandidates: vi.fn(),
}));

const mockRank = vi.mocked(rankJoinCandidates);

const TREE: PhyloMeta = {
  id: "tree1",
  name: "cyp51A",
  project_ids: ["proj1"],
  added_at: "2026-01-01",
  format: "newick",
} as PhyloMeta;

const CANDIDATE: JoinCandidate = {
  tableId: "t1",
  tableName: "Strain metadata",
  joinColumnId: "c_taxon",
  joinColumnName: "taxon",
  joinRate: 0.857,
  matchedTips: 6,
  totalTips: 7,
  overlays: [
    {
      columnId: "c_loc",
      columnName: "Location",
      columnKind: "categorical",
      geoms: ["strip"],
      recommendedGeom: "strip",
    },
  ],
};

const original = { ...phyloToolsDeps };

function setDeps(over: Partial<typeof phyloToolsDeps>) {
  Object.assign(phyloToolsDeps, over);
}

beforeEach(() => {
  mockRank.mockReset();
  setBeakerContext(null);
  setDeps({
    listTrees: async () => [TREE],
    getTree: async () => ({ tree: "(A,B);", meta: TREE }) as never,
    listProjectTables: async () => [{ id: "t1", name: "Strain metadata" }],
    getTableContent: async () => ({}) as never,
  });
});

afterEach(() => {
  Object.assign(phyloToolsDeps, original);
  setBeakerContext(null);
});

describe("suggest_tree_overlays", () => {
  it("ranks joinable tables and rides the wizard payload under _ui", async () => {
    mockRank.mockReturnValue([CANDIDATE]);
    const res = (await suggestTreeOverlaysTool.execute({ tree: "cyp51A" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(res.candidateCount).toBe(1);
    // Model-facing facts are compact (percent + columns), not the raw candidate.
    expect(res.candidates).toEqual([
      {
        tableName: "Strain metadata",
        joinPercent: 86,
        matchedTips: 6,
        totalTips: 7,
        columns: [{ name: "Location", kind: "categorical", geoms: ["strip"] }],
      },
    ]);
    // The full candidate set rides UI-only for the wizard.
    const payload = overlayWizardFromResult(res);
    expect(payload?.treeId).toBe("tree1");
    expect(payload?.candidates).toEqual([CANDIDATE]);
  });

  it("resolves the OPEN tree from the context bridge when no ref is given", async () => {
    setBeakerContext({
      route: "/phylo",
      pageLabel: "Tree Studio",
      selection: { type: "phylo", id: "tree1", name: "cyp51A" },
    });
    mockRank.mockReturnValue([CANDIDATE]);
    const res = (await suggestTreeOverlaysTool.execute({})) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(overlayWizardFromResult(res)?.treeId).toBe("tree1");
  });

  it("treats a deictic ref ('this tree') as the OPEN tree from context", async () => {
    setBeakerContext({
      route: "/phylo",
      pageLabel: "Tree Studio",
      selection: { type: "phylo", id: "tree1", name: "cyp51A" },
    });
    mockRank.mockReturnValue([CANDIDATE]);
    const res = (await suggestTreeOverlaysTool.execute({ tree: "this tree" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(overlayWizardFromResult(res)?.treeId).toBe("tree1");
  });

  it("reports no candidates (and no wizard) when nothing joins", async () => {
    mockRank.mockReturnValue([]);
    const res = (await suggestTreeOverlaysTool.execute({ tree: "cyp51A" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(res.candidateCount).toBe(0);
    expect(typeof res.message).toBe("string");
    expect(overlayWizardFromResult(res)).toBeNull();
  });

  it("reports no candidates when the project has no tables", async () => {
    setDeps({ listProjectTables: async () => [] });
    const res = (await suggestTreeOverlaysTool.execute({ tree: "cyp51A" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(res.candidateCount).toBe(0);
    expect(mockRank).not.toHaveBeenCalled();
  });

  it("errors when a named tree does not resolve", async () => {
    const res = (await suggestTreeOverlaysTool.execute({ tree: "nope" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/could not find a tree/i);
  });

  it("asks which tree when no ref and nothing is open", async () => {
    const res = (await suggestTreeOverlaysTool.execute({})) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/which tree/i);
    expect(mockRank).not.toHaveBeenCalled();
  });
});
