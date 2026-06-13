// Regression tests: generate_tree recipe output against the three real,
// validated phylogenetics builder-options fixtures authored by the phylo lane.
//
// Each fixture is a published-validation BuilderOptions JSON committed under
// frontend/src/lib/transparency/datasets/phylo-published/. The tests call
// generateRecipe directly (the same pure function generate_tree uses) and
// lock the recipe shape so no future catalog or generator edit silently breaks
// the contract for these three analysis shapes.
//
// Shapes covered:
//   hpv58         -- single-locus nucleotide, raw input, MAFFT + trimAl + IQ-TREE
//   turtle        -- concatenated supermatrix, pre-aligned, IQ-TREE + partition file
//   firefly_opsin -- single-gene protein, pre-aligned, IQ-TREE (LG family)
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { generateRecipe } from "@/lib/phylo/recipe";
import type { BuilderOptions } from "@/lib/phylo/catalog";

import hpv58Raw from "@/lib/transparency/datasets/phylo-published/hpv58/builder-options.json";
import turtleRaw from "@/lib/transparency/datasets/phylo-published/turtle/builder-options.json";
import fireflyRaw from "@/lib/transparency/datasets/phylo-published/firefly_opsin/builder-options.json";

// Cast once so TypeScript is happy and every test below stays clean.
const hpv58: BuilderOptions = hpv58Raw as BuilderOptions;
const turtle: BuilderOptions = turtleRaw as BuilderOptions;
const firefly: BuilderOptions = fireflyRaw as BuilderOptions;

// ---------------------------------------------------------------------------
// Shared coherence helper
// ---------------------------------------------------------------------------

/** Assert that every field of RecipeOutput is non-empty. */
function assertCoherent(recipe: ReturnType<typeof generateRecipe>, label: string) {
  expect(recipe.commands.trim().length, `${label}: commands must be non-empty`).toBeGreaterThan(0);
  expect(recipe.install.trim().length, `${label}: install must be non-empty`).toBeGreaterThan(0);
  expect(recipe.envYaml.trim().length, `${label}: envYaml must be non-empty`).toBeGreaterThan(0);
  expect(recipe.runScript.trim().length, `${label}: runScript must be non-empty`).toBeGreaterThan(0);
  expect(recipe.markdown.trim().length, `${label}: markdown must be non-empty`).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// Fixture 1: hpv58 -- single-locus nucleotide, raw input
// ---------------------------------------------------------------------------
//
// BuilderOptions: dataType=nucleotide, analysis=single, have=raw, align=mafft,
// trim=trimal, infer=iqtree, support=ufboot, model=modelfinder, os=mac.
//
// Expected pipeline: MAFFT -> trimAl -> IQ-TREE (MFP, UFBoot + SH-aLRT + --bnni).

describe("hpv58 fixture (single-locus nucleotide, raw input)", () => {
  const recipe = generateRecipe(hpv58);

  it("produces a coherent, non-empty RecipeOutput for every field", () => {
    assertCoherent(recipe, "hpv58");
  });

  it("has the MAFFT alignment step", () => {
    expect(recipe.commands).toContain("mafft --auto input.fasta > alignment.fasta");
    expect(recipe.runScript).toContain("mafft --auto");
  });

  it("has the trimAl trimming step", () => {
    expect(recipe.commands).toContain("trimal -in alignment.fasta -out trimmed.fasta -automated1");
    expect(recipe.runScript).toContain("trimal");
  });

  it("has iqtree2 as the tree-inference step", () => {
    expect(recipe.commands).toContain("iqtree2");
    expect(recipe.runScript).toContain("iqtree2");
  });

  it("uses MFP (ModelFinder) not a fixed model", () => {
    expect(recipe.commands).toContain("-m MFP");
    expect(recipe.commands).not.toContain("-m GTR+G ");
  });

  it("includes UFBoot flags (-B, -alrt) and --bnni", () => {
    expect(recipe.commands).toContain("-B 1000");
    expect(recipe.commands).toContain("-alrt 1000");
    expect(recipe.commands).toContain("-bnni");
  });

  it("includes the correct tool conda pins in envYaml", () => {
    expect(recipe.envYaml).toContain("mafft=");
    expect(recipe.envYaml).toContain("trimal=");
    expect(recipe.envYaml).toContain("iqtree=");
  });

  it("has a macOS Miniforge install block", () => {
    expect(recipe.install).toContain("brew install miniforge");
  });

  it("runScript has a bash shebang and no comment lines", () => {
    expect(recipe.runScript.startsWith("#!/usr/bin/env bash")).toBe(true);
    const body = recipe.runScript.split("\n").slice(2);
    expect(body.some((l) => l.startsWith("# "))).toBe(false);
  });

  it("markdown contains the recipe header and both section headers", () => {
    expect(recipe.markdown).toContain("# Tree-building recipe");
    expect(recipe.markdown).toContain("## 1. Install the tools");
    expect(recipe.markdown).toContain("## 2. Run the pipeline");
  });
});

// ---------------------------------------------------------------------------
// Fixture 2: turtle -- concatenated supermatrix, pre-aligned
// ---------------------------------------------------------------------------
//
// BuilderOptions: dataType=nucleotide, analysis=supermatrix, have=alignment,
// align=skip, trim=skip, partScheme=gene, brlen=p, infer=iqtree (forced),
// support=ufboot, model=modelfinder, outgroup=protopterus,Xenopus, os=mac.
//
// Key contract for the supermatrix pre-aligned case:
//   - have=alignment with align=skip and trim=skip means no per-gene
//     realignment or trimming commands appear in the recipe.
//   - The generator always produces a "partitions.txt" reference in the
//     IQ-TREE command (this is the AMAS output file, not an input file).
//   - IQ-TREE is always used regardless of the infer field.
//   - The outgroup flag (-o protopterus,Xenopus) appears in the IQ-TREE line.

describe("turtle fixture (concatenated supermatrix, pre-aligned)", () => {
  const recipe = generateRecipe(turtle);

  it("produces a coherent, non-empty RecipeOutput for every field", () => {
    assertCoherent(recipe, "turtle");
  });

  it("has iqtree2 as the tree-inference step (forced regardless of infer field)", () => {
    expect(recipe.commands).toContain("iqtree2");
    expect(recipe.runScript).toContain("iqtree2");
  });

  it("references partitions.txt in the IQ-TREE command (the AMAS-generated partition file)", () => {
    // The -p flag always emits partitions.txt for the supermatrix pipeline.
    expect(recipe.commands).toContain("-p partitions.txt");
    expect(recipe.runScript).toContain("partitions.txt");
  });

  it("does NOT emit a mafft, muscle, clustalo, trimal, clipkit, or gblocks command (pre-aligned, no realignment)", () => {
    expect(recipe.commands).not.toContain("mafft");
    expect(recipe.commands).not.toContain("muscle");
    expect(recipe.commands).not.toContain("clustalo");
    expect(recipe.commands).not.toContain("trimal");
    expect(recipe.commands).not.toContain("clipkit");
    expect(recipe.commands).not.toContain("Gblocks");
  });

  it("uses MFP (ModelFinder) for the partitioned model", () => {
    expect(recipe.commands).toContain("-m MFP");
  });

  it("uses edge-linked proportional branch lengths (-p flag before partitions.txt)", () => {
    // The brlen=p fixture produces "iqtree2 -s supermatrix.fasta -p partitions.txt"
    expect(recipe.commands).toContain("iqtree2 -s supermatrix.fasta -p partitions.txt");
  });

  it("includes the outgroup flag with the fixture value (protopterus,Xenopus)", () => {
    expect(recipe.commands).toContain("-o protopterus,Xenopus");
    expect(recipe.runScript).toContain("protopterus,Xenopus");
  });

  it("includes UFBoot flags and --bnni", () => {
    expect(recipe.commands).toContain("-B 1000");
    expect(recipe.commands).toContain("-alrt 1000");
    expect(recipe.commands).toContain("-bnni");
  });

  it("includes amas conda pin in envYaml (needed for supermatrix concat)", () => {
    expect(recipe.envYaml).toContain("amas=");
    expect(recipe.envYaml).toContain("iqtree=");
    // No aligner or trimmer pins because both are skip.
    expect(recipe.envYaml).not.toContain("mafft=");
    expect(recipe.envYaml).not.toContain("trimal=");
  });

  it("does NOT emit raxml-ng (supermatrix always forces IQ-TREE)", () => {
    expect(recipe.commands).not.toContain("raxml-ng");
    expect(recipe.runScript).not.toContain("raxml-ng");
  });

  it("markdown names the analysis as supermatrix and nucleotide", () => {
    expect(recipe.markdown).toContain("supermatrix");
    expect(recipe.markdown).toContain("nucleotide");
  });
});

// ---------------------------------------------------------------------------
// Fixture 3: firefly_opsin -- single-gene protein, pre-aligned
// ---------------------------------------------------------------------------
//
// BuilderOptions: dataType=protein, analysis=single, have=alignment, align=skip,
// trim=skip, infer=iqtree, support=ufboot, model=modelfinder, os=mac.
//
// LG family is documented as the natural choice for protein (fixedModel=LG+G),
// but model=modelfinder means the recipe uses MFP and lets ModelFinder pick.
// The distinction from hpv58 is protein data with no realignment step.

describe("firefly_opsin fixture (single-gene protein, pre-aligned)", () => {
  const recipe = generateRecipe(firefly);

  it("produces a coherent, non-empty RecipeOutput for every field", () => {
    assertCoherent(recipe, "firefly_opsin");
  });

  it("has iqtree2 as the tree-inference step", () => {
    expect(recipe.commands).toContain("iqtree2");
    expect(recipe.runScript).toContain("iqtree2");
  });

  it("does NOT emit any alignment or trimming commands (pre-aligned input)", () => {
    expect(recipe.commands).not.toContain("mafft");
    expect(recipe.commands).not.toContain("muscle");
    expect(recipe.commands).not.toContain("clustalo");
    expect(recipe.commands).not.toContain("trimal");
    expect(recipe.commands).not.toContain("clipkit");
    expect(recipe.commands).not.toContain("Gblocks");
  });

  it("uses MFP (ModelFinder) not a fixed LG model", () => {
    // model=modelfinder in the fixture, so the recipe asks ModelFinder to pick.
    // fixedModel=LG+G is the fallback label but should NOT appear as the -m value.
    expect(recipe.commands).toContain("-m MFP");
    // The fixed fallback string "LG+G" must not appear as the active -m flag.
    expect(recipe.commands).not.toContain("-m LG+G");
  });

  it("uses protein-type infer input filename (input_alignment.fasta) not the nucleotide raw name", () => {
    // have=alignment means the single-locus path uses input_alignment.fasta.
    expect(recipe.commands).toContain("input_alignment.fasta");
    expect(recipe.commands).not.toContain("input.fasta");
  });

  it("includes UFBoot flags and --bnni for protein data", () => {
    expect(recipe.commands).toContain("-B 1000");
    expect(recipe.commands).toContain("-alrt 1000");
    expect(recipe.commands).toContain("-bnni");
  });

  it("pins iqtree in envYaml but no aligner or trimmer pins (both are skip)", () => {
    expect(recipe.envYaml).toContain("iqtree=");
    expect(recipe.envYaml).not.toContain("mafft=");
    expect(recipe.envYaml).not.toContain("trimal=");
  });

  it("markdown names the analysis as single and protein", () => {
    expect(recipe.markdown).toContain("single");
    expect(recipe.markdown).toContain("protein");
  });

  it("runScript has a bash shebang and no comment lines", () => {
    expect(recipe.runScript.startsWith("#!/usr/bin/env bash")).toBe(true);
    const body = recipe.runScript.split("\n").slice(2);
    expect(body.some((l) => l.startsWith("# "))).toBe(false);
  });
});
