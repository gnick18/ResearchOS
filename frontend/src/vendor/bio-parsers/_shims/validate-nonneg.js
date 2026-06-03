// sequence Phase 1 bot — local shim for `validate.io-nonnegative-integer-array`
// (single default export). Returns true iff the input is an array of
// non-negative integers. Matches the npm package's behavior for the inputs the
// vendored validateSequence passes (it always calls with a one-element array).
export default function areNonNegativeIntegers(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  for (const v of arr) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return false;
  }
  return true;
}
