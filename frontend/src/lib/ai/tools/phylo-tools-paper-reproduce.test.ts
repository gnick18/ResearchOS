// Tests for generate_tree driving paper-pipeline reproduction (BeakerAI lane,
// 2026-06-13).
//
// Covers: paper-style param sets matched to the hpv58 and firefly_opsin
// validated fixtures, fixedModel free-string round-trip, and catalog-miss
// surfacing. Mirrors the style of phylo-tools.test.ts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { resolveBuilderOptions, generateTreeTool } from "./phylo-tools";
import { DEFAULT_OPTIONS } from "@/lib/phylo/catalog";
import { generateRecipe } from "@/lib/phylo/recipe";

// The validated fixtures are the assertion targets (builder-options.json files).
import hpv58Options from "@/lib/transparency/datasets/phylo-published/hpv58/builder-options.json";
import fireflyOpsinOptions from "@/lib/transparency/datasets/phylo-published/firefly_opsin/builder-options.json";

// ---------------------------------------------------------------------------
// hpv58: nucleotide raw sequences, MAFFT, trimAl, GTR+G, IQ-TREE, 1000
// UFBoot, midpoint rooting (no outgroup taxon).
// The paper pipeline specifies the model explicitly, so model is "fixed" and
// fixedModel is "GTR+G".
// ---------------------------------------------------------------------------

const hpv58PaperArgs = {
  dataType: "nucleotide",
  analysis: "single",
  have: "raw",
  align: "mafft",
  trim: "trimal",
  model: "fixed",
  fixedModel: "GTR+G",
  infer: "iqtree",
  support: "ufboot",
  ufbootReps: 1000,
  outgroup: "",
};

describe("hpv58 paper pipeline", () => {
  it("resolves to BuilderOptions matching the hpv58 fixture", () => {
    const { options, defaulted, catalogMissNotes } = resolveBuilderOptions(hpv58PaperArgs);

    // Model, aligner, trim all match the paper exactly, so no catalog misses.
    expect(defaulted).toEqual([]);
    expect(catalogMissNotes).toEqual([]);

    // Core fields must match the fixture.
    expect(options.dataType).toBe(hpv58Options.dataType);
    expect(options.analysis).toBe(hpv58Options.analysis);
    expect(options.have).toBe(hpv58Options.have);
    expect(options.align).toBe(hpv58Options.align);
    expect(options.trim).toBe(hpv58Options.trim);
    expect(options.model).toBe("fixed");
    expect(options.fixedModel).toBe("GTR+G");
    expect(options.infer).toBe(hpv58Options.infer);
    expect(options.support).toBe(hpv58Options.support);
    expect(options.ufbootReps).toBe(hpv58Options.ufbootReps);
  });

  it("generates a recipe that contains the GTR+G model and iqtree2", () => {
    const { options } = resolveBuilderOptions(hpv58PaperArgs);
    const recipe = generateRecipe(options);

    // The recipe must use the exact model string from the paper.
    expect(recipe.commands).toContain("GTR+G");
    expect(recipe.commands).toContain("iqtree2");
    // UFBoot flag must be present with the correct replicate count.
    expect(recipe.commands).toContain("-B 1000");
    // MAFFT alignment step must be present.
    expect(recipe.commands).toContain("mafft");
    // trimAl trimming step must be present.
    expect(recipe.commands).toContain("trimal");
    // MFP ModelFinder must NOT appear (model is fixed, not modelfinder).
    expect(recipe.commands).not.toContain("MFP");
  });

  it("produces a non-empty runScript and markdown", () => {
    const { options } = resolveBuilderOptions(hpv58PaperArgs);
    const recipe = generateRecipe(options);
    expect(recipe.runScript.length).toBeGreaterThan(0);
    expect(recipe.markdown.length).toBeGreaterThan(0);
    expect(recipe.markdown).toContain("GTR+G");
  });
});

// ---------------------------------------------------------------------------
// firefly_opsin: protein, pre-aligned input, LG model, IQ-TREE, UFBoot.
// The paper specifies an LG model, so model is "fixed" and fixedModel is "LG+G".
// ---------------------------------------------------------------------------

const fireflyPaperArgs = {
  dataType: "protein",
  analysis: "single",
  have: "alignment",
  align: "skip",
  trim: "skip",
  model: "fixed",
  fixedModel: "LG+G",
  infer: "iqtree",
  support: "ufboot",
  ufbootReps: 1000,
  outgroup: "",
};

describe("firefly_opsin paper pipeline", () => {
  it("resolves to BuilderOptions matching the firefly_opsin fixture", () => {
    const { options, defaulted, catalogMissNotes } = resolveBuilderOptions(fireflyPaperArgs);

    expect(defaulted).toEqual([]);
    expect(catalogMissNotes).toEqual([]);

    expect(options.dataType).toBe(fireflyOpsinOptions.dataType);
    expect(options.analysis).toBe(fireflyOpsinOptions.analysis);
    expect(options.have).toBe(fireflyOpsinOptions.have);
    expect(options.align).toBe(fireflyOpsinOptions.align);
    expect(options.trim).toBe(fireflyOpsinOptions.trim);
    expect(options.model).toBe("fixed");
    expect(options.fixedModel).toBe("LG+G");
    expect(options.infer).toBe(fireflyOpsinOptions.infer);
    expect(options.support).toBe(fireflyOpsinOptions.support);
  });

  it("generates a recipe that contains LG+G and iqtree2, no alignment step", () => {
    const { options } = resolveBuilderOptions(fireflyPaperArgs);
    const recipe = generateRecipe(options);

    expect(recipe.commands).toContain("LG+G");
    expect(recipe.commands).toContain("iqtree2");
    // Pre-aligned input means no mafft or trimal commands.
    expect(recipe.commands).not.toContain("mafft");
    expect(recipe.commands).not.toContain("trimal");
    expect(recipe.commands).not.toContain("MFP");
  });

  it("produces a non-empty runScript and markdown for the protein pipeline", () => {
    const { options } = resolveBuilderOptions(fireflyPaperArgs);
    const recipe = generateRecipe(options);
    expect(recipe.runScript.length).toBeGreaterThan(0);
    expect(recipe.markdown.length).toBeGreaterThan(0);
    expect(recipe.markdown).toContain("LG+G");
  });
});

// ---------------------------------------------------------------------------
// fixedModel free-string round-trip.
//
// The paper specifies an exact model string (e.g. "GTR+I+G4", "LG+F+R4",
// "TVM+G+I"). This must round-trip through fixedModel unchanged, not coerced
// to a catalog enum value.
// ---------------------------------------------------------------------------

describe("fixedModel free-string round-trip", () => {
  const exoticModels = [
    "GTR+I+G4",
    "LG+F+R4",
    "TVM+G+I",
    "TrN+G",
    "Q.pfam+G+F",
    "HKY+G4+I",
  ];

  for (const modelStr of exoticModels) {
    it(`passes "${modelStr}" through fixedModel unchanged`, () => {
      const { options, defaulted } = resolveBuilderOptions({
        model: "fixed",
        fixedModel: modelStr,
      });
      // The exact model string must survive unchanged.
      expect(options.fixedModel).toBe(modelStr);
      expect(options.model).toBe("fixed");
      // fixedModel is a free-text field, not enumerated, so no catalog miss.
      expect(defaulted).not.toContain("fixedModel");
    });

    it(`"${modelStr}" appears verbatim in the generated iqtree2 command`, () => {
      const { options } = resolveBuilderOptions({
        model: "fixed",
        fixedModel: modelStr,
        infer: "iqtree",
      });
      const recipe = generateRecipe(options);
      expect(recipe.commands).toContain(modelStr);
      expect(recipe.commands).not.toContain("MFP");
    });
  }

  it("does NOT coerce an unknown model string to a catalog enum value", () => {
    const exoticModel = "SYM+ASC+R5";
    const { options } = resolveBuilderOptions({
      model: "fixed",
      fixedModel: exoticModel,
    });
    // Must not be the default value; must be exactly what we passed.
    expect(options.fixedModel).toBe(exoticModel);
    expect(options.fixedModel).not.toBe(DEFAULT_OPTIONS.fixedModel);
  });
});

// ---------------------------------------------------------------------------
// Catalog-miss: a paper names a tool/parameter the catalog does not carry.
// The tool must still produce a runnable recipe AND surface a factual note.
// ---------------------------------------------------------------------------

describe("catalog-miss surfacing", () => {
  it("produces a factual note when a paper specifies an unsupported aligner", () => {
    // "prank" is a real aligner but not in the catalog.
    const { options, defaulted, catalogMissNotes } = resolveBuilderOptions({
      align: "prank",
      trim: "trimal",
      infer: "iqtree",
    });

    // Must still fall back to a valid value.
    expect(options.align).toBe(DEFAULT_OPTIONS.align);
    expect(defaulted).toContain("align");

    // Must produce a factual note with the supplied and fallback values.
    const note = catalogMissNotes.find((n) => n.field === "align");
    expect(note).toBeDefined();
    expect(note!.supplied).toBe("prank");
    expect(note!.used).toBe(DEFAULT_OPTIONS.align);
    // Note must be purely descriptive (no judgment, no colon mid-sentence).
    expect(note!.note).toContain("prank");
    expect(note!.note).toContain(DEFAULT_OPTIONS.align);
    expect(note!.note).toMatch(/The paper specifies/);
  });

  it("produces a factual note when a paper specifies an unsupported tree tool", () => {
    // "phyml" is a real tool but not in the catalog.
    const { options, defaulted, catalogMissNotes } = resolveBuilderOptions({
      infer: "phyml",
    });

    expect(options.infer).toBe(DEFAULT_OPTIONS.infer);
    expect(defaulted).toContain("infer");

    const note = catalogMissNotes.find((n) => n.field === "infer");
    expect(note).toBeDefined();
    expect(note!.supplied).toBe("phyml");
    expect(note!.used).toBe(DEFAULT_OPTIONS.infer);
    expect(note!.note).toContain("phyml");
    expect(note!.note).toMatch(/The paper specifies/);
  });

  it("produces multiple factual notes for multiple catalog misses", () => {
    const { catalogMissNotes, defaulted } = resolveBuilderOptions({
      align: "prank",
      infer: "phyml",
      trim: "aliscore",
    });

    expect(defaulted).toContain("align");
    expect(defaulted).toContain("infer");
    expect(defaulted).toContain("trim");
    expect(catalogMissNotes.length).toBe(3);
  });

  it("still produces a runnable recipe even with catalog-miss params", () => {
    // Caller supplies unsupported values; the recipe must still be complete.
    const { options } = resolveBuilderOptions({
      align: "prank",
      infer: "phyml",
    });
    const recipe = generateRecipe(options);
    // Recipe must be non-trivial.
    expect(recipe.commands.length).toBeGreaterThan(0);
    expect(recipe.runScript.length).toBeGreaterThan(0);
    expect(recipe.markdown.length).toBeGreaterThan(0);
  });

  it("surfaces catalogMissNotes in the generate_tree tool result", async () => {
    const out = (await generateTreeTool.execute({
      align: "prank",
      infer: "phyml",
    })) as {
      ok: boolean;
      defaulted: string[];
      catalogMissNotes: Array<{ field: string; supplied: string; used: string; note: string }>;
      recipe: { commands: string };
    };

    expect(out.ok).toBe(true);
    expect(out.defaulted).toContain("align");
    expect(out.defaulted).toContain("infer");
    expect(out.catalogMissNotes.length).toBe(2);

    const alignNote = out.catalogMissNotes.find((n) => n.field === "align");
    expect(alignNote).toBeDefined();
    expect(alignNote!.note).toMatch(/The paper specifies/);
    expect(alignNote!.note).toContain("prank");

    // Recipe is still valid despite the catalog misses.
    expect(out.recipe.commands.length).toBeGreaterThan(0);
  });

  it("does NOT produce a note when no catalog-miss occurred", async () => {
    const out = (await generateTreeTool.execute({
      dataType: "nucleotide",
      align: "mafft",
      trim: "trimal",
      infer: "iqtree",
      model: "fixed",
      fixedModel: "GTR+G",
      support: "ufboot",
    })) as {
      ok: boolean;
      catalogMissNotes: unknown[];
    };

    expect(out.ok).toBe(true);
    expect(out.catalogMissNotes).toEqual([]);
  });

  it("does not produce a note for fixedModel (free-string, not enumerated)", async () => {
    // An unusual model string must NOT trigger a catalog-miss note; it passes
    // through as free text.
    const out = (await generateTreeTool.execute({
      model: "fixed",
      fixedModel: "SOME+EXOTIC+G4+F",
    })) as {
      ok: boolean;
      catalogMissNotes: unknown[];
      optionsUsed: { fixedModel: string };
    };

    expect(out.ok).toBe(true);
    expect(out.catalogMissNotes).toEqual([]);
    expect(out.optionsUsed.fixedModel).toBe("SOME+EXOTIC+G4+F");
  });
});

// ---------------------------------------------------------------------------
// Regression: existing resolveBuilderOptions contract (backward compat with
// the phylo-tools.test.ts suite). Confirm the return shape now includes
// catalogMissNotes in addition to the pre-existing fields.
// ---------------------------------------------------------------------------

describe("resolveBuilderOptions backward compatibility", () => {
  it("returns options, defaulted, AND catalogMissNotes", () => {
    const result = resolveBuilderOptions({});
    expect("options" in result).toBe(true);
    expect("defaulted" in result).toBe(true);
    expect("catalogMissNotes" in result).toBe(true);
    expect(Array.isArray(result.catalogMissNotes)).toBe(true);
  });

  it("returns empty catalogMissNotes when all args are valid", () => {
    const { catalogMissNotes } = resolveBuilderOptions({
      dataType: "protein",
      align: "muscle",
      trim: "clipkit",
      infer: "raxml",
      support: "bootstrap",
    });
    expect(catalogMissNotes).toEqual([]);
  });

  it("returns DEFAULT_OPTIONS and empty arrays when called with no args", () => {
    const { options, defaulted, catalogMissNotes } = resolveBuilderOptions({});
    expect(options).toEqual(DEFAULT_OPTIONS);
    expect(defaulted).toEqual([]);
    expect(catalogMissNotes).toEqual([]);
  });
});
