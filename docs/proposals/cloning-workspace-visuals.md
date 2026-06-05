# Cloning Workspace visuals: good to phenomenal

Author: sequence editor master, 2026-06-04. Status: SIGNED OFF by Grant
(2026-06-04). Scope locked below.

## Locked scope (Grant, 2026-06-04)

- Phase A (one sub-bot, dispatched first). Live product map + fragment-origin
  ribbon + a "show sequence" disclosure for the raw bases. Includes the
  `productToDetail` adapter and the additive `fragmentSpans` return on all three
  engines.
- Phase B (sub-bot[s], after A lands). PER-TAB OPTIMIZATION: each tab leads with
  its own hero module, optimized for that chemistry's key question (see the
  "Phase B" section below). Overlap leads with the homology junctions, Restriction
  with the cut + sticky ends + internal-site warning, Golden Gate with the
  fusion-site uniqueness + scarless check, Gateway with the recombination
  crossover + product/byproduct pair. Almost all pure UI on existing engine data
  (the Gateway crossover needs NO engine change, `attSites` is already returned).
- Deferred. The assemble animation + pick-step live preview. Revisit after A + B
  are live.
- Sequence text. Kept behind a "show sequence" disclosure under the map.

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

## Phase B: per-tab optimization (each tab leads with its own hero)

Phase A made the review identical across all four tabs (map + ribbon + junctions
+ save). But each tab answers a DIFFERENT scientific question, so each review
should LEAD with a different hero module, the one thing that chemistry's user
most needs to verify. The map and ribbon stay as the shared spine; the hero and
the detail panel are tuned per chemistry, and the map's default tab and
emphasized track are tuned too.

Grounding note (verified against the engines 2026-06-04). Almost all of this is
pure UI on data the engines already return. The earlier claim that the Gateway
crossover needs an engine change was WRONG: `GatewayProduct` already returns
`attSites: [ProductAtt, ProductAtt]` (name, family, sequence) plus
`role: "clone" | "byproduct"` and `fragmentSpans`. Cut-ligate already returns
per-piece `PieceEnd` (kind + overhang), `hasSite`, `junctionOverhangs[]`, and the
orientation-ambiguity warning. The only NEW engine data anyone might want is
restriction internal-cut detection (see the Restriction tab), and even that is
optional.

### The shared review grammar

Every tab renders the same skeleton, top to bottom:

1. HERO MODULE (chemistry-specific). Leads the review with the key verification.
2. PRODUCT MAP (shared). The assembled product as a read-only SeqViz map. Default
   tab and emphasized track are tuned per chemistry (below).
3. FRAGMENT RIBBON (shared). Tuned per chemistry with junction-tick labels.
4. DETAIL / WARNINGS (chemistry-specific). The secondary readouts and the failure
   mode that bites THIS chemistry, surfaced prominently.
5. SAVE / ORDER. Save to library (all), plus the oligo order list (overlap).

### Overlap tab. Hero: the homology junctions

The Gibson user's question is "did my overlaps form, are they specific, and will
they anneal at the reaction temperature."

- Hero. A per-junction homology diagram. Fragment A's 3' tail over fragment B's
  5' head, the shared overlap (`overlapSeq`, `overlapBp`) highlighted as a band
  across both rows, the `overlapTm` labeled and color-graded (green at or above
  the reaction temp, amber if marginal, red if too weak). An ambiguity flag when
  two overlaps are too similar (the engine already warns on duplicate overlaps).
- Map default. Map (ring) view, the "did it close into a clean plasmid" shot.
- Ribbon tuning. Junction ticks carry the overlap bp + Tm on hover.
- Detail. The oligo order list, tail vs annealing region distinguished (present
  today, keep).
- Failure surfaced. Weak or ambiguous overlaps, up top.

### Restriction tab. Hero: the cut, the compatible ends, and internal sites

The restriction user's question is "do my ends match, in what orientation, and
will the enzyme also chew up my insert."

- Hero. A sticky-end ladder at each junction, the textbook staggered top/bottom
  strands with the overhang bases spelled out, from `PieceEnd.kind` + overhang +
  `junctionOverhangs[]`. Above it, a compact cut map of where the enzyme(s) cut
  each input fragment.
- The safety surface (the #1 restriction footgun). An "internal sites" warning
  when the chosen enzyme ALSO cuts inside the intended insert or product. This is
  the one place that wants a small engine addition: expose the cut positions (the
  engine computes them in `findCuts` but does not return them) so the UI can flag
  "EcoRI cuts your insert 2 times." Until that lands, a cheaper proxy is to count
  pieces per source fragment and warn when a fragment yielded more pieces than the
  user intended.
- Map default. Map (ring) with the enzyme / cut-site track ON, so the sites show
  on the product.
- Ribbon tuning. Junction ticks labeled with the overhang (the 4-base seal) and
  the enzyme.
- Detail. Enzyme summary (which enzymes, total sites) and, when the overhangs are
  non-directional, the orientation-ambiguity readout (the engine already warns
  "N distinct products").

### Golden Gate tab. Hero: the fusion-site fingerprint and scarless seal

Golden Gate shares the sticky-end PRIMITIVE with restriction but optimizes for a
different question entirely: "are my fusion sites all unique so the one-pot order
is unambiguous, and did the Type IIS sites disappear from the product."

- Hero. A fusion-site fingerprint panel. List every junction's 4-base fusion
  overhang (`junctionOverhangs[]`), color-coded, with a UNIQUENESS CHECK across
  the whole set. All distinct shows green ("unambiguous one-pot order"); any
  duplicate shows red ("these two junctions share an overhang, the order is
  ambiguous"). This is the defining Golden Gate concern. Beside it, a "recognition
  sites removed" confirmation (the Type IIS sites are gone = scarless), derivable
  from the `hasSite` / discard logic the engine already runs.
- Map default. Map (ring), enzyme track on, the fusion junctions marked.
- Ribbon tuning. Each junction tick shows its 4-base fusion overhang, color-
  matched to the fingerprint panel.
- Detail. The ordered assembly as a chain (A to B to C, then close), since the
  overhangs enforce the order.
- Failure surfaced. Duplicate fusion sites (ambiguous order); a recognition site
  that cannot be removed.

The Restriction-vs-Golden-Gate split is the heart of "optimize each tab." Same
overhang data, two different heroes: restriction asks "will it ligate and survive
the enzyme," Golden Gate asks "is the programmed order unambiguous and scarless."

### Gateway tab. Hero: the recombination crossover and the product/byproduct pair

The Gateway user's question is "which att sites reacted, what clone do I get, and
what is the byproduct." No engine change needed, `attSites` + `role` are already
returned.

- Hero. An att-site crossover diagram. Draw the reaction (BP or LR) as the two
  substrate att sites crossing into the product att sites, for example attL1 x
  attR1 to attB1 (clone) plus attP1 (byproduct), an X with the site cores
  labeled, straight from `attSites[2]` and `role`.
- What in, what out. The substrate pair to clone + byproduct, with the
  transferred gene highlighted (the `fragmentSpans` already distinguish the
  transferred insert span from the cassette backbone span).
- Map default. The CLONE product (ring), att-site features emphasized, with a
  toggle to view the byproduct.
- Ribbon tuning. Mark the att-site scar positions and the transferred-insert span
  versus backbone span.
- Detail. The byproduct as a secondary card ("you also get this").
- Failure surfaced. att-family mismatch (attL1 needs attR1), wrong substrate
  topology.

### Shared refinements that fall out of this (fold in the Phase A polish notes)

- Map default tab. Stop defaulting the embedded map to the Sequence (base) view.
  Default to Map (ring) for overlap + Gateway, and to Map with the enzyme layer on
  for restriction + Golden Gate. This is the per-chemistry version of the Phase A
  polish note about the default tab.
- Chrome slimming. The embedded read-only map currently carries the full editor
  toolbar (Copy / Edit / Enzyme / Export). Slim it to the view tabs + view rail
  for a preview (keep Export, since exporting the not-yet-saved product is useful).

### Optional pick-step tuning (lighter, can follow)

The PICK step could also be chemistry-tuned, surfacing each method's key choice
before review:
- Overlap. Overlap length / Tm (present today).
- Restriction / Golden Gate. The enzyme picker plus a live "sites per fragment"
  readout, so compatibility is visible before you commit to review.
- Gateway. BP / LR plus att-site auto-detection on the substrates ("this looks
  like an attL entry clone").

Effort. Mostly pure UI on existing engine data. The four hero modules are the
bulk; the only optional engine work is restriction internal-cut positions. Risk
low, except the sticky-end / fusion geometry drawing is fiddly (bounded).

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

1. Phase A (DONE, landed `d903838b`). Live product map + fragment ribbon +
   sequence disclosure + the `productToDetail` adapter + `fragmentSpans` on all
   three engines.
2. Phase B (per-tab optimization, this proposal). The four hero modules + the
   per-chemistry map default + the shared chrome slim. Almost entirely pure UI on
   data the engines already return. Natural split: one sub-bot for the shared
   grammar + map-default + chrome, then one sub-bot per tab hero (or batch the
   four heroes into one if scoped tightly). The only optional engine work is
   restriction internal-cut positions, gated on whether we want the internal-site
   warning in v1.
3. Phase C (DONE). Per-chemistry pick-step readouts: Restriction + Golden Gate
   show a live "sites per fragment" count for the selected enzyme(s); Gateway
   auto-detects and labels each substrate (attL entry clone / attR destination /
   attB insert / attP donor) and hints when the picked pair does not match the
   BP/LR reaction. Display-only, on `digestEnzymes` + `locateAttSites`. Demo
   substrates for Golden Gate (BsaI cassette pair) and Gateway (attL/attR pair)
   were added to the fixture so all four review heroes are exercisable in /demo.
4. Deferred. The assemble animation + pick-step live ring preview.

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
