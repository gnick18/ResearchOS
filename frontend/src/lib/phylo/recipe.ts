// The recipe generator (phylo Phase 1, 2026-06-12).
//
// PURE + DETERMINISTIC: BuilderOptions in, recipe strings out. No DOM, no I/O, so
// it is fully unit-testable (recipe.test.ts) and reused identically by the wizard
// UI and the BeakerBot plain-language path. Nothing here runs a tool, it only
// writes the exact commands the researcher runs on their own machine. The flags
// and pins come from the verified catalog.
//
// Design: docs/proposals/2026-06-12-phylogenetics-page.md section 3a.

import {
  type BuilderOptions,
  ALIGN_TOOLS,
  TRIM_TOOLS,
  INFER_TOOLS,
  findOption,
} from "./catalog";

export interface RecipeOutput {
  /** The ordered shell commands, with "# why" comment lines. */
  commands: string;
  /** The OS-specific install block (Miniforge + conda env). */
  install: string;
  /** A conda environment.yml pinning only the chosen tools. */
  envYaml: string;
  /** A single run.sh body (commands only, no comments stripped). */
  runScript: string;
  /** The full recipe as one markdown document (header + install + commands). */
  markdown: string;
}

const COMMENT = (s: string) => `# ${s}`;

/** The conda packages required by the current selection, version-pinned. */
function condaPackages(o: BuilderOptions): string[] {
  const pkgs: string[] = [];
  if (o.have !== "alignment" && o.align !== "skip") {
    const a = findOption(ALIGN_TOOLS, o.align);
    if (a?.conda) pkgs.push(a.conda);
  }
  if (o.trim !== "skip") {
    const t = findOption(TRIM_TOOLS, o.trim);
    if (t?.conda) pkgs.push(t.conda);
  }
  const inf = findOption(INFER_TOOLS, o.infer);
  if (inf?.conda) pkgs.push(inf.conda);
  return pkgs;
}

export function generateEnvYaml(o: BuilderOptions): string {
  const deps = condaPackages(o)
    .map((p) => `  - ${p}`)
    .join("\n");
  return [
    "name: phylo",
    "channels:",
    "  - conda-forge",
    "  - bioconda",
    "dependencies:",
    deps,
  ].join("\n");
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

/** Build the ordered command lines (array form so run.sh can drop the comments). */
function commandLines(o: BuilderOptions): { line: string; comment?: string }[] {
  const aa = o.dataType === "protein";
  const codon = o.dataType === "codon";
  const big = o.nTaxa > 200;
  const out: { line: string; comment?: string }[] = [];

  // alignment
  let aln = "input_alignment.fasta";
  if (o.have !== "alignment" && o.align !== "skip") {
    aln = "alignment.fasta";
    if (o.align === "mafft") {
      out.push({
        comment: big
          ? "align with MAFFT in auto mode (it picks a fast strategy for a large set)"
          : "align with MAFFT L-INS-i (accurate, good for a smaller set)",
        line: big
          ? `mafft --auto input.fasta > ${aln}`
          : `mafft --maxiterate 1000 --localpair input.fasta > ${aln}`,
      });
    } else if (o.align === "muscle") {
      out.push({ comment: "align with MUSCLE5", line: `muscle -align input.fasta -output ${aln}` });
    } else {
      out.push({
        comment: "align with Clustal Omega",
        line: `clustalo -i input.fasta -o ${aln} --outfmt=fasta --force`,
      });
    }
    if (codon) {
      out.push({
        comment: "codon data: align as protein then back-translate, or use a codon-aware aligner (MACSE) if frameshifts are expected",
        line: "# (codon-aware alignment is dataset-specific, see the note above)",
      });
    }
  }

  // trimming
  let trimmed = aln;
  if (o.trim !== "skip") {
    trimmed = "trimmed.fasta";
    if (o.trim === "trimal") {
      out.push({
        comment: "remove poorly aligned columns (automated heuristic for ML trees)",
        line: `trimal -in ${aln} -out ${trimmed} -automated1`,
      });
    } else if (o.trim === "clipkit") {
      out.push({
        comment: "trim with the smart-gap heuristic (keeps informative sites)",
        line: `clipkit ${aln} -o ${trimmed} -m smart-gap`,
      });
    } else {
      const gbType = aa ? "p" : codon ? "c" : "d";
      out.push({
        comment: "select conserved blocks with Gblocks, then rename its output",
        line: `Gblocks ${aln} -t=${gbType} -b5=h; mv ${aln}-gb ${trimmed}`,
      });
    }
  }

  // inference
  const fixedModel = aa ? "LG+G" : "GTR+G";
  if (o.infer === "iqtree") {
    const mflag = o.model === "modelfinder" ? "-m MFP" : `-m ${fixedModel}`;
    let s = `iqtree2 -s ${trimmed} ${mflag} -T AUTO --prefix tree`;
    if (o.support === "ufboot") s += " -B 1000 -alrt 1000";
    else if (o.support === "bootstrap") s += " -b 100";
    out.push({
      comment:
        o.model === "modelfinder"
          ? "ModelFinder picks the best model, then IQ-TREE infers the ML tree"
          : "infer the ML tree under a fixed model",
      line: s,
    });
    out.push({ comment: "result: tree.treefile (open it in the Tree Studio)", line: "" });
  } else if (o.infer === "raxml") {
    let s = `raxml-ng --all --msa ${trimmed} --model ${fixedModel} --prefix tree`;
    if (o.support !== "none") s += " --bs-trees 1000";
    out.push({
      comment: "RAxML-NG does the ML search and, with --all, maps bootstrap support onto it",
      line: s,
    });
    out.push({ comment: "result: tree.raxml.support (open it in the Tree Studio)", line: "" });
  } else if (o.infer === "fasttree") {
    out.push({
      comment: "FastTree is approximate but scales to thousands of taxa (support is the built-in SH-like test)",
      line: `FastTree ${aa ? "" : "-nt -gtr "}${trimmed} > tree.nwk`,
    });
    out.push({ comment: "result: tree.nwk (open it in the Tree Studio)", line: "" });
  } else {
    out.push({
      comment: "Bayesian inference: convert the alignment to NEXUS, add a MrBayes block (set ngen, samplefreq, then sump/sumt), then run",
      line: `mb tree.nex`,
    });
    out.push({ comment: "result: tree.nex.con.tre (open it in the Tree Studio)", line: "" });
  }
  return out;
}

export function generateCommands(o: BuilderOptions): string {
  const header = COMMENT(
    `Recipe for ${o.nTaxa} taxa, ${o.nSites} sites, ${o.dataType} data`,
  );
  const body = commandLines(o)
    .map(({ line, comment }) => {
      const c = comment ? COMMENT(comment) + "\n" : "";
      return c + line;
    })
    .join("\n\n");
  return `${header}\n\n${body}`.trimEnd();
}

export function generateRunScript(o: BuilderOptions): string {
  const lines = commandLines(o)
    .map((c) => c.line)
    .filter((l) => l && !l.startsWith("#"));
  return ["#!/usr/bin/env bash", "set -euo pipefail", "", ...lines, ""].join("\n");
}

/** Rough runtime caution sized to the dataset, so big runs do not surprise people. */
function runtimeNote(o: BuilderOptions): string {
  if (o.infer === "mrbayes")
    return "Bayesian runs can take hours to days. Check the standard deviation of split frequencies for convergence.";
  if (o.nTaxa > 1000)
    return "Over a thousand taxa is heavy for full ML. FastTree is the practical choice at this scale, or expect long IQ-TREE / RAxML runtimes on many cores.";
  if (o.nTaxa > 200)
    return "A few hundred taxa runs comfortably on a laptop with several cores. Give IQ-TREE a few minutes to an hour depending on sites.";
  return "This size runs in seconds to minutes on a laptop.";
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
    `Dataset: ${o.nTaxa} taxa, ${o.nSites} sites, ${o.dataType} data.`,
    "",
    `> ${runtimeNote(o)}`,
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
