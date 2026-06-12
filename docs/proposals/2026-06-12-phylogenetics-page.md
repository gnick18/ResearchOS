# Phylogenetics Page Proposal (the recipe book + the iTOL alternative)

Status: design draft, 2026-06-12. Author: phylo lane. Vision from Grant (a bioinformatician), captured verbatim in `[[project_phylogenetics_page]]`. This doc is the design before any code; the interactive mockup for change-by-change review follows it.

## 1. What we are building

A new top-level **Phylogenetics** tab, a sibling to Chemistry and Data Hub. Fully client-side, no backend, no server compute by design (cost-minimizing is the whole point). Flag-gated `NEXT_PUBLIC_PHYLO_ENABLED`, default off, flipped in Vercel when ready, same rollout as Chemistry and Data Hub.

Making a phylogenetic tree is conceptually accessible to any biologist but mechanically code-heavy, and you run the same handful of tools over and over (align, trim, model-select, infer, support) with different parameters. The page attacks that two ways, which are the two halves of the tab.

**1. Tree Builder (the recipe book).** A wizard that NEVER runs anything. It generates the exact commands. You describe your input and the steps you want, and you get a clean, copy-able recipe with the precise IQ-TREE / MAFFT / trimAl style commands, an OS-specific dependency and install list, and the why behind each step. Same spirit as the Data Hub "what analysis are you doing" chooser. Two ways in, a deterministic choose-your-options form and a BeakerBot plain-language path.

**2. Tree Studio (the iTOL alternative).** You bring a finished tree, link a metadata table, auto-annotate, and edit the figure in the Illustrator-style canvas we already built for Data Hub. You see and edit a native SVG in the browser, and you export both the figure (SVG + hi-DPI PNG) and the reproducible ggtree / ggtreeExtra R code that recreates it, because some journals require the plotting code.

We do not infer trees in the app, ever (Grant's rule). The Builder produces the script you run on your own machine; the Studio renders and annotates the tree that script gave you.

## 2. Locked decisions

- **Native JS rendering, not webR (Grant, 2026-06-12).** The live Studio figure renders in our own SVG layer (the Data Hub figure-maker engine family), for snappiness and instant drag-to-edit. ggtree / ggtreeExtra code is the EXPORT and reproducibility artifact, not the live renderer. We warn users the exported ggtree is close but not 100% pixel-identical. webR was rejected (multi-MB WASM download, slow re-render, uncertain Bioconductor binary availability). This mirrors the house pattern Data Hub set, compute and render natively, then show the equivalent code.
- **No server compute, ever.** The Builder is pure templating (a parameter form filling a curated command catalog). The Studio is pure client-side parsing, layout, and SVG.
- **No tree inference in the app.** Explicitly out of scope, including JS distance methods (NJ/UPGMA). The app generates scripts and renders results, it does not build trees.
- **The command catalog is a verified asset, not LLM free-text.** Tool names, flags, and defaults live in a curated, reviewed catalog (the same discipline as the method catalog and the vendor-spec-verbatim rule). The BeakerBot path FILLS that catalog, it never invents flags. Grant signs off on the default tool choices, the way new icons need sign-off.

## 3. The two surfaces in detail

### 3a. Tree Builder (the recipe book)

A short stepped wizard. Every answer narrows the catalog and fills command placeholders. No answer triggers any compute.

Inputs the wizard collects:
- **Data type:** nucleotide, protein, or codon-aware.
- **What you have:** raw unaligned FASTA, an existing alignment, or sequences already in ResearchOS (pulls from the Sequences library).
- **Scale:** rough taxa count and sequence length, which drives tool defaults and runtime / RAM cautions (e.g. FastTree vs IQ-TREE for very large sets).
- **Single vs multi-locus:** one gene, or concatenated and partitioned (drives a partition file step).
- **Steps you want and their parameters,** each step optional and each with a sane default:
  - **Align:** MAFFT (default, mode auto-picked by size, L-INS-i vs FFT-NS-2), MUSCLE5, or Clustal Omega. Codon-aware option (MACSE) when data type is codon.
  - **Trim / filter:** trimAl (gappyout / automated1 / gt), ClipKIT (smart-gap), Gblocks, or BMGE.
  - **Model selection:** ModelFinder (IQ-TREE `-m MFP`), with a note on ProtTest / jModelTest for other engines.
  - **Inference:** IQ-TREE 2 (ML, default), RAxML-NG (ML), FastTree (fast and approximate for big trees), or MrBayes (Bayesian).
  - **Branch support:** UFBoot2 + SH-aLRT (default), standard nonparametric bootstrap, or aBayes.
  - **Rooting:** outgroup taxa, or midpoint, applied as a downstream note (rooting is usually done in the Studio).
- **Platform:** Windows, macOS, or Linux, which tailors the install block.

Output is a single formatted recipe (markdown) with:
- A **dependency block** with a recommended cross-platform `conda` / `mamba` `environment.yml`, plus a copy-paste install for the chosen platform (Homebrew on macOS with Apple-Silicon caveats, WSL2 or conda on Windows, conda or apt on Linux), and version pins so the recipe is reproducible.
- The **ordered commands**, placeholders filled from the inputs, each with a one-line why and the expected output files.
- **Runtime and memory cautions** sized to the dataset.
- One-click **"Save as a ResearchOS method"** (the recipe becomes a reusable protocol in the Methods library) or **"Save as a note."** Optional downloads, the `environment.yml` and a single `run.sh`.

The **BeakerBot path** is the same recipe assembled from a plain-language ask ("I have 50 fungal genomes and want a species tree from single-copy orthologs"). BeakerBot calls a tool that fills the curated catalog template; the catalog owns the flags so the model cannot hallucinate them. This is the Data Hub lane split applied here, the assistant consumes and orchestrates, the engine (here the catalog) owns the truth.

### 3b. Tree Studio (the iTOL alternative)

You bring a finished tree, the Studio renders, annotates, and edits it as a native SVG figure.

**Tree input:** upload Newick (`.nwk` / `.treefile`), Nexus, or PhyloXML; paste Newick; or drop back the `.treefile` from a Builder recipe you ran. (Pulling from a ResearchOS alignment just pre-fills the Builder, since we do not infer here.)

**Layouts:** rectangular (phylogram and cladogram), circular / fan, slanted, and unrooted. We reuse the existing Sequences layout primitives (`taxonomy-radial-layout.ts`, `taxonomy-tree.ts`, `circular-label-layout.ts`, `label-layout.ts`) rather than starting from scratch.

**Tree editing:** reroot (outgroup or midpoint), ladderize, collapse / expand and rotate clades, flip, drag-reorder, branch coloring, phylogram-vs-cladogram toggle with a scale bar, and show / hide / color / threshold the support values.

**Metadata linking:** drop a CSV, paste a table, or link a live Data Hub table. Pick the tip-id column (with fuzzy match to tip labels), then map other columns onto annotation tracks. Mismatched or missing tips are surfaced, never silently dropped.

**Annotation tracks (the ggtree / ggtreeExtra analogues):**
- Tip labels (rename, italicize species), tip point shapes and colors (categorical).
- Color strips (one or many concentric or column bands), continuous / gradient color.
- Aligned bar charts (the `geom_fruit` bar), heatmap panels (`gheatmap`), boxplot / violin fruits.
- Alignment view beside the tree (`msaplot`).
- Clade highlight blocks and clade labels (bracket plus text).
- Node pie charts (ancestral-state style), free text annotations, and optionally tip images (silhouettes).

**Figure editor:** the Data Hub Illustrator-style canvas, layers panel, drag, type, color pickers, legends, fonts, and multi-panel composition. Export reuses the Data Hub exporter, SVG + hi-DPI PNG + copy-to-clipboard.

**ggtree code export:** generated from the figure spec, mirroring `datahub/plot-code.ts` and `datahub/show-code.ts`. It emits a runnable ggtree + ggtreeExtra R script (`read.tree`, the metadata join via `%<+%`, the `geom_*` and `geom_fruit` layers, theme and scales) with the honest "close but not pixel-identical" caveat at the top.

## 4. On-disk shape (mirrors the molecule and sequence libraries)

```
users/<owner>/phylo/
├── <id>.tree          ← raw tree text (Newick / Nexus / PhyloXML as imported)
└── <id>.meta.json     ← PhyloMeta
```

`PhyloMeta` carries: `name`, `project_ids[]`, source format, tip count, source (`upload` / `paste` / `builder`), `created_at` / `updated_at`, the bound metadata table (or a reference to a Data Hub table id), and the **figure spec** (layout, tracks, colors, edits) that the native renderer and the ggtree exporter both read. One record holds the tree plus its figure, the way a Data Hub doc holds data plus its analyses and plots. JSON for v1; Loro cell-level VC is a possible later upgrade, not needed at launch. This is additive, it touches no existing on-disk shape.

## 5. What we reuse (so this is not a from-scratch build)

- **Tree layout:** Sequences `taxonomy-radial-layout.ts`, `taxonomy-tree.ts`, `circular-label-layout.ts`, `label-layout.ts`.
- **Figure spec + show-the-code + palettes:** Data Hub `plot-spec.ts`, `plot-code.ts`, `show-code.ts`, `palettes.ts`, `user-palettes.ts`, and the SVG export path.
- **On-disk store pattern:** `chemistry/molecule-store.ts` and `sequences/sequence-store.ts`.
- **Embeds:** a new `"phylo"` ObjectRefType alongside the existing `"datahub"` / `"molecule"` types, a `/phylo?doc=<id>` deep link, an ObjectChip, and a Copy-reference button, so a tree figure renders live inside notes and experiments.
- **Metadata source:** the Data Hub table API, read-only, for the link-a-table path.
- **BeakerBot:** consume-only tools under `lib/ai/`, coordinated with the BeakerAI lane (do not duplicate their tools; relay specs).

## 6. Suggested phasing

- **Phase 0:** flag, route stub, nav tab, `PhyloMeta` seam, `phylo/` store. (Plumbing, no UI risk.)
- **Phase 1:** Tree Builder wizard (deterministic chooser, curated command catalog, recipe markdown, OS-aware install block, save-as-method / note, env.yml + run.sh download). High value, zero rendering risk, ships first.
- **Phase 2:** Tree Studio core (Newick / Nexus parse, rectangular + circular layout, reroot / collapse / ladderize / color, SVG + PNG export). Reuses the Sequences layout primitives.
- **Phase 3:** metadata linking + annotation tracks (strips, bars, heatmap, clade highlights, tip points, alignment view).
- **Phase 4:** ggtree / ggtreeExtra code export.
- **Phase 5:** BeakerBot path for both halves (consume-only), embeds, wiki page `/wiki/features/phylogenetics` + `APP_ROUTE_TO_WIKI`.

## 7. Open items for Grant

- **Naming.** Tab name (Phylogenetics, Phylo, Tree Studio?) and the two halves (working names Tree Builder and Tree Studio).
- **Command catalog defaults.** Sign-off on the default tool per step (MAFFT, trimAl, ModelFinder, IQ-TREE 2, UFBoot2) and which alternates to expose. This is a verified asset, like a new icon.
- **Newick / Nexus parser.** Tiny in-house parser vs a small MIT-licensed dependency (decide during Phase 2).
- **ggtree fidelity caveat copy.** Exact wording of the "close but not identical" note on the code export.
- **Reference figures.** Grant offered his GitHub repos; the highest-value use is mining the specific tree figures he actually publishes so the Studio targets real annotation needs, not a generic checklist.

House voice applies to every string and the mockup copy, no em-dashes, no emojis, no mid-sentence colons, state the why, BeakerBot is the mascot.
