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
import type { RawPhyloFiles } from "@/lib/phylo/phylo-store";
import type {
  PhyloFigureSpec,
  PhyloLayout,
  PhyloFormat,
  PhyloMetadataBinding,
  AlignedPanel,
  AlignedPanelKind,
} from "@/lib/phylo/types";
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
  /** Create a new stored tree from Newick / Nexus / PhyloXML text. Wraps
   *  phyloApi.create. Returns the raw files so the caller reads the new id from
   *  files.meta.id. */
  createTree: (
    tree: string,
    meta: {
      name: string;
      project_ids: string[];
      format: PhyloFormat;
      source: "upload" | "paste" | "builder";
      figure?: PhyloFigureSpec;
      metadata?: PhyloMetadataBinding;
    },
  ) => Promise<RawPhyloFiles>;
  /** Patch a saved tree's sidecar metadata (the figure + optional column
   *  bindings). Wraps phyloApi.updateMeta. */
  updateTreeMeta: (
    id: string,
    patch: { figure?: PhyloFigureSpec; metadata?: PhyloMetadataBinding },
  ) => Promise<PhyloMeta | null>;
};

export const phyloToolsDeps: PhyloToolsDeps = {
  listTrees: () => phyloApi.list(),
  navigate: requestNavigation,
  createTree: (tree, meta) => phyloApi.create(tree, meta),
  updateTreeMeta: (id, patch) => phyloApi.updateMeta(id, patch),
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
//
// Catalog-miss notes: when a supplied value is out-of-catalog, a factual note
// is produced in the tool result stating what the paper specified and what the
// nearest supported catalog value is. These notes are purely descriptive, no
// judgment or recommendation, per the BeakerBot no-interpretation rule.
//
// Substitution models (fixedModel): this field is a FREE STRING. The paper's
// exact model string (e.g. "GTR+G+I", "LG+F+R4", "TVM+I+G4") passes through
// to the BuilderOptions fixedModel field unchanged. IQ-TREE validates it at
// runtime. We do NOT nearest-map model names onto a catalog enum; that would
// silently alter a peer-reviewed pipeline choice.

/** A single catalog-miss substitution note. Purely descriptive. */
export interface CatalogMissNote {
  /** The field name that was substituted (e.g. "align"). */
  field: string;
  /** The value the caller (or paper) supplied. */
  supplied: string;
  /** The catalog value the recipe will actually use (the nearest supported value). */
  used: string;
  /** The human-readable descriptive sentence for the tool result. */
  note: string;
}

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

/** Human-readable field labels used in catalog-miss notes. */
const FIELD_LABELS: Record<string, string> = {
  dataType: "sequence data type",
  analysis: "analysis type",
  have: "input type",
  align: "alignment tool",
  trim: "trimming tool",
  partScheme: "partition scheme",
  brlen: "branch-length mode",
  model: "model-selection strategy",
  infer: "tree-inference tool",
  support: "branch-support method",
  os: "operating system",
  ufbootReps: "UFBoot replicate count",
  bsReps: "bootstrap replicate count",
  threads: "thread count",
};

/** Build a descriptive catalog-miss note for one substitution.
 *  The note states the supplied value and the nearest supported value as a
 *  factual observation only, no judgment or recommendation. */
function makeMissNote(field: string, supplied: string, used: string): CatalogMissNote {
  const label = FIELD_LABELS[field] ?? field;
  return {
    field,
    supplied,
    used,
    note: `The paper specifies ${label} "${supplied}"; the catalog's nearest supported value is "${used}".`,
  };
}

/** Resolve args into a fully-validated BuilderOptions, overlaid on DEFAULT_OPTIONS.
 *  Returns the resolved options, a list of field names that fell back to the
 *  default because the supplied value was out-of-catalog, and a list of
 *  catalog-miss notes describing each substitution in plain language. Exported
 *  for tests. */
export function resolveBuilderOptions(args: Record<string, unknown>): {
  options: BuilderOptions;
  defaulted: string[];
  catalogMissNotes: CatalogMissNote[];
} {
  const defaulted: string[] = [];
  const catalogMissNotes: CatalogMissNote[] = [];

  function track<T extends string>(
    field: string,
    result: { value: T; defaulted: boolean },
  ): T {
    if (result.defaulted) {
      defaulted.push(field);
      const supplied = typeof args[field] === "string" ? (args[field] as string) : String(args[field]);
      catalogMissNotes.push(makeMissNote(field, supplied, String(result.value)));
    }
    return result.value;
  }

  function trackInt(
    field: string,
    result: { value: number; defaulted: boolean },
  ): number {
    if (result.defaulted) {
      defaulted.push(field);
      const supplied = String(args[field]);
      catalogMissNotes.push(makeMissNote(field, supplied, String(result.value)));
    }
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
        catalogMissNotes.push(makeMissNote("threads", t, DEFAULT_OPTIONS.threads));
      }
    }
  }

  // Boolean fields.
  const bnni = typeof args.bnni === "boolean" ? args.bnni : DEFAULT_OPTIONS.bnni;
  const asc = typeof args.asc === "boolean" ? args.asc : DEFAULT_OPTIONS.asc;
  const restrictModels =
    typeof args.restrictModels === "boolean" ? args.restrictModels : DEFAULT_OPTIONS.restrictModels;

  // Numeric rep counts.
  const ufbootReps = trackInt(
    "ufbootReps",
    pickPositiveInt(args.ufbootReps, DEFAULT_OPTIONS.ufbootReps),
  );
  const bsReps = trackInt(
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

  return { options, defaulted, catalogMissNotes };
}

export const generateTreeTool: AiTool = {
  name: "generate_tree",
  description: `Generate a runnable phylogenetics analysis recipe from the user's chosen options. Call this when the user says things like "generate a tree-building pipeline", "what commands do I run to build a tree with IQ-TREE GTR+G and UFBoot", "make me a RAxML recipe", "build me a phylogenetics workflow", "how do I run a coalescent species tree", or "reproduce the pipeline from this paper". It returns a complete recipe the user runs themselves on their own machine (no server compute, no tree is built here). The recipe includes the ordered shell commands, the OS-specific install steps (Miniforge + conda env), a conda environment.yml pinning every tool, a run.sh script, and a full markdown document combining all of the above. Surface the recipe's markdown and runScript to the user. If catalogMissNotes is non-empty, surface each note verbatim to the user before the recipe; these are factual substitution notices (what the paper specified vs. what the catalog supports). You MUST NOT fabricate any command, flag, or model name. Only the generateRecipe generator is authoritative. This tool is read-only: it changes nothing in the user's folder.`,
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
        description: "Model-selection strategy. modelfinder = IQ-TREE tests models and picks the best fit (-m MFP); fixed = use the model named in fixedModel. Set this to fixed and pass the exact model string in fixedModel whenever a paper specifies a model. Default: modelfinder.",
      },
      fixedModel: {
        type: "string",
        description: "The substitution model to use when model is fixed. Pass the paper's exact model string (e.g. GTR+G, GTR+I+G4, LG+F+R4, TVM+G). Free text is accepted and passed through to IQ-TREE unchanged, which validates it at runtime. Common nucleotide presets: GTR+G, GTR+I+G, HKY+G, JC. Common protein presets: LG+G, LG+I+G, WAG+G, JTT+G. Default: GTR+G.",
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
        description: "Taxon name (or comma-separated names) to use as the outgroup for rooting (IQ-TREE and RAxML paths only). Pass an empty string or omit to skip outgroup rooting. Default: no outgroup.",
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
      const { options, defaulted, catalogMissNotes } = resolveBuilderOptions(args);
      const recipe = generateRecipe(options);
      return {
        ok: true as const,
        recipe,
        optionsUsed: options,
        defaulted,
        catalogMissNotes,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, error: `Recipe generation failed: ${msg}` };
    }
  },
};

// ---------------------------------------------------------------------------
// match_figure_style (PDF-reproduce Output 4)
// ---------------------------------------------------------------------------
//
// Output 4 of the reproduce-from-PDF flow. The user attaches a paper FIGURE and
// wants their OWN tree to match its visual style. The model SEES the figure
// (vision is available behind the router), reads ONLY its visual style off the
// image (overall layout, phylogram vs cladogram, tip-label italics, support
// values shown, color palette, aligned tracks as columns vs rings), and drafts a
// PhyloFigureSpec describing that style. This tool sanitizes the draft, writes it
// onto the user's tree (a saved tree via updateMeta, or a freshly-created tree
// from pasted Newick via create), and navigates to Tree Studio hydrated with the
// style so the user edits everything else.
//
// HARD SCOPE (confirmed by the Phylo lane, and BeakerBot's no-interpretation
// rule): this emits ONLY visual style read off the figure image. It NEVER
// re-derives topology, tip names, or data values from the figure. The user
// supplies the real tree (Newick text is the source of truth). The tool never
// invents tips, branches, or data values.
//
// Contract (Phylo lane, locked + additive):
//   - Target type is PhyloFigureSpec (NOT RenderSpec, NOT FigureInputs). Per-layer
//     style (tip-label italic / size / alignment, support cutoff, bar width,
//     palette) lives in each AlignedPanel.options (stable-but-untyped). Column ->
//     track bindings live in PhyloMetadataBinding, not the figure.
//   - Hydration goes through phyloApi only (never PhyloStudio internals, which are
//     mid-refactor). create() for pasted Newick, updateMeta() for a saved tree.
//   - Open Tree Studio via the deep link /phylo?doc=<id>#ros=studio. PhyloStudio
//     hydrates from meta.figure + meta.metadata automatically via its ?doc path.
//
// Mirrors generate_tree's convention: navigate straight, no draft-approval card.
// Deterministic in the sense that the model only supplies the style spec it read
// off the figure; the tool writes + navigates; the user edits the rest in Studio.

/** The four valid Studio layouts, for sanitizing the model's loose layout value. */
const PHYLO_LAYOUTS: readonly PhyloLayout[] = [
  "rectangular",
  "circular",
  "slanted",
  "unrooted",
];

/** The geom catalog an AlignedPanel can be, mirrored from types.ts so the
 *  sanitizer can guard the kind without importing a runtime value (the type is
 *  type-only). Kept in sync with AlignedPanelKind. */
const ALIGNED_PANEL_KINDS: readonly AlignedPanelKind[] = [
  "labels",
  "points",
  "strip",
  "heat",
  "bars",
  "dots",
  "box",
  "violin",
  "point",
  "scatter",
  "clade",
  "support",
  "msa",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Coerce one loosely-typed panel object into a clean AlignedPanel, or null when
 *  it is too malformed to keep (no usable kind). AlignedPanel.options is
 *  Record<string, unknown> by contract, so options pass through as-is (the
 *  "thin adapter on our side" Phylo recommended); we only guard the surrounding
 *  shape. */
function sanitizePanel(input: unknown, index: number): AlignedPanel | null {
  if (!isRecord(input)) return null;
  const kind = input.kind;
  if (typeof kind !== "string" || !ALIGNED_PANEL_KINDS.includes(kind as AlignedPanelKind)) {
    return null;
  }
  const id =
    typeof input.id === "string" && input.id.trim() ? input.id : `layer-${index}`;
  const panel: AlignedPanel = {
    id,
    kind: kind as AlignedPanelKind,
    // Hidden unless the model explicitly marks it visible false; default visible.
    visible: typeof input.visible === "boolean" ? input.visible : true,
  };
  if (typeof input.column === "string") panel.column = input.column;
  if (Array.isArray(input.columns)) {
    panel.columns = input.columns.filter((c): c is string => typeof c === "string");
  }
  if (typeof input.errorColumn === "string") panel.errorColumn = input.errorColumn;
  if (isRecord(input.scale)) {
    const k = input.scale.kind;
    if (k === "continuous" || k === "categorical") {
      panel.scale = {
        kind: k,
        ...(typeof input.scale.paletteId === "string"
          ? { paletteId: input.scale.paletteId }
          : {}),
      };
    }
  }
  if (typeof input.legend === "boolean") panel.legend = input.legend;
  if (typeof input.width === "number" && Number.isFinite(input.width)) {
    panel.width = input.width;
  }
  // options is the stable-but-untyped per-layer style bag. Pass through as-is when
  // it is a plain object (tip-label italic / size / alignment, support cutoff, bar
  // width, palette, ...), guarding only that it is an object so the renderer never
  // chokes on a stray scalar.
  if (isRecord(input.options)) panel.options = input.options;
  return panel;
}

/**
 * Coerce the model's loosely-typed object into a clean PhyloFigureSpec. Pure.
 *
 *   - layout must be one of the four enum values, otherwise "rectangular".
 *   - branchLengths must be a boolean, otherwise true (phylogram default).
 *   - tracks must be a Record<string, boolean>, otherwise {} (bad entries dropped).
 *   - legend / scales / panels pass through when present and well-formed.
 *
 * Because AlignedPanel.options is Record<string, unknown> by contract, panel
 * options pass through as-is (only the array + per-panel shape is guarded). This
 * is the thin adapter on BeakerBot's side that the Phylo lane recommended.
 */
export function sanitizeFigureSpec(input: unknown): PhyloFigureSpec {
  const src = isRecord(input) ? input : {};

  const layout: PhyloLayout =
    typeof src.layout === "string" && PHYLO_LAYOUTS.includes(src.layout as PhyloLayout)
      ? (src.layout as PhyloLayout)
      : "rectangular";

  const branchLengths =
    typeof src.branchLengths === "boolean" ? src.branchLengths : true;

  const tracks: Record<string, boolean> = {};
  if (isRecord(src.tracks)) {
    for (const [key, value] of Object.entries(src.tracks)) {
      if (typeof value === "boolean") tracks[key] = value;
    }
  }

  const spec: PhyloFigureSpec = { layout, branchLengths, tracks };

  if (typeof src.legend === "boolean") spec.legend = src.legend;

  if (isRecord(src.scales)) {
    const scales: NonNullable<PhyloFigureSpec["scales"]> = {};
    if (typeof src.scales.category === "string") scales.category = src.scales.category;
    if (typeof src.scales.bar === "string") scales.bar = src.scales.bar;
    if (isRecord(src.scales.heat)) {
      const heat: Record<string, string> = {};
      for (const [k, v] of Object.entries(src.scales.heat)) {
        if (typeof v === "string") heat[k] = v;
      }
      if (Object.keys(heat).length > 0) scales.heat = heat;
    }
    if (Object.keys(scales).length > 0) spec.scales = scales;
  }

  if (Array.isArray(src.panels)) {
    const panels: AlignedPanel[] = [];
    src.panels.forEach((p, i) => {
      const panel = sanitizePanel(p, i);
      if (panel) panels.push(panel);
    });
    // Only attach panels when at least one survived, so a garbage array does not
    // overwrite the load path's default layer projection with an empty stack.
    if (panels.length > 0) spec.panels = panels;
  }

  return spec;
}

/** Sanitize a loosely-typed metadata binding (column -> track bindings) into a
 *  clean PhyloMetadataBinding, or null when there is no usable tip column. Pure.
 *  Only attached to the write when the figure showed column tracks. */
export function sanitizeMetadataBinding(input: unknown): PhyloMetadataBinding | null {
  if (!isRecord(input)) return null;
  if (typeof input.tipColumn !== "string" || !input.tipColumn.trim()) return null;
  const binding: PhyloMetadataBinding = { tipColumn: input.tipColumn };
  if (Array.isArray(input.rows)) {
    const rows = input.rows.filter(isRecord).map((r) => {
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === "string") row[k] = v;
      }
      return row;
    });
    if (rows.length > 0) binding.rows = rows;
  }
  if (typeof input.datahubTableId === "string") binding.datahubTableId = input.datahubTableId;
  if (typeof input.categoryColumn === "string") binding.categoryColumn = input.categoryColumn;
  if (typeof input.barColumn === "string") binding.barColumn = input.barColumn;
  if (Array.isArray(input.heatColumns)) {
    const cols = input.heatColumns.filter((c): c is string => typeof c === "string");
    if (cols.length > 0) binding.heatColumns = cols;
  }
  return binding;
}

/** The valid tree-text formats, for sanitizing the model's loose format value. */
const PHYLO_FORMATS: readonly PhyloFormat[] = ["newick", "nexus", "phyloxml"];

export const matchFigureStyleTool: AiTool = {
  name: "match_figure_style",
  description:
    "Match the VISUAL STYLE of an attached paper figure onto the user's OWN phylogenetic tree, then open it in Tree Studio hydrated with that style for the user to edit. This is Output 4 of the reproduce-from-PDF flow, and it is vision-driven, so call it only after you have LOOKED at the attached figure. Pass `figure`, a PhyloFigureSpec describing ONLY the visual style you can SEE in the image, the overall layout (rectangular, circular, slanted, or unrooted), whether it is a phylogram (branchLengths true, branch lengths to scale) or a cladogram (branchLengths false), whether tip labels are italic, whether support values are shown, the color palette, and any aligned tracks as columns or rings. You MUST supply the user's OWN tree, either `treeRef` (a saved tree id or name) or `treeText` (Newick the user pasted). Exactly one of the two. If you have neither, do NOT call this, ASK the user for their tree first. NEVER read topology, tip names, or data values off the figure image, and NEVER invent a tree, a tip, a branch, or a data value, the figure gives you STYLE only and the user's Newick is the only source of the tree itself. On success the tool writes the style onto the tree and navigates the user to Tree Studio, so do not call go_to_page after it. End your reply with the returned embed on its own line, the markdown [<name>](/phylo?doc=<id>#ros=studio). The user edits everything else in the Studio.",
  parameters: {
    type: "object",
    properties: {
      figure: {
        type: "object",
        description:
          "The PhyloFigureSpec you drafted from the figure's APPEARANCE. Shape: { layout: 'rectangular' | 'circular' | 'slanted' | 'unrooted'; branchLengths: boolean (true = phylogram with branch lengths to scale, false = cladogram with uniform depths); tracks: an object of trackKey -> boolean; legend?: boolean; scales?: { category?: string; bar?: string; heat?: object }; panels?: an ordered array of layer objects, inner (near the tips) to outer, each { id: string; kind: 'labels' | 'strip' | 'heat' | 'bars' | 'support' | ... ; visible: boolean; column?: string; columns?: string[]; legend?: boolean; width?: number; options?: object } }. Per-layer style (tip-label italic / size / alignment, support cutoff, bar width, palette) goes in each panel's `options` object. Describe ONLY what you can SEE in the figure, never topology or data values.",
        additionalProperties: true,
      },
      treeRef: {
        type: "string",
        description:
          "An existing saved tree to restyle, by its stable id or its name (from list_phylo_trees). Supply this OR treeText, not both. The style is written onto this tree's sidecar.",
      },
      treeText: {
        type: "string",
        description:
          "Newick text the user supplied for a NEW tree to create and then style. Supply this OR treeRef, not both. This is the only source of the tree's topology and tip names, never read those off the figure.",
      },
      name: {
        type: "string",
        description:
          "A name for a newly created tree (only used with treeText). Defaults to 'Reproduced figure'.",
      },
      format: {
        type: "string",
        enum: ["newick", "nexus", "phyloxml"],
        description:
          "The tree-text format of treeText. Defaults to newick. Only used when creating from treeText.",
      },
      metadata: {
        type: "object",
        description:
          "Optional column -> track bindings, ONLY when the figure showed aligned column tracks (color strips, heat columns, bar panels) and the user's tree carries a metadata table. Shape: { tipColumn: string; rows?: object[]; datahubTableId?: string; categoryColumn?: string; barColumn?: string; heatColumns?: string[] }. Omit it when the figure is just a styled tree with no data columns.",
        additionalProperties: true,
      },
    },
    additionalProperties: false,
  },
  // No `action` or `previewable` flag: like generate_tree / make_datahub_graph it
  // navigates straight to the result the user explicitly asked for. The user edits
  // everything in the Studio it lands in, so a draft card would be redundant.
  execute: async (args) => {
    const figure = sanitizeFigureSpec(args.figure);
    const metadata = sanitizeMetadataBinding(args.metadata);

    const treeRef = typeof args.treeRef === "string" ? args.treeRef.trim() : "";
    const treeText = typeof args.treeText === "string" ? args.treeText.trim() : "";

    if (!treeRef && !treeText) {
      return {
        ok: false as const,
        error:
          "I need your own tree to apply this style to. Ask the user for it, a saved tree by name or pasted Newick text. Do not invent a tree.",
      };
    }

    // Restyle a saved tree.
    if (treeRef) {
      let trees: PhyloMeta[];
      try {
        trees = await phyloToolsDeps.listTrees();
      } catch {
        return {
          ok: false as const,
          error: "I could not read your saved trees. A folder may not be connected.",
        };
      }
      const meta = resolveTree(trees, treeRef);
      if (!meta) {
        const names = trees.map((t) => `"${t.name}"`).join(", ");
        return {
          ok: false as const,
          error: `I could not find a tree called "${treeRef}". Your trees are: ${names || "(none yet)"}. Ask the user which saved tree to style, or for pasted Newick, do not invent one.`,
        };
      }
      try {
        await phyloToolsDeps.updateTreeMeta(meta.id, {
          figure,
          ...(metadata ? { metadata } : {}),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: `I could not save the figure style: ${msg}` };
      }
      phyloToolsDeps.navigate(`/phylo?doc=${meta.id}#ros=studio`);
      return {
        ok: true as const,
        id: meta.id,
        name: meta.name || "Tree",
        embed: treeCardEmbed(meta),
      };
    }

    // Create a new tree from the user's pasted Newick, then style it.
    const format: PhyloFormat =
      typeof args.format === "string" && PHYLO_FORMATS.includes(args.format as PhyloFormat)
        ? (args.format as PhyloFormat)
        : "newick";
    const name =
      typeof args.name === "string" && args.name.trim() ? args.name.trim() : "Reproduced figure";

    let files: RawPhyloFiles;
    try {
      files = await phyloToolsDeps.createTree(treeText, {
        name,
        project_ids: [],
        format,
        source: "paste",
        figure,
        ...(metadata ? { metadata } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, error: `I could not create the tree: ${msg}` };
    }

    const id = files.meta.id;
    phyloToolsDeps.navigate(`/phylo?doc=${id}#ros=studio`);
    return {
      ok: true as const,
      id,
      name: files.meta.name || name,
      embed: treeCardEmbed({ id, name: files.meta.name || name }),
    };
  },
};
