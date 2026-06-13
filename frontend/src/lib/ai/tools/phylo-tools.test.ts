import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  treeCardEmbed,
  resolveTree,
  phyloToolsDeps,
  listPhyloTreesTool,
  readPhyloTreeTool,
} from "./phylo-tools";
import type { PhyloMeta } from "@/lib/phylo/api";

function meta(over: Partial<PhyloMeta> = {}): PhyloMeta {
  return {
    id: "t1",
    name: "cyp51A tree",
    project_ids: [],
    added_at: "2026-06-12T00:00:00.000Z",
    format: "newick",
    tip_count: 42,
    ...over,
  } as PhyloMeta;
}

beforeEach(() => vi.restoreAllMocks());

describe("treeCardEmbed", () => {
  it("emits the studio card markdown", () => {
    expect(treeCardEmbed({ id: "t1", name: "My tree" })).toBe(
      "[My tree](/phylo?doc=t1#ros=studio)",
    );
  });
  it("falls back to a label when unnamed", () => {
    expect(treeCardEmbed({ id: "t2", name: "" })).toBe("[Tree](/phylo?doc=t2#ros=studio)");
  });
});

describe("resolveTree", () => {
  const trees = [meta({ id: "a", name: "Alpha" }), meta({ id: "b", name: "Beta" })];
  it("resolves by id and by case-insensitive name", () => {
    expect(resolveTree(trees, "b")?.id).toBe("b");
    expect(resolveTree(trees, "alpha")?.id).toBe("a");
  });
  it("returns null for no match or no ref", () => {
    expect(resolveTree(trees, "gamma")).toBeNull();
    expect(resolveTree(trees, undefined)).toBeNull();
  });
});

describe("list_phylo_trees", () => {
  it("is read-only and returns each tree with its embed", async () => {
    expect(listPhyloTreesTool.action).toBeFalsy();
    expect(listPhyloTreesTool.previewable).toBeFalsy();
    vi.spyOn(phyloToolsDeps, "listTrees").mockResolvedValue([meta()]);
    const out = (await listPhyloTreesTool.execute({})) as {
      ok: boolean;
      count: number;
      trees: { embed: string; tips: number }[];
    };
    expect(out.ok).toBe(true);
    expect(out.count).toBe(1);
    expect(out.trees[0].embed).toBe("[cyp51A tree](/phylo?doc=t1#ros=studio)");
    expect(out.trees[0].tips).toBe(42);
  });
});

describe("read_phylo_tree", () => {
  it("resolves a tree by name and returns its brief", async () => {
    vi.spyOn(phyloToolsDeps, "listTrees").mockResolvedValue([meta()]);
    const out = (await readPhyloTreeTool.execute({ tree: "cyp51A tree" })) as {
      ok: boolean;
      tree: { id: string };
    };
    expect(out.ok).toBe(true);
    expect(out.tree.id).toBe("t1");
  });
  it("lists real names when the tree is not found", async () => {
    vi.spyOn(phyloToolsDeps, "listTrees").mockResolvedValue([meta({ name: "Alpha" })]);
    const out = (await readPhyloTreeTool.execute({ tree: "nope" })) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Alpha");
  });
});
