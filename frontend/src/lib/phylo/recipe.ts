// The recipe generator (Tree Builder wizard, frozen 2026-06-12).
//
// PURE + DETERMINISTIC: BuilderOptions in, recipe strings out. No DOM, no I/O, so
// it is fully unit-testable (recipe.test.ts) and reused identically by the wizard
// UI and the BeakerBot plain-language path. Nothing here runs a tool, it only
// writes the exact commands the researcher runs on their own machine. Every flag
// and pin comes from the verified catalog.
//
// Three pipelines: single locus, concatenated supermatrix (always IQ-TREE for the
// partitioned tree), and a coalescent species tree (per-gene trees summarized by
// ASTRAL). Spec: docs/proposals/2026-06-12-phylo-wizard-build-spec.md.

import {
  type BuilderOptions,
  ALIGN_TOOLS,
  TRIM_TOOLS,
  INFER_TOOLS,
  PIPELINE_CONDA,
  findOption,
} from "./catalog";

export interface RecipeOutput {
  /** The ordered shell commands, with "# why" comment lines. */
  commands: string;
  /** The OS-specific install block (Miniforge + conda env). */
  install: string;
  /** A conda environment.yml pinning only the chosen tools. */
  envYaml: string;
  /** A single run.sh body (commands only, comments stripped). */
  runScript: string;
  /** The full recipe as one markdown document (header + install + commands). */
  markdown: string;
}

const COMMENT = (s: string) => `# ${s}`;

// ----------------------------------------------------------------------------
// Shared model + flag helpers
// ----------------------------------------------------------------------------

/** The IQ-TREE model string: fixedModel or MFP, plus +ASC when ascertainment bias is on. */
function modelString(o: BuilderOptions): string {
  const base = o.model === "fixed" ? o.fixedModel : "MFP";
  return o.asc ? `${base}+ASC` : base;
}

/** -mset restricting ModelFinder to a common set, only when restrictModels is on. */
function mset(o: BuilderOptions): string {
  if (!o.restrictModels) return "";
  return o.dataType === "protein" ? " -mset LG,WAG,JTT" : " -mset GTR,HKY,K80,JC";
}

/** IQ-TREE thread flag from the threads option (AUTO or a number). */
function iqtreeThreads(o: BuilderOptions): string {
  return `-T ${o.threads}`;
}

/** RAxML-NG thread flag (lower-case auto). */
function raxmlThreads(o: BuilderOptions): string {
  return `--threads ${o.threads === "AUTO" ? "auto" : o.threads}`;
}

/** The IQ-TREE support flags for the chosen support method. */
function iqtreeSupport(o: BuilderOptions): string {
  if (o.support === "ufboot") {
    return ` -B ${o.ufbootReps} -alrt 1000${o.bnni ? " -bnni" : ""}`;
  }
  if (o.support === "bootstrap") {
    return ` -b ${o.bsReps}`;
  }
  return "";
}

/** -o outgroup for the IQ-TREE / RAxML paths only. */
function outgroupFlag(o: BuilderOptions): string {
  return o.outgroup ? ` -o ${o.outgroup}` : "";
}

/** The default ML model name when a tool has no model finder (RAxML / per-gene). */
function defaultModel(o: BuilderOptions): string {
  if (o.model === "fixed") return o.fixedModel;
  return o.dataType === "protein" ? "LG+G" : "GTR+G";
}

// ----------------------------------------------------------------------------
// Per-tool command fragments
// ----------------------------------------------------------------------------

/** Align command from an input file to an output file (caller guards align !== skip). */
function alignCmd(o: BuilderOptions, input: string, output: string): string {
  if (o.align === "mafft") return `mafft --auto ${input} > ${output}`;
  if (o.align === "muscle") return `muscle -align ${input} -output ${output}`;
  return `clustalo -i ${input} -o ${output} --outfmt=fasta --force`;
}

/** Trim command from an alignment to a trimmed file (caller guards trim !== skip). */
function trimCmd(o: BuilderOptions, input: string, output: string): string {
  if (o.trim === "trimal") return `trimal -in ${input} -out ${output} -automated1`;
  if (o.trim === "clipkit") return `clipkit ${input} -o ${output} -m smart-gap`;
  const t = o.dataType === "protein" ? "p" : "d";
  return `Gblocks ${input} -t=${t} -b5=h; mv ${input}-gb ${output}`;
}

// ----------------------------------------------------------------------------
// Command line assembly (array form so run.sh can drop the comments)
// ----------------------------------------------------------------------------

type Line = { line: string; comment?: string };

/** Pipeline 1: single locus. */
function singleLines(o: BuilderOptions): Line[] {
  const out: Line[] = [];
  out.push({ comment: `Single-locus ${o.dataType} tree`, line: "" });

  let aln = o.have === "alignment" ? "input_alignment.fasta" : "input.fasta";
  if (o.have !== "alignment" && o.align !== "skip") {
    aln = "alignment.fasta";
    out.push({ comment: "align the sequences", line: alignCmd(o, "input.fasta", aln) });
  }

  let inferInput = aln;
  if (o.trim !== "skip") {
    inferInput = "trimmed.fasta";
    out.push({ comment: "remove poorly aligned columns", line: trimCmd(o, aln, inferInput) });
  }

  if (o.infer === "iqtree") {
    const s =
      `iqtree2 -s ${inferInput} -m ${modelString(o)}${mset(o)} ` +
      `${iqtreeThreads(o)} --prefix tree${iqtreeSupport(o)}${outgroupFlag(o)}`;
    out.push({
      comment:
        o.model === "modelfinder"
          ? "ModelFinder picks the best model, then IQ-TREE infers the ML tree"
          : "infer the ML tree under the chosen model",
      line: s,
    });
    out.push({ comment: "result: tree.treefile (open it in the Tree Studio)", line: "" });
  } else if (o.infer === "raxml") {
    const model = defaultModel(o) + (o.asc ? "+ASC" : "");
    if (o.model === "modelfinder") {
      out.push({
        comment: `RAxML-NG has no model finder, pick a model or run ModelTest-NG; using ${defaultModel(o)}`,
        line: "",
      });
    }
    const bs = o.support !== "none" ? ` --bs-trees ${o.bsReps}` : "";
    out.push({
      comment: "RAxML-NG does the ML search and maps bootstrap support onto it",
      line: `raxml-ng --all --msa ${inferInput} --model ${model} ${raxmlThreads(o)} --prefix tree${bs}${outgroupFlag(o)}`,
    });
    out.push({ comment: "result: tree.raxml.support (open it in the Tree Studio)", line: "" });
  } else if (o.infer === "fasttree") {
    const nt = o.dataType === "protein" ? "" : "-nt -gtr ";
    out.push({
      comment: "FastTree is approximate but scales to thousands of taxa",
      line: `FastTree ${nt}${inferInput} > tree.nwk`,
    });
    out.push({ comment: "result: tree.nwk (open it in the Tree Studio)", line: "" });
  } else {
    out.push(...mrbayesScaffold(o, inferInput));
  }
  return out;
}

/** The MrBayes scaffold for single-locus Bayesian inference. */
function mrbayesScaffold(o: BuilderOptions, aln: string): Line[] {
  const dna = o.dataType === "protein" ? "aa" : "dna";
  const block =
    o.dataType === "protein"
      ? "  prset aamodelpr=fixed(wag);\n  lset rates=invgamma;"
      : "  lset nst=6 rates=invgamma;";
  const heredoc = [
    "cat >> tree.nex <<'MB'",
    "begin mrbayes;",
    "  set autoclose=yes nowarn=yes;",
    block,
    "  mcmc ngen=1000000 samplefreq=1000 nchains=4 nruns=2;",
    "  sump burnin=250;",
    "  sumt burnin=250;",
    "end;",
    "MB",
  ].join("\n");
  return [
    { comment: "Bayesian inference with MrBayes", line: "" },
    {
      comment: "convert the alignment to NEXUS",
      line: `AMAS.py convert -d ${dna} -f fasta -i ${aln} -u nexus\nmv ${aln}-out.nex tree.nex`,
    },
    { comment: "append a MrBayes block; tune ngen for your dataset", line: heredoc },
    { comment: "run MrBayes", line: "mb tree.nex" },
    {
      comment:
        "result: tree.nex.con.tre (check the average standard deviation of split frequencies is < 0.01 for convergence)",
      line: "",
    },
  ];
}

/** The per-gene align/trim loop, shared by supermatrix and coalescent. */
function perGeneLoop(o: BuilderOptions, extra: string[]): Line[] {
  const body: string[] = ["for f in genes/*.fasta; do", '  base="${f%.fasta}"'];
  if (o.align !== "skip") body.push(`  ${alignCmd(o, '"$f"', '"$base.aln"')}`);
  if (o.trim !== "skip") body.push(`  ${trimCmd(o, '"$base.aln"', '"$base.trim"')}`);
  body.push(...extra);
  body.push("done");
  return [{ comment: "align + trim each gene (per-gene FASTA in genes/)", line: body.join("\n") }];
}

/** The per-gene file extension after the align/trim choices. */
function geneExt(o: BuilderOptions): string {
  if (o.trim !== "skip") return "trim";
  if (o.align !== "skip") return "aln";
  return "fasta";
}

/** Pipeline 2: concatenated supermatrix. ALWAYS IQ-TREE for the partitioned tree. */
function supermatrixLines(o: BuilderOptions): Line[] {
  const out: Line[] = [];
  out.push({ comment: `Concatenated supermatrix ${o.dataType} tree`, line: "" });
  out.push(...perGeneLoop(o, []));

  const ext = geneExt(o);
  const dna = o.dataType === "protein" ? "aa" : "dna";
  const codons = o.partScheme === "gene_codon" ? " --codons 123" : "";
  out.push({
    comment: "concatenate into one supermatrix plus a RAxML-style partition file",
    line: `AMAS.py concat -i genes/*.${ext} -f fasta -d ${dna} -u fasta -t supermatrix.fasta -p partitions.txt --part-format raxml${codons}`,
  });

  let partModel = o.model === "fixed" ? o.fixedModel : o.partScheme === "merge" ? "MFP+MERGE" : "MFP";
  if (o.asc) partModel += "+ASC";
  out.push({
    comment: "partitioned ML tree (IQ-TREE gives the best per-partition support)",
    line:
      `iqtree2 -s supermatrix.fasta -${o.brlen} partitions.txt -m ${partModel}${mset(o)} ` +
      `${iqtreeThreads(o)} --prefix tree${iqtreeSupport(o)}${outgroupFlag(o)}`,
  });
  out.push({ comment: "result: tree.treefile (open it in the Tree Studio)", line: "" });
  return out;
}

/** Pipeline 3: coalescent species tree (ASTRAL). */
function coalescentLines(o: BuilderOptions): Line[] {
  const out: Line[] = [];
  out.push({ comment: `Coalescent species tree (ASTRAL) for ${o.dataType} data`, line: "" });

  const ext = geneExt(o);
  // MrBayes is impractical per-gene; fall back to IQ-TREE for the gene trees.
  const useTool = o.infer === "mrbayes" ? "iqtree" : o.infer;
  let treeExt: string;
  let perGene: string;
  if (useTool === "iqtree") {
    treeExt = "treefile";
    perGene = `  iqtree2 -s "$base.${ext}" -m ${modelString(o)} -T AUTO -B ${o.ufbootReps} --prefix "$base"`;
  } else if (useTool === "raxml") {
    treeExt = "raxml.support";
    perGene = `  raxml-ng --all --msa "$base.${ext}" --model ${defaultModel(o)} --threads auto --prefix "$base"`;
  } else {
    treeExt = "nwk";
    const nt = o.dataType === "protein" ? "" : "-nt -gtr ";
    perGene = `  FastTree ${nt}"$base.${ext}" > "$base.nwk"`;
  }
  if (o.infer === "mrbayes") {
    out.push({
      comment: "MrBayes is impractical per-gene, using IQ-TREE for the gene trees",
      line: "",
    });
  }
  out.push(...perGeneLoop(o, [perGene]));

  out.push({ comment: "collect the gene trees", line: `cat genes/*.${treeExt} > gene_trees.nwk` });
  out.push({
    comment: "coalescent species tree (handles incomplete lineage sorting)",
    line: "astral -i gene_trees.nwk -o species_tree.nwk",
  });
  out.push({
    comment: "ASTRAL output is unrooted, root the species tree in the Tree Studio",
    line: "",
  });
  out.push({ comment: "result: species_tree.nwk (open it in the Tree Studio)", line: "" });
  return out;
}

function commandLines(o: BuilderOptions): Line[] {
  if (o.analysis === "supermatrix") return supermatrixLines(o);
  if (o.analysis === "coalescent") return coalescentLines(o);
  return singleLines(o);
}

// ----------------------------------------------------------------------------
// conda environment
// ----------------------------------------------------------------------------

/** The conda packages required by the current selection, version-pinned. */
function condaPackages(o: BuilderOptions): string[] {
  const pkgs: string[] = [];
  const usesAlign = o.have !== "alignment" && o.align !== "skip";
  if (usesAlign) {
    const a = findOption(ALIGN_TOOLS, o.align);
    if (a?.conda) pkgs.push(a.conda);
  }
  if (o.trim !== "skip") {
    const t = findOption(TRIM_TOOLS, o.trim);
    if (t?.conda) pkgs.push(t.conda);
  }
  // Supermatrix always uses IQ-TREE; coalescent substitutes IQ-TREE for MrBayes per-gene.
  const inferTool =
    o.analysis === "supermatrix"
      ? "iqtree"
      : o.analysis === "coalescent" && o.infer === "mrbayes"
        ? "iqtree"
        : o.infer;
  const inf = findOption(INFER_TOOLS, inferTool);
  if (inf?.conda) pkgs.push(inf.conda);

  // Pipeline-only pins.
  if (o.analysis === "supermatrix" || (o.analysis === "single" && o.infer === "mrbayes")) {
    pkgs.push(PIPELINE_CONDA.amas);
  }
  if (o.analysis === "coalescent") pkgs.push(PIPELINE_CONDA.astral);

  // De-dup while preserving order.
  return pkgs.filter((p, i) => pkgs.indexOf(p) === i);
}

export function generateEnvYaml(o: BuilderOptions): string {
  const deps = condaPackages(o)
    .map((p) => `  - ${p}`)
    .join("\n");
  return ["name: phylo", "channels:", "  - conda-forge", "  - bioconda", "dependencies:", deps].join("\n");
}

export function generateInstall(o: BuilderOptions): string {
  const tail = [
    "",
    COMMENT("one environment pins every tool so the run is reproducible"),
    "conda env create -f environment.yml",
    "conda activate phylo",
  ];
  if (o.os === "mac") {
    return [
      COMMENT("Install Miniforge (conda) once. Works on Apple Silicon and Intel."),
      "brew install miniforge",
      'conda init "$(basename $SHELL)"',
      ...tail,
    ].join("\n");
  }
  if (o.os === "windows") {
    return [
      COMMENT("Windows: run the tools under WSL2 (Ubuntu), the bioinformatics standard."),
      "wsl --install -d Ubuntu",
      COMMENT("Then, inside the Ubuntu shell:"),
      "curl -L -O https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh",
      "bash Miniforge3-Linux-x86_64.sh",
      ...tail,
    ].join("\n");
  }
  return [
    COMMENT("Linux: install Miniforge (conda)."),
    "curl -L -O https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh",
    "bash Miniforge3-Linux-x86_64.sh",
    ...tail,
  ].join("\n");
}

// ----------------------------------------------------------------------------
// Output assembly
// ----------------------------------------------------------------------------

export function generateCommands(o: BuilderOptions): string {
  return commandLines(o)
    .map(({ line, comment }) => {
      const c = comment ? COMMENT(comment) : "";
      if (c && line) return `${c}\n${line}`;
      return c || line;
    })
    .join("\n\n")
    .trimEnd();
}

export function generateRunScript(o: BuilderOptions): string {
  const lines = commandLines(o)
    .map((c) => c.line)
    .filter((l) => l && !l.startsWith("#"));
  return ["#!/usr/bin/env bash", "set -euo pipefail", "", ...lines, ""].join("\n");
}

export function generateRecipe(o: BuilderOptions): RecipeOutput {
  const commands = generateCommands(o);
  const install = generateInstall(o);
  const envYaml = generateEnvYaml(o);
  const runScript = generateRunScript(o);
  const markdown = [
    "# Tree-building recipe",
    "",
    "Generated by ResearchOS. Nothing ran on a server, these are the exact commands to run on your machine.",
    "",
    `Analysis: ${o.analysis}, ${o.dataType} data.`,
    "",
    "## 1. Install the tools",
    "",
    "```bash",
    install,
    "```",
    "",
    "Save this as `environment.yml`:",
    "",
    "```yaml",
    envYaml,
    "```",
    "",
    "## 2. Run the pipeline",
    "",
    "```bash",
    commands,
    "```",
    "",
  ].join("\n");
  return { commands, install, envYaml, runScript, markdown };
}
