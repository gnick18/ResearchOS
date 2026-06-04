// primer bases bot — PURE layout math for SnapGene-style base-level primer
// rendering. Phase 2 of the primer-quality upgrade draws a primer's ACTUAL
// bases over the linear sequence: the annealing region sits column-for-column
// over the template bases it pairs with, the non-annealing 5' tail (a cloning
// overhang) "pops off" as a flap, and internal mismatches read as distinct.
//
// This file owns ONLY the math (which oligo base anneals vs tails, its forward
// template COLUMN, whether it is a mismatch). The SVG geometry (flap angle,
// vertical offsets) lives in the vendored Primers.tsx renderer; this helper is
// strict + unit-tested so the column mapping is truth-by-construction.
//
// COORDINATES. A BindingSite reports the ANNEALED region as 0-based [start, end)
// on the FORWARD (top) strand regardless of strand, plus `annealedLength`,
// `direction` (1 = the primer's 3' end extends along the top strand, -1 = along
// the bottom strand), and optional `mismatches` (forward template positions that
// do NOT pair). The oligo's full 5'->3' sequence has length L; the 5' tail is the
// L - annealedLength bases that hang off the 5' side and do not anneal.

import type { BindingSite } from "./primer";

/** Role of a single oligo base in the base-level render. */
export type PrimerBaseRole =
  /** anneals to the template and pairs cleanly. */
  | "anneal"
  /** anneals to the template column but does NOT pair (an internal mismatch). */
  | "mismatch"
  /** a non-annealing 5' tail base (a cloning overhang); drawn as a popped flap. */
  | "tail";

/** One oligo base placed for rendering. */
export interface PrimerBaseCell {
  /** 0-based index of this base in the oligo, 5'->3' (index 0 = the 5' end). */
  oligoIndex: number;
  /** the oligo base character (uppercased), 5'->3'. */
  base: string;
  /** how this base reads against the template. */
  role: PrimerBaseRole;
  /** 0-based FORWARD-strand template COLUMN this base sits over. For an annealing
   *  or mismatch base this is the template position it pairs with; for a tail base
   *  it is the column the flap base hovers above (one past the annealed edge,
   *  growing outward from the 3'->5' direction), so the renderer can still place
   *  it at a real x even though it pairs with nothing. */
  column: number;
}

/** The full base-level layout for one primer. */
export interface PrimerBaseLayout {
  /** direction echoed from the BindingSite (1 = forward/top, -1 = reverse/bottom). */
  direction: 1 | -1;
  /** number of 5' tail bases (oligo length - annealed length), >= 0. */
  tailLength: number;
  /** every oligo base, in 5'->3' oligo order. */
  cells: PrimerBaseCell[];
}

/**
 * Map a primer's oligo onto template columns for base-level rendering.
 *
 * @param oligo  the primer's full 5'->3' sequence (already sanitized A/C/G/T/U).
 * @param site   the BindingSite the oligo anneals at (forward coords).
 * @returns a per-base layout, or null when the oligo is shorter than the
 *          annealed length the site claims (a malformed pairing we will not draw).
 *
 * FORWARD primer (direction 1): the oligo lays 5'->3' left-to-right. The annealed
 * region is the oligo's 3'-most `annealedLength` bases, mapped left-to-right onto
 * template [start, end). The 5' tail bases sit to the LEFT of `start`.
 *
 * REVERSE primer (direction -1): the oligo lays 5'->3' right-to-left in forward
 * coords. The annealed region's 3' end (oligo's last base) pairs with template
 * `start`; the 5'-most annealed base pairs with template `end - 1`. The 5' tail
 * bases sit to the RIGHT of `end - 1`.
 */
export function layoutPrimerBases(oligo: string, site: BindingSite): PrimerBaseLayout | null {
  const seq = oligo.toUpperCase();
  const L = seq.length;
  const annealed = site.annealedLength;
  if (annealed <= 0 || annealed > L) return null;

  const tailLength = L - annealed;
  const mismatchSet = new Set(site.mismatches ?? []);
  const cells: PrimerBaseCell[] = [];

  for (let i = 0; i < L; i += 1) {
    const isTail = i < tailLength;
    let column: number;
    let role: PrimerBaseRole;

    if (site.direction === 1) {
      // forward: annealed oligo index i (>= tailLength) -> column start + (i - tailLength).
      if (isTail) {
        // tail base i sits to the left of `start`, the closest tail base (i =
        // tailLength - 1) one column left of start.
        column = site.start - (tailLength - i);
        role = "tail";
      } else {
        column = site.start + (i - tailLength);
        role = mismatchSet.has(column) ? "mismatch" : "anneal";
      }
    } else {
      // reverse: oligo reads 5'->3' right-to-left. The 3' end (i = L - 1) pairs
      // with template `start`; the 5'-most annealed base (i = tailLength) pairs
      // with `end - 1`. So an annealed oligo index i -> column start + (L - 1 - i).
      if (isTail) {
        // tail base i sits to the right of `end - 1`; the closest tail base
        // (i = tailLength - 1) one column right of end - 1, i.e. at `end`.
        column = site.end + (tailLength - 1 - i);
        role = "tail";
      } else {
        column = site.start + (L - 1 - i);
        role = mismatchSet.has(column) ? "mismatch" : "anneal";
      }
    }

    cells.push({ oligoIndex: i, base: seq[i] ?? "N", role, column });
  }

  return { direction: site.direction, tailLength, cells };
}
