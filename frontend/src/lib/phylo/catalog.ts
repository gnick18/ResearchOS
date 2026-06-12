// The phylogenetics command catalog (phylo Phase 1, 2026-06-12).
//
// THIS IS A VERIFIED ASSET. Tool names, flags, conda pins, and defaults are
// curated and reviewed, the same discipline as the method catalog and the
// vendor-spec-verbatim rule. The Tree Builder wizard and the BeakerBot
// plain-language path BOTH fill this catalog, neither invents a flag. Changing a
// default tool or flag here is a deliberate, signed-off edit, not a casual tweak,
// because researchers copy these commands and run them as-is.
//
// Install is conda-first for every OS (Miniforge), the honest cross-platform path
// (a generated environment.yml pins every chosen tool). The OS only changes how
// you bootstrap conda. We deliberately do NOT assert Homebrew/apt formulas that
// may not exist for a given tool.
//
// Design: docs/proposals/2026-06-12-phylogenetics-page.md section 3a.

export type DataType = "nucleotide" | "protein" | "codon";
export type HaveInput = "raw" | "alignment" | "library";
export type AlignTool = "mafft" | "muscle" | "clustalo" | "skip";
export type TrimTool = "trimal" | "clipkit" | "gblocks" | "skip";
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
  {
    value: "codon",
    label: "Codon-aware",
    hint: "Protein-coding DNA aligned in reading frame",
  },
];

export const HAVE_INPUTS: CatalogOption<HaveInput>[] = [
  { value: "raw", label: "Raw sequences (FASTA)", hint: "Unaligned, the wizard starts with alignment" },
  { value: "alignment", label: "An alignment", hint: "Already aligned, the wizard skips alignment" },
  { value: "library", label: "From Sequences library", hint: "Export the selected sequences to FASTA first" },
];

export const ALIGN_TOOLS: CatalogOption<AlignTool>[] = [
  { value: "mafft", label: "MAFFT", hint: "Fast and accurate, the common default", conda: "mafft=7.526" },
  { value: "muscle", label: "MUSCLE5", hint: "High accuracy on smaller sets", conda: "muscle=5.1" },
  { value: "clustalo", label: "Clustal Omega", hint: "Scales to very many sequences", conda: "clustalo=1.2.4" },
  { value: "skip", label: "Skip", hint: "Use my input as-is" },
];

export const TRIM_TOOLS: CatalogOption<TrimTool>[] = [
  { value: "trimal", label: "trimAl", hint: "Removes poorly aligned columns automatically", conda: "trimal=1.5.0" },
  { value: "clipkit", label: "ClipKIT", hint: "Keeps phylogenetically informative sites", conda: "clipkit=2.3.0" },
  { value: "gblocks", label: "Gblocks", hint: "Conservative selection of aligned blocks", conda: "gblocks=0.91b" },
  { value: "skip", label: "Skip", hint: "Infer from the full alignment" },
];

export const MODEL_CHOICES: CatalogOption<ModelChoice>[] = [
  { value: "modelfinder", label: "ModelFinder", hint: "Picks the best substitution model for you" },
  { value: "fixed", label: "Fixed model", hint: "Use a standard model (GTR+G or LG+G)" },
];

export const INFER_TOOLS: CatalogOption<InferTool>[] = [
  { value: "iqtree", label: "IQ-TREE 2", hint: "Maximum likelihood, the common default", conda: "iqtree=2.3.6" },
  { value: "raxml", label: "RAxML-NG", hint: "Maximum likelihood, fast on large sets", conda: "raxml-ng=1.2.2" },
  { value: "fasttree", label: "FastTree", hint: "Approximate, scales to thousands of taxa", conda: "fasttree=2.1.11" },
  { value: "mrbayes", label: "MrBayes", hint: "Bayesian inference with posterior support", conda: "mrbayes=3.2.7" },
];

export const SUPPORT_CHOICES: CatalogOption<SupportChoice>[] = [
  { value: "ufboot", label: "UFBoot2 + SH-aLRT", hint: "Fast, the IQ-TREE default support" },
  { value: "bootstrap", label: "Standard bootstrap", hint: "Classic nonparametric bootstrap, slower" },
  { value: "none", label: "None", hint: "Single tree, no support values" },
];

export const OS_CHOICES: CatalogOption<OSChoice>[] = [
  { value: "mac", label: "macOS", hint: "Miniforge via Homebrew" },
  { value: "windows", label: "Windows", hint: "Run the tools under WSL2 (Ubuntu)" },
  { value: "linux", label: "Linux", hint: "Miniforge installer" },
];

/** The wizard's full selection. */
export interface BuilderOptions {
  dataType: DataType;
  have: HaveInput;
  nTaxa: number;
  nSites: number;
  align: AlignTool;
  trim: TrimTool;
  model: ModelChoice;
  infer: InferTool;
  support: SupportChoice;
  os: OSChoice;
}

export const DEFAULT_OPTIONS: BuilderOptions = {
  dataType: "nucleotide",
  have: "raw",
  nTaxa: 50,
  nSites: 1800,
  align: "mafft",
  trim: "trimal",
  model: "modelfinder",
  infer: "iqtree",
  support: "ufboot",
  os: "mac",
};

/** Look up a catalog option by value across any of the option lists. */
export function findOption<T extends string>(
  list: CatalogOption<T>[],
  value: T,
): CatalogOption<T> | undefined {
  return list.find((o) => o.value === value);
}
