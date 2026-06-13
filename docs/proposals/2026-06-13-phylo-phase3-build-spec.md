# Phylo Phase 3 build spec: alignment track + multi-panel polish

2026-06-13. Phase 3 of the ggtree-class arc, on top of merged Phases 0-2. Scoped
for a build that runs in parallel with Grant's Phase 2 browser test. The demo
RESEED is deliberately NOT in this build (it touches the committed seed; Grant
confirms that separately).

## In scope

### 1. msaplot: a sequence-alignment track aligned to tips
A new `msa` aligned-panel geom (the kind is already reserved in the AlignedPanel
catalog). The user provides a multiple sequence alignment (aligned FASTA) the same
way they provide a metadata CSV today: import/paste, then join sequences to tips by
label (reuse the existing tip-label matching, exact -> normalized -> token, with a
"matched X of Y" indicator). Render the alignment as an aligned residue matrix
panel, one cell per alignment column, colored by residue (a nucleotide palette
A/C/G/T/gap and an amino-acid palette, auto-detected), as a column block
(rectangular) or an outer ring band (circular). For wide alignments, downsample /
bin columns to a sensible max width so a 20kb alignment still renders (note the
downsampling in the panel, do not silently drop). Legend = the residue color key.
Follows the panel-render.ts + TipAxis pattern; pure SVG.

### 2. Multi-panel + legend polish
With several panels active, the legends and panels must stay readable:
- Legends stack/wrap cleanly in the reserved legend area (columnize when they
  exceed the height), no overlap with the figure or each other (Phase 1 partially
  did this; make it robust at 4+ legends).
- Per-panel value-axis labels / a small panel title so a reader knows what each
  ring/column is, especially in circular.
- Sensible spacing between stacked panels so rings/columns do not visually merge.

### 3. Fix: template-apply render flicker
The browser test saw applying a template flash the result then briefly revert
before settling on the correct state. Find the state-sync in the template-apply
path (PhyloStudio/PhyloLayers onApplyTemplate) and make the apply atomic so there
is no transient revert. Correct end state already holds; this removes the flicker.

## Out of scope (held)

- DEMO RESEED (rebuild the seeded figures to show off the fancy panels) -- Grant
  confirms before this happens, since it edits the committed seed.
- Faceting / linked-Data-Hub-plot-with-arbitrary-x (beyond the per-tip panels).
- The handbook (parked, final step).

## Cross-lane

Stay in the phylo lane. Reuse Data Hub palettes read-only if useful for the
residue colors; do NOT modify lib/datahub/*. The alignment parse should reuse any
existing FASTA/alignment parser in the phylo or sequences lib if present (read-only
import), else a small local parser.

## Data shape

The `msa` panel may need to reference the imported alignment. Prefer storing the
alignment as imported figure state (like the metadata table) rather than a new
persisted panels[] field; if a panel field is unavoidable, make it OPTIONAL +
additive + FLAG it. No breaking change to saved figures.

## Gate + delivery

tsc 0, `vitest run src/lib/phylo src/lib/transparency`, icon-guard 0, tests for the
msa renderer + the residue palettes + the flicker-fixed apply path. Isolated
worktree, incremental commits, ATOMIC guarded merge (the sweep lesson). Validate
locally against the ggtree corpus (HPV58.tree + HPV58_aln.fas in
~/Desktop/ggtree-testdata/, never committed) for the msa track.
