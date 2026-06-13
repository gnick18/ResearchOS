import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  treeCardEmbed,
  resolveTree,
  phyloToolsDeps,
  listPhyloTreesTool,
  readPhyloTreeTool,
  generateTreeTool,
  resolveBuilderOptions,
} from "./phylo-tools";
import type { PhyloMeta } from "@/lib/phylo/api";
import { DEFAULT_OPTIONS } from "@/lib/phylo/catalog";

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

// ---------------------------------------------------------------------------
// generate_tree
// ---------------------------------------------------------------------------

describe("resolveBuilderOptions", () => {
  it("returns DEFAULT_OPTIONS when no args are supplied", () => {
    const { options, defaulted } = resolveBuilderOptions({});
    expect(options).toEqual(DEFAULT_OPTIONS);
    // No fields were explicitly supplied, so nothing is reported as defaulted
    // (undefined args are not the same as invalid args).
    expect(defaulted).toEqual([]);
  });

  it("overlays valid catalog values onto the defaults", () => {
    const { options, defaulted } = resolveBuilderOptions({
      dataType: "protein",
      analysis: "supermatrix",
      infer: "raxml",
      model: "fixed",
      fixedModel: "LG+G",
      support: "bootstrap",
      os: "linux",
      threads: "8",
      bnni: false,
      asc: true,
    });
    expect(options.dataType).toBe("protein");
    expect(options.analysis).toBe("supermatrix");
    expect(options.infer).toBe("raxml");
    expect(options.model).toBe("fixed");
    expect(options.fixedModel).toBe("LG+G");
    expect(options.support).toBe("bootstrap");
    expect(options.os).toBe("linux");
    expect(options.threads).toBe("8");
    expect(options.bnni).toBe(false);
    expect(options.asc).toBe(true);
    expect(defaulted).toEqual([]);
  });

  it("rejects out-of-catalog values and falls back to defaults, reporting them", () => {
    const { options, defaulted } = resolveBuilderOptions({
      dataType: "rna", // not a valid DataType
      infer: "phyml", // not a valid InferTool
      ufbootReps: -5, // not a positive integer
    });
    expect(options.dataType).toBe(DEFAULT_OPTIONS.dataType);
    expect(options.infer).toBe(DEFAULT_OPTIONS.infer);
    expect(options.ufbootReps).toBe(DEFAULT_OPTIONS.ufbootReps);
    expect(defaulted).toContain("dataType");
    expect(defaulted).toContain("infer");
    expect(defaulted).toContain("ufbootReps");
  });

  it("accepts AUTO (case-insensitive) and numeric strings for threads", () => {
    expect(resolveBuilderOptions({ threads: "AUTO" }).options.threads).toBe("AUTO");
    expect(resolveBuilderOptions({ threads: "auto" }).options.threads).toBe("AUTO");
    expect(resolveBuilderOptions({ threads: "4" }).options.threads).toBe("4");
  });

  it("reports threads as defaulted for an invalid thread value", () => {
    const { options, defaulted } = resolveBuilderOptions({ threads: "fast" });
    expect(options.threads).toBe(DEFAULT_OPTIONS.threads);
    expect(defaulted).toContain("threads");
  });
});

describe("generate_tree tool", () => {
  it("is read-only (action and previewable are falsy)", () => {
    expect(generateTreeTool.action).toBeFalsy();
    expect(generateTreeTool.previewable).toBeFalsy();
  });

  it("returns a RecipeOutput with non-empty commands, runScript, and markdown for a valid config", async () => {
    const out = (await generateTreeTool.execute({
      dataType: "nucleotide",
      analysis: "single",
      infer: "iqtree",
      model: "modelfinder",
      support: "ufboot",
      os: "mac",
    })) as { ok: boolean; recipe: { commands: string; runScript: string; markdown: string }; optionsUsed: object; defaulted: string[] };

    expect(out.ok).toBe(true);
    expect(out.recipe.commands.length).toBeGreaterThan(0);
    expect(out.recipe.runScript.length).toBeGreaterThan(0);
    expect(out.recipe.markdown.length).toBeGreaterThan(0);
    expect(Array.isArray(out.defaulted)).toBe(true);
    expect(out.optionsUsed).toBeDefined();
  });

  it("falls back entirely to DEFAULT_OPTIONS when called with empty args, reporting no defaulted fields", async () => {
    const out = (await generateTreeTool.execute({})) as {
      ok: boolean;
      optionsUsed: typeof DEFAULT_OPTIONS;
      defaulted: string[];
    };
    expect(out.ok).toBe(true);
    expect(out.optionsUsed).toEqual(DEFAULT_OPTIONS);
    expect(out.defaulted).toEqual([]);
  });

  it("reports defaulted fields when out-of-catalog values are supplied", async () => {
    const out = (await generateTreeTool.execute({
      infer: "notarealthing",
      dataType: "rna",
    })) as { ok: boolean; defaulted: string[] };
    expect(out.ok).toBe(true);
    expect(out.defaulted).toContain("infer");
    expect(out.defaulted).toContain("dataType");
  });

  it("generates a supermatrix recipe that includes iqtree2 regardless of the infer field", async () => {
    const out = (await generateTreeTool.execute({
      analysis: "supermatrix",
      infer: "raxml", // supermatrix forces IQ-TREE for the partitioned tree
    })) as { ok: boolean; recipe: { commands: string } };
    expect(out.ok).toBe(true);
    expect(out.recipe.commands).toContain("iqtree2");
  });

  it("generates a coalescent recipe that includes astral", async () => {
    const out = (await generateTreeTool.execute({
      analysis: "coalescent",
    })) as { ok: boolean; recipe: { commands: string } };
    expect(out.ok).toBe(true);
    expect(out.recipe.commands).toContain("astral");
  });

  it("generates a fixed-model recipe that does NOT include MFP", async () => {
    const out = (await generateTreeTool.execute({
      model: "fixed",
      fixedModel: "GTR+G",
      infer: "iqtree",
    })) as { ok: boolean; recipe: { commands: string } };
    expect(out.ok).toBe(true);
    // Fixed model should NOT include the MFP ModelFinder token
    expect(out.recipe.commands).not.toContain("MFP");
    expect(out.recipe.commands).toContain("GTR+G");
  });
});
