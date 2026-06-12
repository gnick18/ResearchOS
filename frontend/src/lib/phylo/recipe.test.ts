import { describe, it, expect } from "vitest";

import { DEFAULT_OPTIONS, type BuilderOptions } from "./catalog";
import {
  generateRecipe,
  generateCommands,
  generateEnvYaml,
  generateInstall,
  generateRunScript,
} from "./recipe";
import { countNewickTips } from "./newick";

const opt = (over: Partial<BuilderOptions> = {}): BuilderOptions => ({
  ...DEFAULT_OPTIONS,
  ...over,
});

describe("recipe generator", () => {
  it("produces the default MAFFT -> trimAl -> IQ-TREE pipeline", () => {
    const c = generateCommands(opt());
    expect(c).toContain("mafft");
    expect(c).toContain("trimal -in alignment.fasta -out trimmed.fasta -automated1");
    expect(c).toContain("iqtree2 -s trimmed.fasta -m MFP -T AUTO --prefix tree -B 1000 -alrt 1000");
  });

  it("uses L-INS-i for small sets and auto for large sets", () => {
    expect(generateCommands(opt({ nTaxa: 30 }))).toContain("--maxiterate 1000 --localpair");
    expect(generateCommands(opt({ nTaxa: 500 }))).toContain("mafft --auto");
  });

  it("skips alignment when the input is already aligned", () => {
    const c = generateCommands(opt({ have: "alignment" }));
    expect(c).not.toContain("mafft");
    expect(c).toContain("trimal -in input_alignment.fasta");
  });

  it("infers from the full alignment when trimming is skipped", () => {
    const c = generateCommands(opt({ trim: "skip" }));
    expect(c).not.toContain("trimal");
    expect(c).toContain("iqtree2 -s alignment.fasta");
  });

  it("uses LG+G for protein under a fixed model", () => {
    const c = generateCommands(opt({ dataType: "protein", model: "fixed" }));
    expect(c).toContain("-m LG+G");
  });

  it("emits the right Gblocks type flag per data type", () => {
    expect(generateCommands(opt({ trim: "gblocks" }))).toContain("-t=d");
    expect(generateCommands(opt({ trim: "gblocks", dataType: "protein" }))).toContain("-t=p");
    expect(generateCommands(opt({ trim: "gblocks", dataType: "codon" }))).toContain("-t=c");
  });

  it("switches inference engines", () => {
    expect(generateCommands(opt({ infer: "raxml" }))).toContain("raxml-ng --all");
    expect(generateCommands(opt({ infer: "fasttree" }))).toContain("FastTree -nt -gtr");
    expect(generateCommands(opt({ infer: "fasttree", dataType: "protein" }))).not.toContain("-nt -gtr");
    expect(generateCommands(opt({ infer: "mrbayes" }))).toContain("mb tree.nex");
  });

  it("maps support choices onto IQ-TREE flags", () => {
    expect(generateCommands(opt({ support: "bootstrap" }))).toContain("-b 100");
    const none = generateCommands(opt({ support: "none" }));
    expect(none).not.toContain("-B 1000");
    expect(none).not.toContain("-b 100");
  });

  it("pins only the chosen tools in environment.yml", () => {
    const y = generateEnvYaml(opt());
    expect(y).toContain("mafft=7.526");
    expect(y).toContain("trimal=1.5.0");
    expect(y).toContain("iqtree=2.3.6");
    expect(y).not.toContain("muscle");
    // skipping alignment drops the aligner from the env
    expect(generateEnvYaml(opt({ have: "alignment" }))).not.toContain("mafft");
  });

  it("tailors the install block per OS", () => {
    expect(generateInstall(opt({ os: "mac" }))).toContain("brew install miniforge");
    expect(generateInstall(opt({ os: "windows" }))).toContain("wsl --install");
    expect(generateInstall(opt({ os: "linux" }))).toContain("Miniforge3-Linux");
  });

  it("run.sh has a shebang and no comment lines", () => {
    const s = generateRunScript(opt());
    expect(s.startsWith("#!/usr/bin/env bash")).toBe(true);
    const body = s.split("\n").slice(2);
    expect(body.some((l) => l.startsWith("# "))).toBe(false);
    expect(s).toContain("iqtree2");
  });

  it("assembles a full markdown recipe", () => {
    const md = generateRecipe(opt()).markdown;
    expect(md).toContain("# Tree-building recipe");
    expect(md).toContain("## 1. Install the tools");
    expect(md).toContain("## 2. Run the pipeline");
  });
});

describe("newick tip counter", () => {
  it("counts bifurcating and multifurcating trees", () => {
    expect(countNewickTips("(A,B);")).toBe(2);
    expect(countNewickTips("((A,B),C);")).toBe(3);
    expect(countNewickTips("(A,B,C,D);")).toBe(4);
    expect(countNewickTips("((A:0.1,B:0.2):0.3,(C:0.1,D:0.2):0.3);")).toBe(4);
  });
  it("extracts the newick out of surrounding text and returns 0 for none", () => {
    expect(countNewickTips("tree t1 = ((A,B),C);")).toBe(3);
    expect(countNewickTips("no tree here")).toBe(0);
  });
});
