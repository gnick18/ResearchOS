/**
 * datahub/chain-code.ts
 *
 * Lineage-aware code export for Data Hub. The Code button on any artifact (a
 * derived table, an analysis result, or a figure) emits ONE commented Python
 * script that reproduces the WHOLE chain, from the BASE table(s) through every
 * transform, the analysis, and the graph, not just the final step. This is the
 * transparency differentiator pushed all the way down: a reader sees base table
 * to transforms to analysis to graph in one runnable script.
 *
 * COMPOSITION (not reimplementation): the per-step emitters are reused as is.
 * The data-prep block comes from transform/codegen.ts (recipeToPandas), the
 * analysis math from show-code.ts (showCode), and the figure from plot-code.ts
 * (plotCode). We do NOT change any of their per-step output; we walk the lineage,
 * gather imports to the top, number the steps, and stitch the blocks together.
 *
 * The base values are inlined ONCE as the data-prep DataFrame. The analysis /
 * plot blocks still inline the FINAL group values they operate on (that is the
 * emitters' unchanged contract, and it keeps each block runnable on its own), so
 * the script carries the base table as a DataFrame plus the analysis / figure as
 * the same standalone snippet, joined by step comments.
 *
 * LINEAGE WALK: a derived table carries meta.derivedFrom (sources + recipe, or
 * the legacy single-op shape resolveRecipe normalizes). An analysis references
 * its source table (the open doc). A figure (PlotSpec.source) references a table
 * and optionally an analysis on it. We resolve any table's raw stored content by
 * id (the resolver), so a base entered table inlines its data and a derived table
 * inlines its base plus its transforms.
 *
 * Async because resolving a source table's content is async. Pure otherwise (no
 * DOM); the caller passes a resolver that reads dataHubApi.getContent.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type {
  AnalysisSpec,
  DataHubDocContent,
  PlotSpec,
} from "@/lib/datahub/model/types";
import { resolveRecipe } from "@/lib/datahub/transform/recipe";
import {
  recipeToPandas,
  tableToDataFrame,
  type RecipeSource,
} from "@/lib/datahub/transform/codegen";
import type { TransformOp } from "@/lib/datahub/transform/pipeline";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import { showCode } from "@/lib/datahub/show-code";
import { plotCode } from "@/lib/datahub/plot-code";
import { readPlotSource } from "@/lib/datahub/plot-spec";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Resolve a table's RAW stored content by id (its derivedFrom link plus the
 *  last-computed snapshot), or null when the table is gone. The page passes
 *  dataHubApi.getContent. Raw content, not recomputed, is what we want here so a
 *  derived table still exposes its derivedFrom link to walk. */
export type ContentResolver = (
  tableId: string,
) => Promise<DataHubDocContent | null>;

/** The artifact a Code button belongs to. */
export type ChainArtifact =
  | { kind: "table"; tableId: string; content: DataHubDocContent }
  | {
      kind: "analysis";
      tableId: string;
      content: DataHubDocContent;
      analysis: AnalysisSpec;
    }
  | {
      kind: "figure";
      tableId: string;
      content: DataHubDocContent;
      plot: PlotSpec;
    };

// ---------------------------------------------------------------------------
// Lineage of one table (base data + flattened transform recipe)
// ---------------------------------------------------------------------------

interface TableLineage {
  /** The true base PRIMARY content (an entered table with no derivedFrom). */
  base: DataHubDocContent | null;
  /** The flattened recipe from the base primary up to the requested table. */
  recipe: TransformOp[];
  /** Every secondary source (join / union) referenced anywhere in the chain. */
  secondary: RecipeSource[];
  /** True when the requested table is derived (carries a recipe at all). */
  derived: boolean;
  /** True when a source in the chain could not be resolved (missing / deleted). */
  missingSource: boolean;
}

/**
 * Walk a table's primary lineage to its base, flattening nested derivations into
 * one recipe. The engine runs recipes sequentially, so concatenating a parent's
 * recipe before a child's reproduces the same final table. Secondary (join /
 * union) sources are collected with their current content inlined; if a secondary
 * source is itself derived, we inline its last-computed snapshot (valid data)
 * rather than recursively expanding every branch, keeping the script bounded
 * while still numerically faithful.
 */
async function walkTableLineage(
  tableId: string,
  resolve: ContentResolver,
  seen: Set<string> = new Set(),
): Promise<TableLineage> {
  if (seen.has(tableId)) {
    // Defensive cycle guard (a corrupt self-referential link); stop the walk.
    return { base: null, recipe: [], secondary: [], derived: false, missingSource: true };
  }
  seen.add(tableId);

  const content = await resolve(tableId);
  if (!content) {
    return { base: null, recipe: [], secondary: [], derived: false, missingSource: true };
  }

  const link = content.meta.derivedFrom;
  const resolved = link ? resolveRecipe(link) : null;
  if (!link || !resolved) {
    // A base entered table (or a corrupt link we treat as base): it IS the base.
    return { base: content, recipe: [], secondary: [], derived: false, missingSource: false };
  }

  // Recurse into the primary source so a derived-of-derived flattens correctly.
  const primaryId = resolved.sources[0];
  const inner = await walkTableLineage(primaryId, resolve, seen);

  // Collect every secondary source this recipe references (sources[1..]).
  const secondary: RecipeSource[] = [...inner.secondary];
  let missingSource = inner.missingSource;
  for (const id of resolved.sources.slice(1)) {
    if (secondary.some((s) => s.id === id)) continue;
    const sc = await resolve(id);
    if (!sc) {
      missingSource = true;
      continue;
    }
    secondary.push({ id, content: sc });
  }

  return {
    base: inner.base,
    recipe: [...inner.recipe, ...resolved.recipe],
    secondary,
    derived: true,
    missingSource,
  };
}

// ---------------------------------------------------------------------------
// Import gathering + header
// ---------------------------------------------------------------------------

/**
 * Pull every `import ...` / `from ... import ...` line out of an emitted block,
 * returning the block with those lines removed and the imports collected. The
 * per-step emitters each open with their own imports; the chain hoists them to
 * one import header at the top so the stitched script imports once.
 */
function extractImports(block: string): { imports: string[]; body: string } {
  const imports: string[] = [];
  const bodyLines: string[] = [];
  for (const line of block.split("\n")) {
    const t = line.trim();
    if (t.startsWith("import ") || t.startsWith("from ")) {
      imports.push(t);
    } else {
      bodyLines.push(line);
    }
  }
  return { imports, body: trimBlank(bodyLines).join("\n") };
}

/** Drop leading and trailing blank lines from a list of lines. */
function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** Dedupe imports while preserving first-seen order. */
function dedupeImports(all: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of all) {
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  return out;
}

/** The script header (the why line, the chain summary). */
function scriptHeader(summary: string): string {
  return [
    "# Reproducible chain for this Data Hub artifact.",
    `# ${summary}`,
    "# Paste this into a notebook to reproduce the whole chain from the base table",
    "# through every transform, the analysis, and the figure. Nothing is hidden.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Block assembly
// ---------------------------------------------------------------------------

/** A numbered, commented step block (its imports already extracted). */
interface StepBlock {
  comment: string;
  body: string;
}

/**
 * Stitch the header, the hoisted imports, and the numbered step blocks into one
 * script. Steps that already carry their own inner "# Step N" comments (the
 * data-prep block) are passed through as is; single blocks (analysis, figure)
 * get a "# Step N, ..." banner.
 */
function assembleScript(
  summary: string,
  imports: string[],
  prepBody: string | null,
  prepStepCount: number,
  tailBlocks: StepBlock[],
): string {
  const parts: string[] = [];
  parts.push(scriptHeader(summary));
  parts.push("");
  if (imports.length) {
    parts.push(dedupeImports(imports).join("\n"));
    parts.push("");
  }
  if (prepBody && prepBody.trim() !== "") {
    parts.push(prepBody);
    parts.push("");
  }
  let step = prepStepCount + 1;
  for (const b of tailBlocks) {
    parts.push(`# Step ${step}, ${b.comment}`);
    parts.push(b.body);
    parts.push("");
    step += 1;
  }
  return trimBlank(parts.join("\n").split("\n")).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// The data-prep block for a table's lineage (shared by all three artifact kinds)
// ---------------------------------------------------------------------------

interface PrepResult {
  /** The data-prep body (imports already extracted), or null for an entered base
   *  table with no transforms (no prep block needed, the emitter inlines it). */
  body: string | null;
  /** The pandas imports the prep needs. */
  imports: string[];
  /** How many numbered steps the prep block occupies (for tail numbering). */
  stepCount: number;
  /** True when a source could not be resolved. */
  missingSource: boolean;
  /** True when the table is derived (so the prep block is meaningful). */
  derived: boolean;
}

/**
 * Build the lineage data-prep block for a table. For a DERIVED table this is the
 * inline base data plus every transform, numbered from Step 1. For an ENTERED
 * table there is no prep block (the analysis / plot emitter inlines the data
 * itself), so body is null and stepCount is 0; the figure / analysis path still
 * prepends a one-step data-load preamble when it wants the table as a DataFrame.
 */
async function buildPrep(
  tableId: string,
  resolve: ContentResolver,
): Promise<PrepResult> {
  const lineage = await walkTableLineage(tableId, resolve);
  if (!lineage.base) {
    // No base content. Either a true base table that itself failed to resolve, or
    // a derived table whose primary source is gone. Keep the derived flag so the
    // caller can show the right note, but there is no prep body to emit.
    return {
      body: null,
      imports: [],
      stepCount: 0,
      missingSource: lineage.missingSource,
      derived: lineage.derived,
    };
  }
  const sources: RecipeSource[] = [
    { id: lineage.base.meta.id, content: lineage.base },
    ...lineage.secondary,
  ];
  const prep = recipeToPandas(sources, lineage.recipe, { startStep: 1 });
  const { imports, body } = extractImports(prep.code);
  // The number of "# Step N," lines in the prep body is its step count.
  const stepCount = (body.match(/^# Step \d+,/gm) ?? []).length;
  return {
    body,
    imports: [...prep.imports, ...imports],
    stepCount,
    missingSource: lineage.missingSource,
    derived: true,
  };
}

/** A one-step data-load preamble for an ENTERED source table, so an analysis /
 *  figure script opens with the base table as a DataFrame even when no transform
 *  ran. Returns the body (no imports inlined) and the pandas import. */
function enteredPreamble(content: DataHubDocContent): {
  body: string;
  imports: string[];
} {
  const body = [
    "# Step 1, load the base data",
    tableToDataFrame(content, "df"),
  ].join("\n");
  return { body, imports: ["import pandas as pd"] };
}

// ---------------------------------------------------------------------------
// Public entry: one artifact -> the whole chain script
// ---------------------------------------------------------------------------

/**
 * The lineage-aware Code export for any artifact. Walks the lineage and returns
 * ONE commented runnable Python script (base table to transforms to analysis to
 * graph). Missing sources degrade gracefully (the available steps still emit with
 * a note); a legacy single-op recipe is handled by resolveRecipe upstream.
 */
export async function chainCode(
  artifact: ChainArtifact,
  resolve: ContentResolver,
): Promise<string> {
  if (artifact.kind === "table") {
    return tableChain(artifact.content, resolve);
  }
  if (artifact.kind === "analysis") {
    return analysisChain(artifact.content, artifact.analysis, resolve);
  }
  return figureChain(artifact.content, artifact.plot, resolve);
}

// --- Derived table -------------------------------------------------------

async function tableChain(
  content: DataHubDocContent,
  resolve: ContentResolver,
): Promise<string> {
  const prep = await buildPrep(content.meta.id, resolve);
  if (!prep.derived) {
    // A base entered table has nothing to reproduce beyond its own data; emit the
    // data-load preamble so the export is still a runnable DataFrame.
    const pre = enteredPreamble(content);
    return assembleScript(
      "This is a base table; the script loads its data.",
      pre.imports,
      pre.body,
      1,
      [],
    );
  }
  if (!prep.body) {
    // Derived, but its source(s) could not be resolved, so there is no base data
    // to inline. Emit the note and the table's last-computed snapshot as a
    // fallback DataFrame so the export is not empty.
    const pre = enteredPreamble(content);
    return assembleScript(
      "A source could not be resolved, so the transforms cannot be reproduced; the last computed result is loaded instead.",
      pre.imports,
      pre.body,
      1,
      [],
    );
  }
  const note = prep.missingSource
    ? "One source could not be resolved, so some steps may be incomplete."
    : "Loads the base data and runs every transform that produced this table.";
  return assembleScript(note, prep.imports, prep.body, prep.stepCount, []);
}

// --- Analysis ------------------------------------------------------------

async function analysisChain(
  tableContent: DataHubDocContent,
  analysis: AnalysisSpec,
  resolve: ContentResolver,
): Promise<string> {
  // The analysis runs on the OPEN table's live content (the same content the
  // ResultsSheet computes from), so the inlined values match the on-screen
  // numbers. The lineage prep reproduces how that table was built.
  const outcome = runAnalysis(analysis, tableContent);
  const analysisBlock = outcome.ok
    ? showCode(outcome)
    : "# This analysis cannot run on the current table, so no code is emitted.\n" +
      `# Reason: ${outcome.error}`;
  const { imports: aImports, body: aBody } = extractImports(analysisBlock);
  const analysisLabel = labelForAnalysis(analysis);

  const prep = await buildPrep(tableContent.meta.id, resolve);
  if (prep.derived && prep.body) {
    return assembleScript(
      "Base data to transforms to the analysis.",
      [...prep.imports, ...aImports],
      prep.body,
      prep.stepCount,
      [{ comment: `run the ${analysisLabel}`, body: aBody }],
    );
  }
  // Entered source: a one-step data-load preamble, then the analysis.
  const pre = enteredPreamble(tableContent);
  return assembleScript(
    "Loads the data, then runs the analysis.",
    [...pre.imports, ...aImports],
    pre.body,
    1,
    [{ comment: `run the ${analysisLabel}`, body: aBody }],
  );
}

// --- Figure --------------------------------------------------------------

async function figureChain(
  tableContent: DataHubDocContent,
  plot: PlotSpec,
  resolve: ContentResolver,
): Promise<string> {
  const source = readPlotSource(plot);
  // A figure draws a result only when it links an analysis on the table.
  const analysis =
    source.analysisId != null
      ? tableContent.analyses.find((a) => a.id === source.analysisId) ?? null
      : null;

  const tailBlocks: StepBlock[] = [];
  const tailImports: string[] = [];

  if (analysis) {
    const outcome = runAnalysis(analysis, tableContent);
    if (outcome.ok) {
      const { imports, body } = extractImports(showCode(outcome));
      tailImports.push(...imports);
      tailBlocks.push({
        comment: `run the ${labelForAnalysis(analysis)} the figure annotates`,
        body,
      });
    }
  }

  const plotBlock = plotCode(plot, tableContent, analysis);
  const { imports: pImports, body: pBody } = extractImports(plotBlock);
  tailImports.push(...pImports);
  tailBlocks.push({ comment: "make the figure", body: pBody });

  const prep = await buildPrep(tableContent.meta.id, resolve);
  if (prep.derived && prep.body) {
    return assembleScript(
      "Base data to transforms" +
        (analysis ? " to the analysis to the figure." : " to the figure."),
      [...prep.imports, ...tailImports],
      prep.body,
      prep.stepCount,
      tailBlocks,
    );
  }
  // Entered source: the data-load preamble, then (analysis,) then the figure.
  const pre = enteredPreamble(tableContent);
  return assembleScript(
    "Loads the data, then" +
      (analysis ? " runs the analysis and makes the figure." : " makes the figure."),
    [...pre.imports, ...tailImports],
    pre.body,
    1,
    tailBlocks,
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** A readable analysis name for the step comment (the rail name, else the type). */
function labelForAnalysis(analysis: AnalysisSpec): string {
  if (analysis.name && analysis.name.trim() !== "") return analysis.name.trim();
  const map: Record<string, string> = {
    unpairedTTest: "unpaired t-test",
    pairedTTest: "paired t-test",
    oneWayAnova: "one-way ANOVA",
    twoWayAnova: "two-way ANOVA",
    mannWhitneyU: "Mann-Whitney U test",
    wilcoxonSignedRank: "Wilcoxon signed-rank test",
    kruskalWallis: "Kruskal-Wallis test",
    repeatedMeasuresAnova: "repeated-measures ANOVA",
    linearMixedModel: "linear mixed model",
    correlationPearson: "Pearson correlation",
    correlationSpearman: "Spearman correlation",
    linearRegression: "linear regression",
    rocCurve: "ROC curve and AUC",
    kaplanMeier: "Kaplan-Meier survival analysis",
    coxRegression: "Cox proportional hazards regression",
    grubbsOutlier: "Grubbs outlier test",
    contingency: "chi-square test of independence",
  };
  return map[analysis.type] ?? "analysis";
}
