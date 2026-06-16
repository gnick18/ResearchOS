# Phylo circular per-track callouts (right gutter) — handoff

**Date:** 2026-06-16
**Branch:** main (committed `177154622`, local, UNPUSHED)
**Lane:** Phylo

## What this is

Grant asked (on the 305-tip Candida auris circular demo) for the metadata rings to
**self-identify on the figure** — each ring's track name (CLADE / FCZ / AMB / MCF)
pulled out to the side with a leader, in his sketched "exploded callout" style,
instead of only being decodable via the side legend.

He picked **"Right gutter (recommended)"** from the agent's question: make the
circular figure a bit wider than tall, circle sits on the LEFT at the same size,
right margin holds the track callouts + the existing legend (the standard published
"circle left, annotations right" look). The tree stays exactly as large because the
radius is height-bound, so widening costs it nothing.

This was the immediate follow-up to the session's three earlier ring fixes
(square canvas `80579172c`, tip-marker cap `9de902a8e`, conditional label room
`53298d630`, thinner rings `adc36f98e`). render.ts had been reverted clean back to
`adc36f98e` before this work — a first attempt had been wired into the dead legacy
`spec.tracks` path; the live rings are drawn by the panel/layer system, which is
where this lands.

## What shipped (commit `177154622`)

- **`PhyloStudio.tsx`** — `figWidthFor(layout)` returns `FIG_W + 220` for the
  `"circular"` layout only (840×620), else `FIG_W`. Threaded `figW` through the
  render-spec width, PNG export dims, fit-to-page aspect, and ZoomPanCanvas
  contentWidth (mirrors the existing `figHeightFor`). fan/inwardCircular/unrooted
  are NOT widened (they keep the square canvas; their gap geometry is different).
- **`layout.ts`** — `LayoutOptions.circularGutter`. When set AND `width > height`,
  `layoutCircular` left-anchors the circle: `cx = height/2` (was `width/2`). Radius
  is unchanged (already `min(width,height)/2 = height/2` when width>height), so the
  tree is the same size and the extra width is pure right gutter.
- **`render.ts`** —
  - `RenderSpec.circularGutter`.
  - `renderFromPanels`: `gutter = circularGutter && layout==="circular" && width>height`.
  - In the panel loop, gutter mode collects each ring panel's `(title, rInner,
    rOuter)` instead of drawing the inline top-stacked title. A multi-column heat
    panel expands into one callout per column (FCZ/AMB/MCF each).
  - `drawCircularCallouts()` (new): stacks the names in the gutter centered on the
    fan's open gap (3 o'clock = cy), each tied to its ring by a thin MUTED elbow
    leader from `(cx + ringMid, cy)`.
  - Legend capped to a single far-right column in gutter mode so it never collides
    with the callouts.
- **`figure-to-render.ts`** — sets `circularGutter: inputs.layout === "circular"`.
- **`render-circular-callouts.test.ts`** (new, 7 tests) — locks the cx contract
  (left-anchor only when widened+opted-in, inert otherwise) and the callout
  leader/label emission.

## Verification done

- `tsc --noEmit` clean.
- All phylo tests pass: 337 (330 prior, byte-identical + 7 new).
- Numerically probed a 12-tip / 4-ring circular render: gutter active, width 840,
  callouts at x=634 (in the gutter), legend titles at x=720 — no overlap.
- **Rasterized** a representative 40-tip, label-less, 4-ring circular figure
  (qlmanage) and eyeballed it: circle left-anchored, 4 distinct callouts
  (CLADE/FCZ/AMB/MCF) with elbow leaders exiting the 3 o'clock gap, color legend
  clear at far right. Matches the sketch.

## NOT yet done (Grant's call)

1. **Live browser pass on the real 305-tip demo** (`/phylo?demo=1`, circular). The
   render fn is verified by raster, but the leader splay / label spacing on the real
   density is Grant's aesthetic call. Tuning levers if needed:
   - `RADIAL_CALLOUT_GUTTER` (PhyloStudio, currently 220) — gutter width.
   - `gap` (15) and `labelX`/`railX` in `drawCircularCallouts` — stack spacing +
     leader knee.
2. **fan / inwardCircular** do NOT get callouts yet (only the verified rooted
   `"circular"` gap at 3 o'clock). A follow-up if Grant wants them there too.
3. **UNPUSHED** — local main only, like the rest of the phylo lane.

The dev server on port 3033/3000 is the main frontend with these edits (HMR).
