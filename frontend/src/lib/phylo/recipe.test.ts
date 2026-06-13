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

describe("recipe generator: single locus", () => {
  it("emits the default MAFFT -> trimAl -> IQ-TREE pipeline", () => {
    const c = generateCommands(opt());
    expect(c).toContain("mafft --auto input.fasta > alignment.fasta");
    expect(c).toContain("trimal -in alignment.fasta -out trimmed.fasta -automated1");
    expect(c).toContain(
      "iqtree2 -s trimmed.fasta -m MFP -T AUTO --prefix tree -B 1000 -alrt 1000 -bnni",
    );
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

  it("uses the fixed model verbatim and LG+G default for protein RAxML", () => {
    expect(generateCommands(opt({ model: "fixed", fixedModel: "GTR+I+G" }))).toContain("-m GTR+I+G");
    const r = generateCommands(opt({ dataType: "protein", infer: "raxml" }));
    expect(r).toContain("--model LG+G");
  });

  it("emits the right Gblocks type flag per data type", () => {
    expect(generateCommands(opt({ trim: "gblocks" }))).toContain("-t=d");
    expect(generateCommands(opt({ trim: "gblocks", dataType: "protein" }))).toContain("-t=p");
  });

  it("switches inference engines", () => {
    expect(generateCommands(opt({ infer: "raxml" }))).toContain("raxml-ng --all");
    expect(generateCommands(opt({ infer: "fasttree" }))).toContain("FastTree -nt -gtr");
    expect(generateCommands(opt({ infer: "fasttree", dataType: "protein" }))).not.toContain("-nt -gtr");
  });

  it("maps support choices onto IQ-TREE flags", () => {
    expect(generateCommands(opt({ support: "bootstrap" }))).toContain("-b 1000");
    const none = generateCommands(opt({ support: "none" }));
    expect(none).not.toContain("-B 1000");
    expect(none).not.toContain("-b 1000");
  });

  it("uses bsReps for standard bootstrap", () => {
    expect(generateCommands(opt({ support: "bootstrap", bsReps: 500 }))).toContain("-b 500");
  });
});

describe("recipe generator: advanced flags", () => {
  it("appends +ASC when ascertainment bias is on", () => {
    expect(generateCommands(opt({ asc: true }))).toContain("-m MFP+ASC");
    expect(generateCommands(opt({ asc: true, model: "fixed", fixedModel: "GTR+G" }))).toContain(
      "-m GTR+G+ASC",
    );
  });

  it("adds -mset only when restrictModels is on", () => {
    expect(generateCommands(opt())).not.toContain("-mset");
    expect(generateCommands(opt({ restrictModels: true }))).toContain("-mset GTR,HKY,K80,JC");
    expect(generateCommands(opt({ restrictModels: true, dataType: "protein" }))).toContain(
      "-mset LG,WAG,JTT",
    );
  });

  it("adds -bnni only when bnni is on and support is ufboot", () => {
    expect(generateCommands(opt({ bnni: true }))).toContain("-bnni");
    expect(generateCommands(opt({ bnni: false }))).not.toContain("-bnni");
    expect(generateCommands(opt({ bnni: true, support: "bootstrap" }))).not.toContain("-bnni");
  });

  it("honors the threads option", () => {
    expect(generateCommands(opt({ threads: "8" }))).toContain("-T 8");
    expect(generateCommands(opt({ infer: "raxml", threads: "8" }))).toContain("--threads 8");
    expect(generateCommands(opt({ infer: "raxml" }))).toContain("--threads auto");
  });

  it("adds the outgroup flag for IQ-TREE only when set", () => {
    expect(generateCommands(opt())).not.toContain(" -o ");
    expect(generateCommands(opt({ outgroup: "Drosophila" }))).toContain("-o Drosophila");
  });
});

describe("recipe generator: supermatrix", () => {
  it("emits the per-gene loop and AMAS concat line", () => {
    const c = generateCommands(opt({ analysis: "supermatrix" }));
    expect(c).toContain("for f in genes/*.fasta; do");
    expect(c).toContain(
      "AMAS.py concat -i genes/*.trim -f fasta -d dna -u fasta -t supermatrix.fasta -p partitions.txt --part-format raxml",
    );
    expect(c).not.toContain("--codons 123");
  });

  it("adds --codons 123 only for the gene+codon scheme", () => {
    expect(generateCommands(opt({ analysis: "supermatrix", partScheme: "gene_codon" }))).toContain(
      "--part-format raxml --codons 123",
    );
  });

  it("skips AMAS and infers directly when the supermatrix is already concatenated (have=alignment)", () => {
    const c = generateCommands(opt({ analysis: "supermatrix", have: "alignment" }));
    // No per-gene align/concat step; infer straight from the committed matrix + partition.
    expect(c).not.toContain("AMAS.py concat");
    expect(c).not.toContain("for f in genes/");
    expect(c).toContain("iqtree2 -s input_alignment.fasta -p partitions.nex -m MFP");
  });

  it("uses MFP+MERGE only for the merge scheme", () => {
    expect(generateCommands(opt({ analysis: "supermatrix", partScheme: "merge" }))).toContain(
      "-m MFP+MERGE",
    );
    expect(generateCommands(opt({ analysis: "supermatrix", partScheme: "gene" }))).not.toContain(
      "MFP+MERGE",
    );
  });

  it("uses the chosen branch-length mode and partition file", () => {
    expect(generateCommands(opt({ analysis: "supermatrix", brlen: "Q" }))).toContain(
      "iqtree2 -s supermatrix.fasta -Q partitions.txt",
    );
  });

  it("always uses IQ-TREE regardless of the inference pick", () => {
    const c = generateCommands(opt({ analysis: "supermatrix", infer: "raxml" }));
    expect(c).toContain("iqtree2 -s supermatrix.fasta");
    expect(c).not.toContain("raxml-ng");
  });
});

describe("recipe generator: coalescent", () => {
  it("emits the per-gene loop, cat, and ASTRAL with no rooting flag", () => {
    const c = generateCommands(opt({ analysis: "coalescent" }));
    expect(c).toContain("for f in genes/*.fasta; do");
    expect(c).toContain("cat genes/*.treefile > gene_trees.nwk");
    expect(c).toContain("astral -i gene_trees.nwk -o species_tree.nwk");
    // ASTRAL is unrooted, no outgroup/rooting flag even if outgroup set.
    const withOg = generateCommands(opt({ analysis: "coalescent", outgroup: "Drosophila" }));
    expect(withOg).not.toContain("-o Drosophila");
  });

  it("uses the inference pick per-gene", () => {
    expect(generateCommands(opt({ analysis: "coalescent", infer: "raxml" }))).toContain(
      "cat genes/*.raxml.support > gene_trees.nwk",
    );
    expect(generateCommands(opt({ analysis: "coalescent", infer: "fasttree" }))).toContain(
      "cat genes/*.nwk > gene_trees.nwk",
    );
  });

  it("falls back to IQ-TREE per-gene when MrBayes is picked", () => {
    const c = generateCommands(opt({ analysis: "coalescent", infer: "mrbayes" }));
    expect(c).toContain("MrBayes is impractical per-gene");
    expect(c).toContain('iqtree2 -s "$base.trim"');
    expect(c).toContain("cat genes/*.treefile > gene_trees.nwk");
  });
});

describe("recipe generator: MrBayes scaffold", () => {
  it("emits the NEXUS convert + MrBayes block for single + mrbayes", () => {
    const c = generateCommands(opt({ infer: "mrbayes" }));
    expect(c).toContain("AMAS.py convert -d dna -f fasta -i trimmed.fasta -u nexus");
    expect(c).toContain("begin mrbayes;");
    expect(c).toContain("lset nst=6 rates=invgamma;");
    expect(c).toContain("mb tree.nex");
  });

  it("uses the protein prset block for protein data", () => {
    const c = generateCommands(opt({ infer: "mrbayes", dataType: "protein" }));
    expect(c).toContain("prset aamodelpr=fixed(wag);");
    expect(c).toContain("AMAS.py convert -d aa");
  });
});

describe("recipe generator: environment.yml", () => {
  it("pins only the chosen tools for single locus", () => {
    const y = generateEnvYaml(opt());
    expect(y).toContain("mafft=7.526");
    expect(y).toContain("trimal=1.5.0");
    expect(y).toContain("iqtree=2.3.6");
    expect(y).not.toContain("muscle");
    expect(y).not.toContain("amas");
    expect(y).not.toContain("astral-tree");
    expect(generateEnvYaml(opt({ have: "alignment" }))).not.toContain("mafft");
  });

  it("adds amas for supermatrix and for single + mrbayes", () => {
    expect(generateEnvYaml(opt({ analysis: "supermatrix" }))).toContain("amas=1.0");
    expect(generateEnvYaml(opt({ infer: "mrbayes" }))).toContain("amas=1.0");
    expect(generateEnvYaml(opt({ infer: "mrbayes" }))).toContain("mrbayes=3.2.7");
  });

  it("adds astral-tree for coalescent", () => {
    expect(generateEnvYaml(opt({ analysis: "coalescent" }))).toContain("astral-tree=5.7.1");
  });
});

describe("recipe generator: install + run.sh + markdown", () => {
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

describe("recipe generator: -T AUTO warning", () => {
  it("warns about -T AUTO and suggests a fixed -T when threads is AUTO", () => {
    const c = generateCommands(opt({ threads: "AUTO" }));
    expect(c).toContain("re-measures");
    expect(c).toContain("-T 4");
  });
  it("omits the warning when the user picked a fixed thread count", () => {
    const c = generateCommands(opt({ threads: "8" }));
    expect(c).not.toContain("re-measures");
    expect(c).toContain("-T 8");
  });
  it("warns on the supermatrix pipeline too when AUTO", () => {
    const c = generateCommands(opt({ analysis: "supermatrix", threads: "AUTO" }));
    expect(c).toContain("re-measures");
  });
  it("warns on the coalescent per-gene loop (always small alignments)", () => {
    const c = generateCommands(opt({ analysis: "coalescent" }));
    expect(c).toContain("per-gene alignments are small");
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
