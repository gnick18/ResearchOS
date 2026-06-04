// label decollide bot — pure, renderer-free VERTICAL de-collision for the
// circular map's outer labels.
//
// THE PROBLEM: on the circular plasmid map, feature names, primer names, and
// enzyme/cut-site names are all placed OUTSIDE the ring with a leader line back
// to their position on the plasmid. Each one wants to sit at the y of its own
// anchor angle. When several anchors fall close together (a dense contig with
// hundreds of features + primers) their text boxes stack on top of one another.
// The names de-collide WITHIN a type elsewhere, but a feature label and a primer
// label seeded at nearly the same angle still overlap because they were never
// compared against EACH OTHER.
//
// THE FIX (this module): treat EVERY visible label on a side (left half / right
// half of the ring) as one pool, regardless of type, and push overlapping boxes
// apart along y until no two boxes on that side overlap. The leader line simply
// angles to follow the shifted text, exactly like SnapGene. Placement is
// type-agnostic — color/leader/hover styling is decided by the caller, this only
// computes the final y.
//
// Kept DOM-free + dependency-free so the no-overlap guarantee is unit-testable
// in isolation (see circular-label-layout.test.ts).

/** One label to de-collide. `id` is opaque (the caller maps it back). */
export interface CircularLabelBox {
  id: string;
  /** which half of the ring the label sits on; only same-side boxes can collide. */
  side: "left" | "right";
  /** the label's ideal vertical center (px) — the y of its anchor angle. */
  idealY: number;
  /** measured rendered height of the label (px), including a little padding. */
  height: number;
}

/** A de-collided label: its final vertical center after separation. */
export interface PlacedCircularLabel {
  id: string;
  side: "left" | "right";
  /** the label's original ideal y (so the caller can draw a fork when it moved). */
  idealY: number;
  height: number;
  /** final vertical center (px); equals idealY when nothing collided. */
  y: number;
}

export interface CircularLabelLayoutOptions {
  /** minimum vertical gap (px) between two stacked boxes on the same side. */
  gap?: number;
  /** the top edge (px) labels may not cross. */
  minY?: number;
  /** the bottom edge (px) labels may not cross. */
  maxY?: number;
}

const DEFAULTS = {
  gap: 1,
};

/**
 * De-collide circular outer labels vertically, per side.
 *
 * Algorithm (greedy sweep, O(n log n)):
 *   1. split the pool by side (left/right) — only same-side boxes can overlap,
 *      since opposite sides are mirrored across the ring;
 *   2. on each side, sort by idealY (stable on ties by id);
 *   3. sweep top-to-bottom keeping a running "floor" = the bottom edge of the
 *      last placed box + gap. Each box is placed at max(idealY, floorCenter);
 *      i.e. shoved DOWN just enough to clear the box above it, never moved up off
 *      its ideal slot during this pass;
 *   4. if the downward sweep pushed the whole stack past maxY, run a symmetric
 *      UPWARD relaxation: clamp the bottom-most box to maxY and pull boxes up so
 *      they still don't overlap, which spreads a dense cluster across the
 *      available band rather than piling it past the edge.
 *
 * Guarantee: within a side, sorted by y, each box's top edge is >= the previous
 * box's bottom edge + gap (NO OVERLAP). This is the property the tests assert.
 *
 * Boxes are returned in the SAME ORDER as the input (the caller relies on stable
 * mapping back to its label objects).
 *
 * Pure + DOM-free.
 */
export function deCollideCircularLabels(
  boxes: CircularLabelBox[],
  opts: CircularLabelLayoutOptions = {},
): PlacedCircularLabel[] {
  const gap = opts.gap ?? DEFAULTS.gap;
  const minY = Number.isFinite(opts.minY as number) ? (opts.minY as number) : -Infinity;
  const maxY = Number.isFinite(opts.maxY as number) ? (opts.maxY as number) : Infinity;

  const result = new Map<string, PlacedCircularLabel>();

  for (const side of ["left", "right"] as const) {
    const onSide = boxes.filter(b => b.side === side);
    if (onSide.length === 0) continue;

    // Sort by ideal y, tie-break on id for determinism.
    const sorted = [...onSide].sort(
      (a, b) => a.idealY - b.idealY || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    // Pass 1: downward sweep. Each box sits at its ideal y, shoved down only as
    // far as needed to clear the box above it (plus gap).
    const ys: number[] = new Array(sorted.length);
    let floorCenter = -Infinity; // min allowed center for the next box
    for (let i = 0; i < sorted.length; i++) {
      const half = sorted[i].height / 2;
      const wanted = Math.max(sorted[i].idealY, floorCenter);
      ys[i] = wanted;
      floorCenter = wanted + half + gap + (sorted[i + 1] ? sorted[i + 1].height / 2 : 0);
    }

    // Pass 2: if the stack overran maxY (or underran minY), relax it back into
    // the band by sweeping the OTHER direction so the cluster spreads instead of
    // clipping. Only touch boxes that are actually out of bounds + their chain.
    const lastIdx = sorted.length - 1;
    const lastBottom = ys[lastIdx] + sorted[lastIdx].height / 2;
    if (lastBottom > maxY) {
      // Upward relaxation: pin the bottom box at maxY, pull boxes above it up
      // only as far as needed to avoid overlap (each box at min(currentY,
      // ceilCenter), where ceilCenter is the box-below's top edge - gap - half).
      let ceilCenter = Infinity;
      for (let i = lastIdx; i >= 0; i--) {
        const half = sorted[i].height / 2;
        const cap = i === lastIdx ? maxY - half : ceilCenter;
        const wanted = Math.min(ys[i], cap);
        ys[i] = wanted;
        ceilCenter = wanted - half - gap - (sorted[i - 1] ? sorted[i - 1].height / 2 : 0);
      }
    }
    // Final top clamp: never let the top box cross minY. Shifting the top box
    // down here can only ADD slack below it (the downward neighbors already have
    // room), so it cannot reintroduce an overlap.
    if (ys[0] - sorted[0].height / 2 < minY) {
      let floor = minY + sorted[0].height / 2;
      for (let i = 0; i < sorted.length; i++) {
        const half = sorted[i].height / 2;
        if (ys[i] < floor) ys[i] = floor;
        floor = ys[i] + half + gap + (sorted[i + 1] ? sorted[i + 1].height / 2 : 0);
      }
    }

    for (let i = 0; i < sorted.length; i++) {
      result.set(sorted[i].id, {
        id: sorted[i].id,
        side,
        idealY: sorted[i].idealY,
        height: sorted[i].height,
        y: ys[i],
      });
    }
  }

  // Preserve input order.
  return boxes.map(
    b =>
      result.get(b.id) ?? {
        id: b.id,
        side: b.side,
        idealY: b.idealY,
        height: b.height,
        y: b.idealY,
      },
  );
}

/**
 * Test/verification helper: do any two placed labels on the SAME side overlap
 * vertically (geometric overlap, ignoring the gap)? Returns true on a collision.
 */
export function hasCircularOverlap(placed: PlacedCircularLabel[]): boolean {
  for (const side of ["left", "right"] as const) {
    const arr = placed.filter(p => p.side === side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < arr.length; i++) {
      const prevBottom = arr[i - 1].y + arr[i - 1].height / 2;
      const curTop = arr[i].y - arr[i].height / 2;
      if (curTop < prevBottom - 1e-6) return true;
    }
  }
  return false;
}
