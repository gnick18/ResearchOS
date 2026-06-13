// BeakerBot phylogenetics read tools (BeakerAI lane, 2026-06-12).
//
// Read-only access to the user's saved phylogenetic trees, plus the markdown
// BeakerBot emits to SHOW a tree as a chat card. The /phylo embed + deep-link are
// BUILT and frozen by the Phylogenetics lane (docs/proposals/2026-06-12-beakerbot-
// phylo-contract.md): ObjectEmbed dispatches phylo -> PhyloEmbed, and a reference
// to /phylo?doc=<id> opens the saved tree in the Tree Studio. So all BeakerBot
// needs is to FIND a tree (these tools) and emit the card link.
//
// Also contains generate_tree: given the user's analysis choices (as BuilderOptions
// field values), calls generateRecipe and returns the full runnable recipe text.
// The tool is READ-ONLY (no side effects, no compute, no server calls) and follows
// the hard rule from the contract: it only fills BuilderOptions from the catalog and
// calls generateRecipe. The generator owns every flag. BeakerBot never writes a flag.
//
// Constraints from the contract (do not violate): consume READ-ONLY, never write
// or invent a tree / tip count / flag, no compute or inference. Building a tree
// from a wizard stays navigate + guide until the Phylogenetics lane re-relays the
// frozen BuilderOptions + catalog.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { phyloApi, type PhyloMeta } from "@/lib/phylo/api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import type { AiTool } from "./types";
import {
  DEFAULT_OPTIONS,
  DATA_TYPES,
  ANALYSIS,
  HAVE_INPUTS,
  ALIGN_TOOLS,
  TRIM_TOOLS,
  PART_SCHEMES,
  BRLEN_MODES,
  MODEL_CHOICES,
  INFER_TOOLS,
  SUPPORT_CHOICES,
  OS_CHOICES,
  type BuilderOptions,
  type DataType,
  type Analysis,
  type HaveInput,
  type AlignTool,
  type TrimTool,
  type PartScheme,
  type BrlenMode,
  type ModelChoice,
  type InferTool,
  type SupportChoice,
  type OSChoice,
} from "@/lib/phylo/catalog";
import { generateRecipe } from "@/lib/phylo/recipe";

// The markdown that renders a saved tree as a self-contained card in chat (the
// #ros=studio fragment makes the embed pipeline draw the figure). Exported pure
// for tests and so the description and the tools agree on one format.
export function treeCardEmbed(meta: { id: string; name: string }): string {
  return `[${meta.name || "Tree"}](/phylo?doc=${meta.id}#ros=studio)`;
}

// Injectable seam so the tools are unit-testable without a real folder.
export type PhyloToolsDeps = {
  listTrees: () => Promise<PhyloMeta[]>;
  navigate: (path: string) => void;
};

export const phyloToolsDeps: PhyloToolsDeps = {
  listTrees: () => phyloApi.list(),
  navigate: requestNavigation,
};

/** Resolve a tree reference (a stable string id or a case-insensitive name) to a
 *  PhyloMeta, or null. Pure. */
export function resolveTree(trees: PhyloMeta[], ref: string | undefined): PhyloMeta | null {
  if (!ref) return null;
  const r = ref.trim();
  const byId = trees.find((t) => t.id === r);
  if (byId) return byId;
  const lower = r.toLowerCase();
  return trees.find((t) => (t.name ?? "").trim().toLowerCase() === lower) ?? null;
}

/** The compact per-tree shape the model relays. The embed is the markdown to
 *  show the figure as a card. */
function briefOf(meta: PhyloMeta) {
  return {
    id: meta.id,
    name: meta.name || "Untitled tree",
    tips: meta.tip_count ?? null,
    projectIds: meta.project_ids ?? [],
    addedAt: meta.added_at ?? null,
    embed: treeCardEmbed(meta),
  };
}

export const listPhyloTreesTool: AiTool = {
  name: "list_phylo_trees",
  description:
    "List the user's saved phylogenetic trees (the Phylogenetics page / Tree Studio). Use this when the user asks what trees they have, to find a tree by name, or before showing one. Returns each tree's id, name, tip count, and a ready-to-use embed markdown. To SHOW a tree to the user, end your reply with that tree's embed on its own line, the markdown [<name>](/phylo?doc=<id>#ros=studio), which renders the figure as a card in the chat. This is read-only, it changes nothing. You never invent a tree, a tip count, or a tree id, only repeat what this returns. To BUILD a new tree, you cannot do it programmatically yet, so guide the user to the Phylogenetics page instead (go_to_page).",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => {
    try {
      const trees = await phyloToolsDeps.listTrees();
      return { ok: true as const, count: trees.length, trees: trees.map(briefOf) };
    } catch {
      return { ok: false as const, error: "I could not read your saved trees. A folder may not be connected." };
    }
  },
};

export const readPhyloTreeTool: AiTool = {
  name: "read_phylo_tree",
  description:
    "Read one of the user's saved phylogenetic trees by name or id, to answer a question about it or to show it. Call list_phylo_trees first if you do not have the id. Returns the tree's name, tip count, projects, and the embed markdown. To show it, end your reply with the returned embed on its own line. Read-only, you never invent a tip count or any detail. To build or restyle a tree, guide the user to the Phylogenetics page, you cannot do it programmatically yet.",
  parameters: {
    type: "object",
    properties: {
      tree: {
        type: "string",
        description: "The tree to read, by its name or its stable id, from a list_phylo_trees result.",
      },
    },
    required: ["tree"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const ref = typeof args.tree === "string" ? args.tree : undefined;
    let trees: PhyloMeta[];
    try {
      trees = await phyloToolsDeps.listTrees();
    } catch {
      return { ok: false as const, error: "I could not read your saved trees. A folder may not be connected." };
    }
    const meta = resolveTree(trees, ref);
    if (!meta) {
      const names = trees.map((t) => `"${t.name}"`).join(", ");
      return {
        ok: false as const,
        error: `I could not find a tree called "${ref}". Your trees are: ${names || "(none yet)"}.`,
      };
    }
    return { ok: true as const, tree: briefOf(meta) };
  },
};

// ---------------------------------------------------------------------------
// generate_tree
// ---------------------------------------------------------------------------
//
// Resolves the user's plain-language analysis choices into a validated
// BuilderOptions (catalog values only), calls generateRecipe, and returns the
// full runnable recipe. Read-only: no side effects, no compute, no writes.
//
// Validation strategy: for each finite-union field, check that the provided
// value exists in its catalog option list. Out-of-catalog values are silently
// replaced with the DEFAULT_OPTIONS value and reported in `defaulted` so the
// model can tell the user what changed. Free-text fields (outgroup, fixedModel,
// threads) are accepted as-is; numeric fields (ufbootReps, bsReps) are coerced
// to positive integers or replaced with the default.

/** Validate one finite-union field against its catalog. Returns the coerced
 *  value plus a boolean indicating whether it was ACTIVELY rejected (i.e. the
 *  caller supplied a value but it was not in the catalog). Absent fields
 *  (undefined) fall back silently without being marked as defaulted. */
function pickEnum<T extends string>(
  candidate: unknown,
  valid: readonly { value: T }[],
  fallback: T,
): { value: T; defaulted: boolean } {
  if (candidate === undefined || candidate === null) {
    // Not supplied at all: silent fallback.
    return { value: fallback, defaulted: false };
  }
  if (typeof candidate === "string" && valid.some((o) => o.value === candidate)) {
    return { value: candidate as T, defaulted: false };
  }
  // Supplied but not a valid catalog value: report as defaulted.
  return { value: fallback, defaulted: true };
}

/** Coerce a candidate to a positive integer, or fall back. Absent candidates
 *  fall back silently; present-but-invalid candidates are reported. */
function pickPositiveInt(candidate: unknown, fallback: number): { value: number; defaulted: boolean } {
  if (candidate === undefined || candidate === null) {
    return { value: fallback, defaulted: false };
  }
  const n = typeof candidate === "number" ? candidate : Number(candidate);
  if (Number.isFinite(n) && n > 0 && Number.isInteger(n)) {
    return { value: n, defaulted: false };
  }
  return { value: fallback, defaulted: true };
}

/** Resolve args into a fully-validated BuilderOptions, overlaid on DEFAULT_OPTIONS.
 *  Returns the resolved options plus a list of field names that fell back to the
 *  default because the supplied value was out-of-catalog. Exported for tests. */
export function resolveBuilderOptions(args: Record<string, unknown>): {
  options: BuilderOptions;
  defaulted: string[];
} {
  const defaulted: string[] = [];

  function track<T>(field: string, result: { value: T; defaulted: boolean }): T {
    if (result.defaulted) defaulted.push(field);
    return result.value;
  }

  const dataType = track("dataType", pickEnum(args.dataType, DATA_TYPES, DEFAULT_OPTIONS.dataType));
  const analysis = track("analysis", pickEnum(args.analysis, ANALYSIS, DEFAULT_OPTIONS.analysis));
  const have = track("have", pickEnum(args.have, HAVE_INPUTS, DEFAULT_OPTIONS.have));
  const align = track("align", pickEnum(args.align, ALIGN_TOOLS, DEFAULT_OPTIONS.align));
  const trim = track("trim", pickEnum(args.trim, TRIM_TOOLS, DEFAULT_OPTIONS.trim));
  const partScheme = track("partScheme", pickEnum(args.partScheme, PART_SCHEMES, DEFAULT_OPTIONS.partScheme));
  const brlen = track("brlen", pickEnum(args.brlen, BRLEN_MODES, DEFAULT_OPTIONS.brlen));
  const model = track("model", pickEnum(args.model, MODEL_CHOICES, DEFAULT_OPTIONS.model));
  const infer = track("infer", pickEnum(args.infer, INFER_TOOLS, DEFAULT_OPTIONS.infer));
  const support = track("support", pickEnum(args.support, SUPPORT_CHOICES, DEFAULT_OPTIONS.support));
  const os = track("os", pickEnum(args.os, OS_CHOICES, DEFAULT_OPTIONS.os));

  // Free-text fields: accept any string or fall back to the default.
  const fixedModel =
    typeof args.fixedModel === "string" && args.fixedModel.trim()
      ? args.fixedModel.trim()
      : DEFAULT_OPTIONS.fixedModel;
  const outgroup =
    typeof args.outgroup === "string" ? args.outgroup : DEFAULT_OPTIONS.outgroup;

  // threads: "AUTO" or a positive integer as string.
  let threads = DEFAULT_OPTIONS.threads;
  if (typeof args.threads === "string") {
    const t = args.threads.trim();
    if (t.toUpperCase() === "AUTO") {
      threads = "AUTO";
    } else {
      const n = Number(t);
      if (Number.isFinite(n) && n > 0 && Number.isInteger(n)) {
        threads = t;
      } else {
        defaulted.push("threads");
      }
    }
  }

  // Boolean fields.
  const bnni = typeof args.bnni === "boolean" ? args.bnni : DEFAULT_OPTIONS.bnni;
  const asc = typeof args.asc === "boolean" ? args.asc : DEFAULT_OPTIONS.asc;
  const restrictModels =
    typeof args.restrictModels === "boolean" ? args.restrictModels : DEFAULT_OPTIONS.restrictModels;

  // Numeric rep counts.
  const ufbootReps = track(
    "ufbootReps",
    pickPositiveInt(args.ufbootReps, DEFAULT_OPTIONS.ufbootReps),
  );
  const bsReps = track(
    "bsReps",
    pickPositiveInt(args.bsReps, DEFAULT_OPTIONS.bsReps),
  );

  const options: BuilderOptions = {
    dataType,
    analysis,
    have,
    align,
    trim,
    partScheme,
    brlen,
    model,
    fixedModel,
    infer,
    support,
    outgroup,
    os,
    bnni,
    ufbootReps,
    bsReps,
    asc,
    restrictModels,
    threads,
  };

  return { options, defaulted };
}

export const generateTreeTool: AiTool = {
  name: "generate_tree",
  description: `Generate a runnable phylogenetics analysis recipe from the user's chosen options. Call this when the user says things like "generate a tree-building pipeline", "what commands do I run to build a tree with IQ-TREE GTR+G and UFBoot", "make me a RAxML recipe", "build me a phylogenetics workflow", or "how do I run a coalescent species tree". It returns a complete recipe the user runs themselves on their own machine (no server compute, no tree is built here). The recipe includes the ordered shell commands, the OS-specific install steps (Miniforge + conda env), a conda environment.yml pinning every tool, a run.sh script, and a full markdown document combining all of the above. Surface the recipe's markdown and runScript to the user. You MUST NOT fabricate any command, flag, or model name. Only the generateRecipe generator is authoritative. This tool is read-only: it changes nothing in the user's folder.`,
  parameters: {
    type: "object",
    properties: {
      dataType: {
        type: "string",
        enum: ["nucleotide", "protein"],
        description: "The sequence data type. nucleotide for DNA or RNA; protein for amino-acid sequences. Default: nucleotide.",
      },
      analysis: {
        type: "string",
        enum: ["single", "supermatrix", "coalescent"],
        description: "The analysis type. single for one gene or region (one tree); supermatrix for many genes concatenated into a partitioned alignment (one ML tree); coalescent for per-gene trees summarized with ASTRAL (a species tree). Default: single.",
      },
      have: {
        type: "string",
        enum: ["raw", "alignment", "library"],
        description: "What the user already has. raw = unaligned FASTA (start with alignment); alignment = already-aligned input (skip alignment); library = sequences from the ResearchOS library (export to FASTA first). Default: raw.",
      },
      align: {
        type: "string",
        enum: ["mafft", "muscle", "clustalo", "skip"],
        description: "The alignment tool. mafft (auto mode); muscle (MUSCLE5, high accuracy); clustalo (Clustal Omega, scales well); skip (use the input as-is). Default: mafft.",
      },
      trim: {
        type: "string",
        enum: ["trimal", "clipkit", "gblocks", "skip"],
        description: "The alignment-trimming tool. trimal (removes poorly aligned columns); clipkit (keeps informative sites); gblocks (conservative blocks); skip (infer from the full alignment). Default: trimal.",
      },
      partScheme: {
        type: "string",
        enum: ["gene", "gene_codon", "merge"],
        description: "Partition scheme for supermatrix analyses. gene = one model per gene; gene_codon = split coding genes into 1st/2nd/3rd codon positions; merge = let ModelFinder collapse partitions that fit alike. Only used when analysis is supermatrix. Default: gene.",
      },
      brlen: {
        type: "string",
        enum: ["p", "q", "Q"],
        description: "Branch-length mode for supermatrix analyses. p = edge-linked proportional (recommended); q = edge-equal (all partitions share branch lengths); Q = edge-unlinked (each partition its own branch lengths). Only used when analysis is supermatrix. Default: p.",
      },
      model: {
        type: "string",
        enum: ["modelfinder", "fixed"],
        description: "Model-selection strategy. modelfinder = IQ-TREE tests models and picks the best fit (-m MFP); fixed = use the model named in fixedModel. Default: modelfinder.",
      },
      fixedModel: {
        type: "string",
        description: "The substitution model to use when model is fixed. Common nucleotide presets: GTR+G, GTR+I+G, GTR+R4, HKY+G, TN93+G, K80+G, SYM+G, JC. Common protein presets: LG+G, LG+I+G, LG+G+F, WAG+G, JTT+G, Dayhoff+G, Blosum62+G, Q.pfam+G. Free text is accepted. Default: GTR+G.",
      },
      infer: {
        type: "string",
        enum: ["iqtree", "raxml", "fasttree", "mrbayes"],
        description: "The tree-inference tool. iqtree = IQ-TREE 2 (ML, common default); raxml = RAxML-NG (ML, fast on large datasets); fasttree = FastTree (approximate, scales to thousands of taxa); mrbayes = MrBayes (Bayesian, posterior support). Supermatrix always uses IQ-TREE regardless of this setting. MrBayes is replaced by IQ-TREE per gene in coalescent mode. Default: iqtree.",
      },
      support: {
        type: "string",
        enum: ["ufboot", "bootstrap", "none"],
        description: "Branch-support method. ufboot = UFBoot2 + SH-aLRT (fast, the IQ-TREE default); bootstrap = standard nonparametric bootstrap (slower); none = single tree with no support values. Default: ufboot.",
      },
      outgroup: {
        type: "string",
        description: "Taxon name to use as the outgroup for rooting (IQ-TREE and RAxML paths only). Pass an empty string or omit to skip outgroup rooting. Default: no outgroup.",
      },
      os: {
        type: "string",
        enum: ["mac", "windows", "linux"],
        description: "The user's operating system, for the install steps. mac = macOS (Miniforge via Homebrew); windows = Windows (run under WSL2/Ubuntu); linux = Linux (Miniforge installer). Default: mac.",
      },
      bnni: {
        type: "boolean",
        description: "When true, adds --bnni to the UFBoot command (reduces overestimation of branch support). Only applies when support is ufboot. Default: true.",
      },
      ufbootReps: {
        type: "number",
        description: "Number of UFBoot replicates. Only applies when support is ufboot. Default: 1000.",
      },
      bsReps: {
        type: "number",
        description: "Number of standard bootstrap replicates. Only applies when support is bootstrap. Default: 1000.",
      },
      asc: {
        type: "boolean",
        description: "When true, adds the ascertainment bias correction +ASC to the model string (for SNP-only alignments where invariant sites are absent). Default: false.",
      },
      restrictModels: {
        type: "boolean",
        description: "When true, restricts ModelFinder to a common model set (-mset GTR,HKY,K80,JC for nucleotide; -mset LG,WAG,JTT for protein), which speeds up the search. Default: false.",
      },
      threads: {
        type: "string",
        description: "Thread count for IQ-TREE (-T) and RAxML (--threads). Pass AUTO to let the tool detect the best count, or a positive integer as a string. Default: AUTO.",
      },
    },
    additionalProperties: false,
  },
  // No `action` or `previewable` flag: this tool is purely read-only.
  execute: async (args) => {
    try {
      const { options, defaulted } = resolveBuilderOptions(args);
      const recipe = generateRecipe(options);
      return {
        ok: true as const,
        recipe,
        optionsUsed: options,
        defaulted,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, error: `Recipe generation failed: ${msg}` };
    }
  },
};
