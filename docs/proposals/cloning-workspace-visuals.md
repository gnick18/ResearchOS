# Cloning Workspace visuals: good to phenomenal

Author: sequence editor master, 2026-06-04. Status: DESIGN DRAFT for Grant's
sign-off. No code dispatched. The committed core is the live product map; the
three enhancements below are decision points Grant checks off in this doc.

## Goal

Take the Assemble construct popup (`components/sequences/CloningWorkspace.tsx`)
from a working tool to a phenomenal one by replacing the raw text dump of the
product with dynamic, chemistry-aware visuals. The review step today shows the
assembled sequence as a monospace `<pre>` inside `CloningProductPreview`. We
want the user to SEE the construct they are about to make, and to see how the
pieces join, in a way that fits each of the four tabs (Overlap, Restriction,
Golden Gate, Gateway).

## What the engines already give us (grounding)

Everything proposed here is driven by data the pure engines already return. No
speculative biology.

- Overlap (`assembleGibson`, `lib/sequences/cloning.ts`). Returns
  `AssemblyResult` with `product` (`seq`, `circular`, `features` rebased to
  product coordinates), `junctions[]` (each with `overlapSeq`, `overlapBp`,
  `overlapTm`, `fragmentIndex`, `nextFragmentIndex`), and `primers[]`.
- Cut-ligate (`cutAndLigate`, `lib/sequences/cut-ligate.ts`). Returns
  `CutLigateResult` with `products[]`, each a `LigationProduct` (`seq`,
  `circular`, `junctionOverhangs[]`, and now `features`). Pieces carry
  `sourceStart` and end geometry (`PieceEnd.kind` = blunt / 5' / 3', plus the
  overhang bases).
- Gateway (`runGateway`, `lib/sequences/cloning-gateway.ts`). Returns the
  recombined product(s) with rebased insert features. The att-site tables
  (attB / attP / attL / attR cores) live inside the engine.

The product already carries rebased annotations as of `1e59fc9d` (the cut-ligate
carry-over fix), so the map and the ribbon both have real features to draw.

## Core (committed): the live product map

Replace the `<pre>` sequence dump in the review step with a real SeqViz map of
the assembled product, the same renderer `/sequences` uses.

### The adapter (the reason this is cheap)

`SequenceReadView` renders any `SequenceDetail` (`components/sequences/
SequenceReadView.tsx` wraps `SequenceEditView` with `readOnly`). We can build a
renderable detail for an UNSAVED product with zero new conversion code by reusing
the two functions we already have:

```
productToDetail(name, product, primers?) =
  genbankToDetail(
    productToGenbank(name, product, { primersAsFeatures: primers }),
    syntheticMeta,   // { id: -1, display_name: name, project_ids: [], added_at: now, seq_type: "dna" }
  )
```

`productToGenbank` (in `cloning-io.ts`) already serializes the product's bases +
rebased features + optional primer_bind features. `genbankToDetail` (in
`parse.ts`) already parses that back into the exact `SequenceDetail` shape the
read view consumes. So the review map renders byte-identical to a saved sequence
map. No new parse path, no drift.

### Layout + mount

- The map mounts only when `step === "review"`, so there is no per-keystroke
  cost on the pick step (the engines are memoized and cheap, but SeqViz mounting
  is not free).
- Circular product renders the plasmid ring; linear product renders the linear
  track. Topology comes from `product.circular`, already set by the pick step.
- The map sits in the product card area, replacing or sitting above the raw
  sequence (keep a "show sequence" disclosure for the text view, since people
  still copy bases).
- Features draw as colored arcs automatically from the carried-over annotations.

### Risk

Low. Reuses the vendored SeqViz path verbatim. The one thing to watch is the
`@ts-nocheck` vendored-render trap (see AGENTS.md): if we touch any vendored
seqviz file we audit variable scope by hand and lean on
`Primers.render.test.tsx`. The adapter itself is pure and unit-testable.

## Optional 1: fragment-origin ribbon (recommended)

A color-coded band showing which source fragment contributed which span of the
product. Outer ring on a circular product, strip under a linear one. One segment
per fragment, labeled with the fragment name + bp range, junction ticks at the
boundaries. Hovering a segment highlights that fragment back in the input list.

Why it matters. It answers "where did each piece go" and catches order mistakes
at a glance (vector before insert, a flipped fragment, a junction in the wrong
place). High clarity per pixel.

Implementation. Each engine needs a small ADDITIVE change to return per-fragment
product spans (a `fragmentSpans: { name, start, end, strand }[]` on the product /
result). For overlap the offsets are the cumulative body lengths the engine
already walks; for cut-ligate the per-piece product offsets were already computed
for feature rebasing in `1e59fc9d` and just need surfacing; for Gateway the
insert occupies a known span in the cassette. The ribbon itself can be its own
small SVG component OR a colored feature track layered on the SeqViz map (SeqViz
supports annotation tracks, so the ribbon can be a synthetic track colored by
fragment).

Effort low. Risk low. Recommendation: include.

## Optional 2: per-tab junction specials

One bespoke diagram per chemistry, shown in the review step alongside the map.
Two of the three need no engine change.

### Overlap homology diagram (data in hand)

For each junction, draw fragment A's last ~30 bp over fragment B's first ~30 bp,
with the shared overlap region (`overlapSeq`, `overlapBp` long) highlighted in a
band spanning both rows and the `overlapTm` labeled. This is literally "show
where the overlap is." Low effort, the data is already on each `Junction`.

### Restriction / Golden Gate sticky-end ladder (data in hand)

For each junction, draw the textbook staggered-strand seam: the protruding
overhang spelled out on offset top and bottom strands, then the sealed ligation.
The `PieceEnd.kind` (blunt / 5' / 3') plus the overhang bases plus
`junctionOverhangs[]` give us the geometry. The most "molecular biology" visual
of the set, and it makes overhang compatibility obvious. Medium effort (the
staggered geometry is fiddly), bounded, low risk.

### Gateway recombination crossover (needs a small engine change)

Draw attL1 x attR1 to attB1 as an X with the site cores swapping, labeling the
sites. Makes the BP / LR logic concrete instead of abstract. The att-site
identities that reacted live inside `cloning-gateway.ts` today and would need to
be returned (which sites, which cores) for the UI to draw them. Medium effort,
medium risk, and the only special that touches an engine's internals. Could be
deferred to a follow-up without blocking the other two.

Effort low to medium. Risk low (overlap + sticky) to medium (Gateway).
Recommendation: include overlap + sticky-end now, decide Gateway separately.

## Optional 3: assemble animation + pick-step preview (gold-plating)

Two separate flourishes.

- Assemble animation. When review first renders, the fragment arcs slide into
  the ring and the features fade in (~600 ms, reduced-motion-aware: skip to the
  final frame under `prefers-reduced-motion`). SeqViz has no intro transition, so
  this animates our own ribbon / overlay layer, not SeqViz itself.
- Pick-step preview. A faint live ring on the pick step that grows as fragments
  are added, so the user watches the construct form before committing. This
  reintroduces a SeqViz mount cost on the pick step, so it must be debounced.

Effort medium to high. Risk medium to high (most likely to churn). Recommendation:
defer. Decide after the core + ribbon + specials are live.

## Recommended phasing

1. Core: live product map (the adapter + review-step mount). One sub-bot.
2. Fragment ribbon (adds `fragmentSpans` to the three engines + the band). Can
   ride with the core or follow immediately.
3. Junction specials: overlap homology + sticky-end ladder. One sub-bot.
4. Gateway crossover (engine change + diagram). Separate, gated on a decision.
5. Animation + pick-step preview. Last, or never.

Verification per phase. tsc + vitest on the pure pieces (adapter, fragmentSpans,
junction-geometry helpers are all pure and testable). The map render is visually
verified live by Grant against `:3000` in `/demo` fixture mode (pEGFP-N1 et al.),
per the screenshot-privacy rule (no real research data).

## Open decisions for Grant

1. Ribbon: include in the core phase, or as an immediate follow-up?
2. Junction specials: overlap + sticky-end now (recommended). Gateway crossover
   now, later, or skip?
3. Animation: defer (recommended) or skip entirely?
4. Sequence text: keep a "show sequence" disclosure under the map, or drop the
   raw text view once the map lands?
