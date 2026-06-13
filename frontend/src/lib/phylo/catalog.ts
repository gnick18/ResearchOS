// The phylogenetics command catalog (Tree Builder wizard, frozen 2026-06-12).
//
// THIS IS A VERIFIED ASSET. Every tool name, flag, conda pin, and default below
// is from the official docs (IQ-TREE 2, RAxML-NG, MAFFT, trimAl, ClipKIT,
// Gblocks, ModelFinder, AMAS README, ASTER/ASTRAL-IV tutorial), curated and
// signed off via the in-chat widgets. The Tree Builder wizard and the BeakerBot
// plain-language path BOTH fill this catalog, neither invents a flag. Changing a
// default tool or flag here is a deliberate, signed-off edit, not a casual tweak,
// because researchers copy these commands and run them as-is.
//
// Install is conda-first for every OS (Miniforge), the honest cross-platform path
// (a generated environment.yml pins every chosen tool). The OS only changes how
// you bootstrap conda. We deliberately do NOT assert Homebrew/apt formulas that
// may not exist for a given tool.
//
// Spec: docs/proposals/2026-06-12-phylo-wizard-build-spec.md (frozen contract).

export type DataType = "nucleotide" | "protein";
export type Analysis = "single" | "supermatrix" | "coalescent";
export type HaveInput = "raw" | "alignment" | "library";
export type AlignTool = "mafft" | "muscle" | "clustalo" | "skip";
export type TrimTool = "trimal" | "clipkit" | "gblocks" | "skip";
export type PartScheme = "gene" | "gene_codon" | "merge";
export type BrlenMode = "p" | "q" | "Q";
export type ModelChoice = "modelfinder" | "fixed";
export type InferTool = "iqtree" | "raxml" | "fasttree" | "mrbayes";
export type SupportChoice = "ufboot" | "bootstrap" | "none";
export type OSChoice = "mac" | "windows" | "linux";

/** One selectable option in the wizard: a stable value plus its display copy. */
export interface CatalogOption<T extends string> {
  value: T;
  label: string;
  /** One line shown under the option. House voice, no em-dashes or mid-sentence colons. */
  hint: string;
  /** bioconda package spec, version-pinned, for environment.yml. Absent for "skip" / "fixed". */
  conda?: string;
}

export const DATA_TYPES: CatalogOption<DataType>[] = [
  { value: "nucleotide", label: "Nucleotide", hint: "DNA or RNA sequences" },
  { value: "protein", label: "Protein", hint: "Amino-acid sequences" },
];

export const ANALYSIS: CatalogOption<Analysis>[] = [
  { value: "single", label: "Single locus", hint: "One gene or region, one tree" },
  {
    value: "supermatrix",
    label: "Concatenated supermatrix",
    hint: "Many genes joined into one partitioned alignment, one ML tree",
  },
  {
    value: "coalescent",
    label: "Coalescent species tree",
    hint: "Per-gene trees summarized with ASTRAL, accounts for incomplete lineage sorting",
  },
];

export const HAVE_INPUTS: CatalogOption<HaveInput>[] = [
  { value: "raw", label: "Raw sequences (FASTA)", hint: "Unaligned, start with alignment" },
  { value: "alignment", label: "Alignment(s) already made", hint: "Skip alignment" },
  { value: "library", label: "From Sequences library", hint: "Export the selected sequences to FASTA first" },
];

export const ALIGN_TOOLS: CatalogOption<AlignTool>[] = [
  { value: "mafft", label: "MAFFT", hint: "Auto mode picks the strategy", conda: "mafft=7.526" },
  { value: "muscle", label: "MUSCLE5", hint: "High accuracy on smaller sets", conda: "muscle=5.1" },
  { value: "clustalo", label: "Clustal Omega", hint: "Scales to very many sequences", conda: "clustalo=1.2.4" },
  { value: "skip", label: "Skip", hint: "Use my input as-is" },
];

export const TRIM_TOOLS: CatalogOption<TrimTool>[] = [
  { value: "trimal", label: "trimAl", hint: "Removes poorly aligned columns", conda: "trimal=1.5.0" },
  { value: "clipkit", label: "ClipKIT", hint: "Keeps informative sites", conda: "clipkit=2.3.0" },
  { value: "gblocks", label: "Gblocks", hint: "Conservative blocks", conda: "gblocks=0.91b" },
  { value: "skip", label: "Skip", hint: "Infer from the full alignment" },
];

export const PART_SCHEMES: CatalogOption<PartScheme>[] = [
  { value: "gene", label: "By gene", hint: "One model per gene" },
  {
    value: "gene_codon",
    label: "By gene + codon position",
    hint: "Split coding genes into 1st/2nd/3rd positions",
  },
  { value: "merge", label: "Merge similar (+MERGE)", hint: "ModelFinder collapses partitions that fit alike" },
];

export const BRLEN_MODES: CatalogOption<BrlenMode>[] = [
  { value: "p", label: "Edge-linked proportional (-p)", hint: "Recommended for a typical analysis" },
  { value: "q", label: "Edge-equal (-q)", hint: "All partitions share branch lengths" },
  { value: "Q", label: "Edge-unlinked (-Q)", hint: "Each partition its own branch lengths" },
];

export const MODEL_CHOICES: CatalogOption<ModelChoice>[] = [
  { value: "modelfinder", label: "Let ModelFinder choose", hint: "IQ-TREE tests models and picks the best fit (-m MFP)" },
  { value: "fixed", label: "Pick a model", hint: "Choose or type a substitution model" },
];

export const INFER_TOOLS: CatalogOption<InferTool>[] = [
  { value: "iqtree", label: "IQ-TREE 2", hint: "ML, common default", conda: "iqtree=2.3.6" },
  { value: "raxml", label: "RAxML-NG", hint: "ML, fast on large sets", conda: "raxml-ng=1.2.2" },
  { value: "fasttree", label: "FastTree", hint: "Approximate, scales to thousands", conda: "fasttree=2.1.11" },
  { value: "mrbayes", label: "MrBayes", hint: "Bayesian, posterior support", conda: "mrbayes=3.2.7" },
];

export const SUPPORT_CHOICES: CatalogOption<SupportChoice>[] = [
  { value: "ufboot", label: "UFBoot2 + SH-aLRT", hint: "Fast, the IQ-TREE default" },
  { value: "bootstrap", label: "Standard bootstrap", hint: "Classic nonparametric, slower" },
  { value: "none", label: "None", hint: "Single tree, no support" },
];

export const OS_CHOICES: CatalogOption<OSChoice>[] = [
  { value: "mac", label: "macOS", hint: "Miniforge via Homebrew" },
  { value: "windows", label: "Windows", hint: "Run under WSL2 (Ubuntu)" },
  { value: "linux", label: "Linux", hint: "Miniforge installer" },
];

/**
 * Preset substitution models for the "Pick a model" searchable list. Free text
 * is also allowed, these are the common starting points per data type.
 */
export const MODELS: Record<DataType, string[]> = {
  nucleotide: ["GTR+G", "GTR+I+G", "GTR+R4", "HKY+G", "TN93+G", "K80+G", "SYM+G", "JC"],
  protein: ["LG+G", "LG+I+G", "LG+G+F", "WAG+G", "JTT+G", "Dayhoff+G", "Blosum62+G", "Q.pfam+G"],
};

/** Pipeline-only conda pins, added by the generator when the pipeline uses them. */
export const PIPELINE_CONDA = {
  amas: "amas=1.0",
  astral: "astral-tree=5.7.1",
};

/** The wizard's full, frozen selection. */
export interface BuilderOptions {
  dataType: DataType;
  analysis: Analysis;
  have: HaveInput;
  align: AlignTool;
  trim: TrimTool;
  partScheme: PartScheme; // supermatrix only
  brlen: BrlenMode; // supermatrix only
  model: ModelChoice;
  fixedModel: string; // used when model === "fixed"
  infer: InferTool;
  support: SupportChoice;
  outgroup: string; // "" = none
  os: OSChoice;
  // advanced
  bnni: boolean; // UFBoot --bnni
  ufbootReps: number;
  bsReps: number;
  asc: boolean; // ascertainment bias +ASC
  restrictModels: boolean; // -mset common set
  threads: string; // "AUTO" or a number-as-string
}

export const DEFAULT_OPTIONS: BuilderOptions = {
  dataType: "nucleotide",
  analysis: "single",
  have: "raw",
  align: "mafft",
  trim: "trimal",
  partScheme: "gene",
  brlen: "p",
  model: "modelfinder",
  fixedModel: "GTR+G",
  infer: "iqtree",
  support: "ufboot",
  outgroup: "",
  os: "mac",
  bnni: true,
  ufbootReps: 1000,
  bsReps: 1000,
  asc: false,
  restrictModels: false,
  threads: "AUTO",
};

/** Look up a catalog option by value across any of the option lists. */
export function findOption<T extends string>(
  list: CatalogOption<T>[],
  value: T,
): CatalogOption<T> | undefined {
  return list.find((o) => o.value === value);
}
