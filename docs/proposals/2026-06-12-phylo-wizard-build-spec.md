# Tree Builder wizard build spec (frozen)

2026-06-12. Vetted with Grant via the in-chat widgets; every flag below is from the official docs (IQ-TREE 2, RAxML-NG, MAFFT, trimAl, ClipKIT, Gblocks, ModelFinder, AMAS README, ASTER/ASTRAL-IV tutorial). This is the contract to apply to `catalog.ts`, `recipe.ts`, `recipe.test.ts`, and `PhyloBuilder.tsx`, and the frozen `BuilderOptions` to re-relay to BeakerAI for its `generate_tree` tool.

House rule reminder: the catalog is a VERIFIED ASSET. The generator is PURE and deterministic. BeakerBot fills `BuilderOptions` from the catalog and calls `generateRecipe`, it never writes a flag. No compute, no inference, the recipe is text the user runs on their own machine.

## Frozen BuilderOptions

```ts
export interface BuilderOptions {
  dataType: "nucleotide" | "protein";
  analysis: "single" | "supermatrix" | "coalescent";
  have: "raw" | "alignment" | "library";
  align: "mafft" | "muscle" | "clustalo" | "skip";
  trim: "trimal" | "clipkit" | "gblocks" | "skip";
  partScheme: "gene" | "gene_codon" | "merge"; // supermatrix only
  brlen: "p" | "q" | "Q";                       // supermatrix only, default "p"
  model: "modelfinder" | "fixed";
  fixedModel: string;                           // used when model === "fixed"
  infer: "iqtree" | "raxml" | "fasttree" | "mrbayes";
  support: "ufboot" | "bootstrap" | "none";
  outgroup: string;                             // "" = none
  os: "mac" | "windows" | "linux";
  // advanced
  bnni: boolean;            // default true  (UFBoot --bnni)
  ufbootReps: number;       // default 1000
  bsReps: number;           // default 1000
  asc: boolean;             // default false (ascertainment bias +ASC)
  restrictModels: boolean;  // default false (-mset common set)
  threads: string;          // "AUTO" (default) or a number-as-string
}
```

DEFAULT_OPTIONS: nucleotide / single / raw / mafft / trimal / gene / p / modelfinder / "GTR+G" / iqtree / ufboot / "" / mac / bnni true / 1000 / 1000 / false / false / "AUTO".

## Catalog option lists (value, label, hint, conda pin)

- dataType: nucleotide "Nucleotide" "DNA or RNA sequences"; protein "Protein" "Amino-acid sequences".
- analysis: single "Single locus" "One gene or region, one tree"; supermatrix "Concatenated supermatrix" "Many genes joined into one partitioned alignment, one ML tree"; coalescent "Coalescent species tree" "Per-gene trees summarized with ASTRAL, accounts for incomplete lineage sorting".
- have: raw "Raw sequences (FASTA)" "Unaligned, start with alignment"; alignment "Alignment(s) already made" "Skip alignment"; library "From Sequences library" "Export the selected sequences to FASTA first".
- align: mafft "MAFFT" "Auto mode picks the strategy" [mafft=7.526]; muscle "MUSCLE5" "High accuracy on smaller sets" [muscle=5.1]; clustalo "Clustal Omega" "Scales to very many sequences" [clustalo=1.2.4]; skip "Skip" "Use my input as-is".
- trim: trimal "trimAl" "Removes poorly aligned columns" [trimal=1.5.0]; clipkit "ClipKIT" "Keeps informative sites" [clipkit=2.3.0]; gblocks "Gblocks" "Conservative blocks" [gblocks=0.91b]; skip "Skip" "Infer from the full alignment".
- partScheme: gene "By gene" "One model per gene"; gene_codon "By gene + codon position" "Split coding genes into 1st/2nd/3rd positions"; merge "Merge similar (+MERGE)" "ModelFinder collapses partitions that fit alike".
- brlen: p "Edge-linked proportional (-p)" "Recommended for a typical analysis"; q "Edge-equal (-q)" "All partitions share branch lengths"; Q "Edge-unlinked (-Q)" "Each partition its own branch lengths".
- model: modelfinder "Let ModelFinder choose" "IQ-TREE tests models and picks the best fit (-m MFP)"; fixed "Pick a model" "Choose or type a substitution model".
- infer: iqtree "IQ-TREE 2" "ML, common default" [iqtree=2.3.6]; raxml "RAxML-NG" "ML, fast on large sets" [raxml-ng=1.2.2]; fasttree "FastTree" "Approximate, scales to thousands" [fasttree=2.1.11]; mrbayes "MrBayes" "Bayesian, posterior support" [mrbayes=3.2.7].
- support: ufboot "UFBoot2 + SH-aLRT" "Fast, the IQ-TREE default"; bootstrap "Standard bootstrap" "Classic nonparametric, slower"; none "None" "Single tree, no support".
- os: mac "macOS" "Miniforge via Homebrew"; windows "Windows" "Run under WSL2 (Ubuntu)"; linux "Linux" "Miniforge installer".

Pipeline-only conda pins (added by the generator when used): `amas=1.0` (supermatrix), `astral-tree=5.7.1` (coalescent).

MODELS presets (the "Pick a model" searchable list, free-text also allowed):
- nucleotide: GTR+G, GTR+I+G, GTR+R4, HKY+G, TN93+G, K80+G, SYM+G, JC
- protein: LG+G, LG+I+G, LG+G+F, WAG+G, JTT+G, Dayhoff+G, Blosum62+G, Q.pfam+G

## Shared model + flag helpers

- modelString: `fixed ? fixedModel : "MFP"`, then append `+ASC` when `asc`.
- mset (only when `restrictModels`): nucleotide `-mset GTR,HKY,K80,JC`, protein `-mset LG,WAG,JTT`.
- threadFlag: IQ-TREE `-T <AUTO|N>`; RAxML `--threads <auto|N>`.
- iqtreeSupport: ufboot -> ` -B <ufbootReps> -alrt 1000` + (` -bnni` when bnni); bootstrap -> ` -b <bsReps>`; none -> "".
- outgroupFlag (IQ-TREE / RAxML paths only): outgroup set -> ` -o <outgroup>`, else "".

## Pipeline 1: single locus

```
# Single-locus <dataType> tree
<align>      # if have != alignment && align != skip
<trim>       # if trim != skip
<infer single>
```
- align mafft: `mafft --auto input.fasta > alignment.fasta`; muscle: `muscle -align input.fasta -output alignment.fasta`; clustalo: `clustalo -i input.fasta -o alignment.fasta --outfmt=fasta --force`. (When have==alignment, input is `input_alignment.fasta` and align is skipped.)
- trim trimal: `trimal -in <aln> -out trimmed.fasta -automated1`; clipkit: `clipkit <aln> -o trimmed.fasta -m smart-gap`; gblocks: `Gblocks <aln> -t=<p|d> -b5=h; mv <aln>-gb trimmed.fasta` (p protein, d nucleotide).
- infer iqtree: `iqtree2 -s trimmed.fasta -m <modelString><mset> <threadFlag> --prefix tree<iqtreeSupport><outgroupFlag>` -> tree.treefile.
- infer raxml: model = fixed ? fixedModel : (nuc "GTR+G" / prot "LG+G"); when not fixed add a comment "RAxML-NG has no model finder, pick a model or run ModelTest-NG; using <model>". `raxml-ng --all --msa trimmed.fasta --model <model>[+ASC] <threadFlag> --prefix tree` + (` --bs-trees <bsReps>` when support != none) -> tree.raxml.support.
- infer fasttree: `FastTree <nuc? "-nt -gtr ":"">trimmed.fasta > tree.nwk` -> tree.nwk.
- infer mrbayes: the scaffold (below).

## Pipeline 2: concatenated supermatrix (ALWAYS IQ-TREE for the tree)

```
# Concatenated supermatrix <dataType> tree
# 1. align + trim each gene (per-gene FASTA in genes/)
for f in genes/*.fasta; do
  base="${f%.fasta}"
  <align "$f" -> "$base.aln">      # if align
  <trim "$base.aln" -> "$base.trim">   # if trim
done
# 2. concatenate into one supermatrix + a RAxML-style partition file
AMAS.py concat -i genes/*.<ext> -f fasta -d <dna|aa> -u fasta -t supermatrix.fasta -p partitions.txt --part-format raxml<codons>
# 3. partitioned ML tree
iqtree2 -s supermatrix.fasta -<brlen> partitions.txt -m <partModel><mset> <threadFlag> --prefix tree<iqtreeSupport><outgroupFlag>
```
- `<ext>` is `trim` if trimming else `aln` if aligning else `fasta`.
- `<codons>` = ` --codons 123` when partScheme === "gene_codon", else "".
- `<partModel>` = fixed ? fixedModel : (partScheme === "merge" ? "MFP+MERGE" : "MFP"). Append `+ASC` when asc.
- The Inference pick is IGNORED for the supermatrix tree (always IQ-TREE, best partition support). It still applies to single + coalescent-per-gene.
- result: tree.treefile.

## Pipeline 3: coalescent species tree (ASTRAL)

```
# Coalescent species tree (ASTRAL) for <dataType> data
# 1. align + trim + a gene tree for each gene (per-gene FASTA in genes/)
for f in genes/*.fasta; do
  base="${f%.fasta}"
  <align "$f" -> "$base.aln">      # if align
  <trim "$base.aln" -> "$base.trim">   # if trim
  <per-gene tree>
done
# 2. collect the gene trees
cat genes/*.<treeExt> > gene_trees.nwk
# 3. coalescent species tree (handles incomplete lineage sorting)
astral -i gene_trees.nwk -o species_tree.nwk
```
- per-gene tree uses the Inference pick: iqtree `iqtree2 -s "$base.<ext>" -m <modelString> -T AUTO -B <ufbootReps> --prefix "$base"` (treeExt = treefile); raxml `raxml-ng --all --msa "$base.<ext>" --model <model> --threads auto --prefix "$base"` (treeExt = raxml.support); fasttree `FastTree <nuc?-nt -gtr:> "$base.<ext>" > "$base.nwk"` (treeExt = nwk). mrbayes is NOT offered per-gene: if infer === mrbayes here, fall back to iqtree per-gene with a comment "MrBayes is impractical per-gene, using IQ-TREE for the gene trees".
- ASTRAL output is UNROOTED, there is no rooting flag. Support = local posterior probabilities. The outgroup field does not apply here, add a comment "root the species tree in the Tree Studio".
- result: species_tree.nwk.

## MrBayes scaffold (single locus, infer === mrbayes)

```
# Bayesian inference with MrBayes
# 1. convert the alignment to NEXUS
AMAS.py convert -d <dna|aa> -f fasta -i trimmed.fasta -u nexus
mv trimmed.fasta-out.nex tree.nex
# 2. a MrBayes block is appended below; tune ngen for your dataset
cat >> tree.nex <<'MB'
begin mrbayes;
  set autoclose=yes nowarn=yes;
  <lsetOrPrset>
  mcmc ngen=1000000 samplefreq=1000 nchains=4 nruns=2;
  sump burnin=250;
  sumt burnin=250;
end;
MB
# 3. run
mb tree.nex
# result: tree.nex.con.tre (check that the average standard deviation of split frequencies is < 0.01 for convergence)
```
- `<lsetOrPrset>` for nucleotide: `lset nst=6 rates=invgamma;` (GTR+I+G). For protein: `prset aamodelpr=fixed(wag);` plus `lset rates=invgamma;`.
- MrBayes pulls `amas=1.0` (for the NEXUS convert) + `mrbayes=3.2.7` into the env.
- MrBayes only meaningful in single-locus; supermatrix forces IQ-TREE; coalescent substitutes IQ-TREE per-gene.

## Install + environment.yml (unchanged from the locked decision)

Install merges with the yml: setup commands (Miniforge per OS) + `conda env create -f environment.yml` + `conda activate phylo`, and the yml is shown alongside with a Download. env.yml = name phylo, channels conda-forge + bioconda, dependencies = the chosen align/trim/infer pins + amas (supermatrix or mrbayes) + astral-tree (coalescent).

## PhyloBuilder.tsx UI

Core steps in order: dataType, analysis, have, align, trim, then (supermatrix only) partScheme + brlen, then model (with the searchable model picker when "Pick a model"), infer, support (IQ-TREE only), an optional outgroup text field, os. A "Show advanced options" toggle reveals: UFBoot --bnni (on/off), UFBoot replicate count, standard bootstrap replicate count, restrict ModelFinder to common models (on/off), ascertainment bias +ASC (on/off), threads (AUTO or a number). Output tabs: Commands (Copy + Download run.sh) and Install (setup commands + environment.yml together + Download environment.yml). Reuse Tooltip + Icon, no native title=, no new icons, brand tokens, no em-dashes / emojis / mid-sentence colons.

## Tests (recipe.test.ts)

Assert per analysis pipeline: single emits the chosen align/trim/infer with the right flags; supermatrix emits the per-gene loop + the AMAS concat line (with --codons 123 only for gene_codon, --part-format raxml always) + `iqtree2 ... -<brlen> partitions.txt` with MFP+MERGE only for merge, and is IQ-TREE regardless of infer; coalescent emits the per-gene loop + `cat ... > gene_trees.nwk` + `astral -i gene_trees.nwk -o species_tree.nwk` with no rooting flag; +ASC appended when asc; -mset only when restrictModels; -bnni only when bnni and ufboot; bootstrap uses bsReps; threads honored; the MrBayes scaffold appears for single+mrbayes; env.yml pins only the chosen tools + amas/astral-tree per pipeline.
