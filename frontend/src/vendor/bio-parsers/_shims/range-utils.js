// sequence Phase 1 bot — local shim for the one `@teselagen/range-utils`
// function the vendored bio-parsers path uses: `isRangeWithinRange`. The
// upstream implementation chains through a deep tree (circular-range overlap
// splitting); we implement the documented 0-based semantics directly:
// is `rangeToCheck` fully contained within `containingRange`, accounting for
// origin-spanning (circular) ranges given `maxLength`.
//
// A range {start, end} is "circular" (origin-spanning) when start > end: it
// covers [start, maxLength) U [0, end]. We expand both ranges to the set of
// covered indices (conceptually) and test containment via interval logic
// without materializing the indices.

function spans(range, maxLength) {
  // Return a list of [lo, hi] inclusive non-wrapping intervals covering range.
  const { start, end } = range;
  if (start <= end) return [[start, end]];
  // origin-spanning
  return [
    [start, maxLength - 1],
    [0, end],
  ];
}

function intervalWithin(inner, outers) {
  // inner [lo,hi] must be fully covered by the union of outers (each [lo,hi]).
  return outers.some(([olo, ohi]) => inner[0] >= olo && inner[1] <= ohi);
}

export default function isRangeWithinRange(rangeToCheck, containingRange, maxLength) {
  if (!rangeToCheck || !containingRange) return false;
  const inners = spans(rangeToCheck, maxLength);
  const outers = spans(containingRange, maxLength);
  return inners.every((inner) => intervalWithin(inner, outers));
}

export { isRangeWithinRange };
