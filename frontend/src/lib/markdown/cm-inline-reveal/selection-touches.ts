/**
 * selectionTouchesNode: the reveal predicate for the CM6 inline-reveal layer.
 *
 * A container token is REVEALED (its markers shown as source) exactly when the
 * editor selection touches the container node range using CLOSED-interval
 * overlap. Closed interval (<= / >=) is deliberate so that a bare caret sitting
 * at EITHER boundary of the token still reveals it: a caret at the `from` edge
 * (just before the opening `**`) and a caret at the `to` edge (just after the
 * closing `**`) both mean "I am editing this token, show me the source."
 *
 * Nesting (e.g. bold inside a link): each containing container is tested
 * independently against the same selection. Because reveal is computed
 * per-container, an outer container can reveal while an inner one does not (or
 * vice versa); the caller walks every container so each gets its own answer.
 *
 * Pure module: no CM6 view imports. The CM6 selection type is structurally a
 * `{ ranges: { from, to }[] }`, so we accept that minimal shape and stay
 * trivially unit-testable. EditorSelection from @codemirror/state satisfies it.
 *
 * House style: no em-dashes, no emojis.
 */

/** The minimal shape of a single CM6 selection range we depend on. */
export interface RangeLike {
  from: number;
  to: number;
}

/** The minimal shape of a CM6 EditorSelection we depend on. */
export interface SelectionLike {
  ranges: readonly RangeLike[];
}

/**
 * Does the selection touch the closed interval [nodeFrom, nodeTo]?
 *
 * For each selection range r, overlap is `r.from <= nodeTo && r.to >= nodeFrom`.
 * A caret is a zero-width range (r.from === r.to); the closed comparison makes a
 * caret exactly at nodeFrom or nodeTo count as touching, which is the
 * boundary-reveal behavior we want.
 *
 * Returns true if ANY range in the (possibly multi-cursor) selection touches.
 */
export function selectionTouchesNode(
  sel: SelectionLike,
  nodeFrom: number,
  nodeTo: number,
): boolean {
  for (const r of sel.ranges) {
    if (r.from <= nodeTo && r.to >= nodeFrom) return true;
  }
  return false;
}
