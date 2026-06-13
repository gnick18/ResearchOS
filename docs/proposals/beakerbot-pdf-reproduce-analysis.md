# BeakerBot: reproduce a published analysis from a PDF

Status: design, pending Phylogenetics-lane review of the phylo-dependent parts (outputs 3 and 4).
Owner: BeakerAI lane. Date: 2026-06-12.

## The idea

Attach a paper's PDF to BeakerBot and it fans the paper out into grounded,
approved artifacts in your own folder:

1. A faithful summary of the paper, drafted into a note.
2. The method the authors used, pulled verbatim into your method catalog.
3. The tree analysis pipeline they describe, recreated as a runnable recipe on
   your own sequences (fills BuilderOptions, calls generate_tree).
4. A tree plot that matches the look of a figure in the paper, applied to your
   own tree in the Figure Studio.

The why: reproducing a published phylogenetics analysis on your own data is
slow and error prone by hand. You read the methods, hunt for the tool versions
and flags, rebuild the pipeline, then fight a figure tool to make your tree look
like theirs. BeakerBot already owns the pipeline recipe (generate_tree) and the
figure tooling (Figure Studio), so the paper becomes the one missing input.

## The scope wall (read this first)

This is the FIRST BeakerBot feature that touches content the user did not write.
The hard no-interpretation rule still governs it, with one scoped, deliberate
carve-out Grant signed off for this flow only.

BeakerBot may:
- TRANSCRIBE. A faithful summary of what the paper reports, the method verbatim,
  the parameters extracted as structured values. It states what the paper says,
  not what the paper means.
- OPERATE. Build the pipeline recipe, render the plot, draft the note and method.
- COMPARE, factually (the carve-out). Lay the paper's recipe next to the user's
  as a side by side of facts. "They aligned with MAFFT and built with IQ-TREE
  GTR+G at 1000 bootstraps; your tree used MUSCLE and RAxML." Differences in
  tools, models, parameters, and metadata, stated plainly.

BeakerBot may NOT:
- JUDGE or RANK. Never "their approach is more rigorous", "your bootstrap count
  is low", "this means your tree is unreliable", "you should switch to IQ-TREE".
- CONCLUDE. No scientific finding, no recommendation, no hypothesis.

The line is descriptive vs prescriptive. BeakerBot can put the two recipes on the
table as facts; it cannot tell you which is better or what to do about it. This
carve-out lives ONLY in the reproduce-from-PDF flow and does not relax the global
rule anywhere else.

Every output is a DRAFT shown with its source passage, approved before it writes.
Two reasons: each is a write action (notes, methods), and PDF extraction is the
single highest hallucination-risk thing BeakerBot would ever do, so the same
guardrail as the verbatim vendor-spec rule applies. The source text the
extraction came from is shown next to every drafted value, so the user verifies
against the paper before accepting.

## Architecture

### Ingestion (no backend, client-side)
- Text. Extract the PDF text client-side (pdf.js or equivalent). No upload, the
  file stays in the browser, consistent with local-first.
- Figures. Render the relevant PDF page regions to images for the vision step.
  The user points at (or BeakerBot proposes) which figure is the tree to match.

### Output 1: summary to note
A faithful structural summary (what the paper studied, what they did, what they
report) drafted into a note via the existing draft/approval flow. No findings of
our own, no judgment of the paper.

### Output 2: method to methods
Verbatim extraction of the methods section text into a method-catalog draft.
The drafted method shows the exact source passage it was pulled from. The catalog
shape is the existing static method-catalog JSON shape. No paraphrase of numbers,
the extracted parameters are quoted from the source.

### Output 3: pipeline to generate_tree  [PHYLO REVIEW]
Map the parameters the methods section describes (aligner + version, trimming,
substitution model, tree method, bootstrap/replicate count, rooting, etc.) onto
BuilderOptions from @/lib/phylo/catalog, then call generate_tree to produce the
RecipeOutput (commands / install / envYaml / runScript / markdown). The generator
owns every flag; BeakerBot only fills catalog values, never writes a raw flag.

Open items for the Phylogenetics lane to confirm:
- The param -> BuilderOptions mapping. Which BuilderOptions fields are reliably
  recoverable from a typical methods section, and what the default/fallback is
  when the paper omits one (the methods rarely state every option).
- When the paper names a tool or model the catalog does not have, the desired
  behavior (nearest catalog value + flag it, or ask the user).
- The sequence-ids -> FASTA binding. This is the already-open co-design between
  our lanes. Reproducing the pipeline needs the user's sequences bound to the
  recipe; this feature is a concrete driver for sequencing that binding.

### Output 4: figure to tree plot  [PHYLO REVIEW]
Vision-read the chosen figure and produce an EDITABLE STYLE SPEC (Grant's choice
over a black-box auto-apply), a transparent structured description of the look:
layout (rectangular / circular / radial), tip-label coloring and the color-by
key, palette, branch styling, ordering, support-value display, etc. The spec is
shown and editable, then applied to the user's tree in the Figure Studio. When
the user is missing metadata needed to reproduce a styling (e.g. the clade
grouping the figure colors by), BeakerBot asks for it; if the user does not have
it, it matches as closely as it can and says what it could not reproduce.

Open items for the Phylogenetics lane to confirm:
- The Figure Studio style model. What the canonical style-spec shape is, and
  which aesthetics are actually matchable today vs later.
- The vision-to-spec approach. How a figure region maps to that style spec, and
  the confidence/uncertainty signal so the user knows what was guessed.

### Light comparison (the carve-out, factual only)
After outputs 2 and 3, BeakerBot can render a factual side by side of the paper's
recipe vs the user's tree recipe/metadata. Tools, models, parameters, replicate
counts, rooting. Differences stated as facts, no evaluation. This reuses the
extracted structured params from output 3 on both sides, so it is deterministic,
not a model judgment.

## Dependencies and gates

- Vision-capable model. Output 4 (and figure selection) needs image input. This
  gates on the billing/Fireworks model choice in the AI billing build. Outputs 1
  and 2 are text-only and need no vision.
- generate_tree. Queued in the BeakerAI lane, ready to build now that
  BuilderOptions is frozen. Output 3 depends on it.
- Figure Studio. The iTOL-replacement figure tooling, phylo lane, still maturing.
  Output 4 depends on its style model.
- PDF text extraction. Client-side, straightforward, no gate.

## Readiness by output

- Outputs 1 and 2 (summary to note, method to methods): text-only, no phylo
  dependency, no vision. Buildable independently.
- Output 3 (pipeline): gated on generate_tree (near) + the param mapping + the
  FASTA binding co-design.
- Output 4 (figure plot): gated on Figure Studio style model + a vision model.

Build order is deferred to after the Phylogenetics lane reviews outputs 3 and 4,
per Grant. The spec covers all four so the review sees the whole shape.

## Open questions captured

Resolved with Grant 2026-06-12:
- Scope: light factual comparison allowed (carve-out above), strict otherwise.
- Figure: editable style spec, not auto-apply.
- Process: spec first, phylo lane reviews the phylo-dependent parts before build.

For the Phylogenetics lane: the two [PHYLO REVIEW] blocks above (output 3 param
mapping + FASTA binding, output 4 style model + vision-to-spec).

## Output 3 build contract (locked 2026-06-13 with the phylo lane)

The phylo lane answered the three co-design questions. Locked decisions:

1. Catalog miss. When a paper names a tool or parameter the catalog does not
   carry, use the nearest catalog value plus a flagged FACTUAL note in the draft
   (never a hard reject, never a judgment). For substitution MODELS specifically,
   do not nearest-map: either use ModelFinder, or pass the paper's exact model
   string straight through `fixedModel` (a free string that IQ-TREE validates at
   runtime). This keeps the recipe faithful without the catalog having to enumerate
   every model.
2. Input binding. v1 binds a raw single-locus FASTA from the user's library
   sequence-ids (`have: "raw"`, `align: "mafft"`). Partition input is out of v1
   (a charset file cannot be synthesized from sequence-ids). The supermatrix /
   pre-aligned + partition path is the follow-up, and the phylo lane will add a
   `have: "alignment"` supermatrix branch to recipe.ts that skips AMAS and emits
   `iqtree2 -s <aln> -p <partition>` directly.
3. Scope cut. Ship single-locus nucleotide and protein first, supermatrix as a
   fast follow.

The three validated fixtures under
`frontend/src/lib/transparency/datasets/phylo-published/<case>/builder-options.json`
are the assertion target for the param->BuilderOptions mapping
(`frontend/src/lib/ai/tools/generate-tree-fixtures.test.ts` already regression-locks
generateRecipe against all three shapes).

Lane split unchanged: BeakerAI owns `frontend/src/lib/ai/tools/phylo-tools.ts`
(generate_tree + resolveBuilderOptions); the phylo lane owns
`@/lib/phylo/catalog` + `recipe.ts` (consumed read-only). generate_tree already
tracks `defaulted` fields, which is the surface for the flagged-note behavior.
