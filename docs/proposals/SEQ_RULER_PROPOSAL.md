# Linear DNA Ruler: Redesign Proposal

Status: draft for review (Grant). Created 2026-06-03.

The between-strand ruler in the linear Sequence view has been tuned several times
(graduated ticks, dynamic shedding, spacing, contrast) and still reads poorly.
This proposes a structural redesign rather than another parameter pass.

## 1. Why the current approach fails

There are TWO rulers fighting each other:

1. SeqViz's own `Index.tsx` renders a NUMBERED coordinate ruler: ticks plus number
   labels at zoom-based intervals (every 5 / 10 / 20 / 50 bp).
2. We bolted a SECOND, per-base tick layer between the strands
   (`la-vz-strand-connector` in `SeqBlock.tsx`): faint ticks at every base,
   graduated at 5 / 10, with dynamic level-shedding by `charWidth`.

So at any zoom the user sees SeqViz's interval ruler PLUS a faint, partially-shed
per-base smattering that does not align with the numbers and does not read as a
clean tape. The shedding-by-opacity model is the wrong abstraction: SnapGene never
shows a faint half-shed tape. It shows a crisp, definite measuring tape at base
level and a plain numbered ruler when zoomed out, with no mushy in-between. No
amount of opacity / threshold tuning on the bolted layer reaches that, because the
problem is two competing systems, not the tick styling.

## 2. The target (SnapGene-faithful)

ONE ruler, owned by us, sitting between the top and bottom strands (so the ruler
IS the strand connector). Two clean states:

A. BASE-LEVEL zoom (bases legible): a crisp measuring tape
   - a solid thin baseline through the seam,
   - a full-contrast tick at EVERY base,
   - a taller tick every 5,
   - the tallest tick PLUS the coordinate number every 10 (the number lives on the
     tape, at the 10 ticks, not in a separate floating row),
   - this is the strand connector and the ruler and the number row, unified.

B. ZOOMED-OUT (bases not rendered): a plain NUMBERED INTERVAL ruler
   - ticks plus numbers at a sensible interval (reuse SeqViz's existing 5/10/20/50
     interval logic), no per-base ticks, no faintness.

One hard transition at the base-legibility threshold. No opacity shedding, no
faint intermediate state.

## 3. Behavior (deterministic, keyed to charWidth)

- `charWidth >= BASE_LEGIBLE` (the zoom band where SeqViz renders base letters):
  state A, the full per-base tape with numbers at the 10s.
- below that: state B, the numbered interval ruler.

The breakpoint is a clean swap of what renders, not a fade. `BASE_LEGIBLE` is tied
to the same `zoomed` gate SeqViz already uses to decide whether to draw bases, so
the tape appears exactly when bases do.

## 4. Approach

- OWN the linear ruler: fold the per-base tape and the numbered ruler into a single
  renderer. Concretely: restyle / extend SeqViz `Index.tsx` to produce state A vs
  state B, position it in the strand seam, and REMOVE the bolted
  `la-vz-strand-connector` block from `SeqBlock.tsx`. Net: one coherent ruler, less
  code, no competing layers.
- Reuse what SeqViz already computes: `findXAndWidth` / `charWidth` / `firstBase`
  for tick x-positions, and its tick-interval selection for state B.
- Numbers: at base zoom, render the coordinate number at each 10 tick on the tape
  (centered on the tick, above or below the baseline). Drop the separate number row
  at base zoom so there is exactly one number source.

## 5. Open decisions (for Grant)

1. Number placement at base zoom: numbers at every 10 ON the between-strand tape
   (SnapGene), removing the separate top number row. (Recommend: yes, on the tape.)
2. Tick contrast: a clearly visible medium slate for minor ticks, darker for the
   10s, vs the current near-invisible 0.45 opacity. (Recommend: bump contrast so the
   tape is obviously a ruler.)
3. State count: just the two states (full tape at base zoom / interval ruler
   otherwise), or also a middle band that shows only 5s and 10s ticks at an
   intermediate zoom before dropping to the pure interval ruler? (Recommend: two
   states for clarity; a middle band is an easy add later if it feels abrupt.)
4. Number row when zoomed out: a single numbered interval ruler line in the seam,
   matching where the tape was. (Recommend: yes, keep the ruler in one place across
   both states.)

## 6. Scope and risk

- Vendored SeqViz only: `Index.tsx` (the ruler) plus removing the connector block in
  `SeqBlock.tsx`. Self-contained to the linear ruler.
- The coordinate / selection readouts and the overview box are unaffected: they read
  `charWidth` and scroll position, not the ruler element.
- Because this is an intricate visual redesign, build it against the SnapGene
  reference and run a 3-verifier loop across the full zoom range (base level, the
  transition, and zoomed out) before merging.

## 7. Recommendation

Build state A + state B as one owned ruler, remove the bolted connector, numbers on
the tape at base zoom, real contrast, clean swap at the base-legibility threshold.
This replaces the "faint dynamic tape" entirely. Confirm the four decisions above
and I will build it with the verifier loop.
