import { describe, it, expect } from "vitest";
import {
  compareBuilderOptions,
  withRecipeComparisonUi,
  recipeComparisonFromResult,
  type RecipeComparisonPayload,
} from "./recipe-compare";
import { recordSetFromResult } from "./record-set";
import { DEFAULT_OPTIONS, type BuilderOptions } from "@/lib/phylo/catalog";
import { compareTreeRecipesTool } from "./tools/phylo-tools";

const paper: BuilderOptions = {
  ...DEFAULT_OPTIONS,
  align: "mafft",
  trim: "trimal",
  infer: "iqtree",
  support: "ufboot",
  ufbootReps: 1000,
};
const mine: BuilderOptions = {
  ...DEFAULT_OPTIONS,
  align: "muscle",
  trim: "trimal",
  infer: "raxml",
  support: "bootstrap",
  bsReps: 500,
};

describe("compareBuilderOptions", () => {
  it("marks differing steps and matching steps as facts", () => {
    const rows = compareBuilderOptions(paper, mine);
    const by = (label: string) => rows.find((r) => r.label === label)!;
    expect(by("Aligner")).toMatchObject({ paper: "mafft", mine: "muscle", same: false });
    expect(by("Tree method")).toMatchObject({ paper: "iqtree", mine: "raxml", same: false });
    expect(by("Trimming")).toMatchObject({ same: true });
    expect(by("Replicates").paper).toMatch(/1000/);
    expect(by("Replicates").mine).toMatch(/500/);
    expect(by("Replicates").same).toBe(false);
    expect(by("Data type").same).toBe(true);
  });

  it("formats a fixed substitution model from fixedModel", () => {
    const rows = compareBuilderOptions(
      { ...paper, model: "fixed", fixedModel: "GTR+G" },
      { ...mine, model: "modelfinder" },
    );
    const model = rows.find((r) => r.label === "Substitution model")!;
    expect(model.paper).toBe("GTR+G");
    expect(model.mine).toBe("ModelFinder");
    expect(model.same).toBe(false);
  });
});

describe("recipe-comparison _ui seam", () => {
  const payload: RecipeComparisonPayload = {
    widget: "recipeComparison",
    rows: compareBuilderOptions(paper, mine),
    paperLabel: "Paper",
    mineLabel: "Your tree",
  };
  it("round-trips under _ui and is ignored by recordSetFromResult", () => {
    const result = withRecipeComparisonUi({ ok: true }, payload);
    expect(recipeComparisonFromResult(result)).toEqual(payload);
    expect(recordSetFromResult(result)).toBeNull();
  });
  it("returns null for a non-comparison result", () => {
    expect(recipeComparisonFromResult({ ok: true })).toBeNull();
    expect(recipeComparisonFromResult({ _ui: { widget: "overlayWizard" } })).toBeNull();
  });
});

describe("compare_tree_recipes tool", () => {
  it("resolves both sides, returns facts + the comparison widget payload", async () => {
    const res = (await compareTreeRecipesTool.execute({
      paper: { align: "mafft", infer: "iqtree", support: "ufboot", ufbootReps: 1000 },
      mine: { align: "muscle", infer: "raxml", support: "bootstrap", bsReps: 500 },
      mineLabel: "My cyp51A tree",
    })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.mineLabel).toBe("My cyp51A tree");
    expect(Array.isArray(res.comparison)).toBe(true);
    expect((res.differenceCount as number)).toBeGreaterThan(0);
    const payload = recipeComparisonFromResult(res);
    expect(payload?.widget).toBe("recipeComparison");
    expect(payload?.rows.find((r) => r.label === "Aligner")).toMatchObject({
      paper: "mafft",
      mine: "muscle",
      same: false,
    });
  });
});
