// debounce-perf bot — a tiny dependency-free "trailing edge" value debounce.
//
// Returns the input `value` UNCHANGED on first render, then re-emits the latest
// value only after it has stopped changing for `delayMs`. While a change is
// pending the previously settled value is held. Used to keep expensive
// whole-sequence derivations (restriction digest / find scan / specificity)
// off the typing hot path: the visible window, caret, and local echo stay
// immediate while the heavy overlays recompute a beat after the user pauses.
//
// CORRECTNESS NOTE: this hook is value-identity based, so the debounced value
// is always a real prior input, never a half-applied intermediate. Callers that
// render position-bearing results (cut sites, find indices) MUST additionally
// key those results to the SAME debounced value they were computed from, so a
// result computed for sequence version N is never painted against version M
// (positions shift under edits). See `useStaleGuardedValue` below.

import { useEffect, useRef, useState } from "react";

/**
 * Debounce a value on the trailing edge. The returned value lags `value` by
 * `delayMs` of quiet; rapid changes collapse to the final one.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState<T>(value);

  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return settled;
}

/**
 * A stale-guarded, debounced derivation over an INPUT value.
 *
 * `input` is the raw thing the expensive computation reads (e.g. the sequence
 * string). `keyOf(input)` is a CHEAP identity of it (length + hash, or a
 * monotonic edit counter). `compute(input)` produces the expensive result.
 *
 * The hook DEBOUNCES the input itself, then runs `compute` on the settled input
 * and tags the result with that settled input's key. It returns:
 *   - `value`:   the freshly computed result, or `null` while a recompute is
 *                owed (the live input differs from the one `value` came from),
 *   - `pending`: true exactly when `value` is null for that reason.
 *
 * The stale guard is the whole point: `compute` only ever runs on the SETTLED
 * input, so the result's positions correspond exactly to the key it is tagged
 * with; the returned value is handed back ONLY while that key still equals the
 * LIVE input's key. A result computed for revision N is therefore NEVER exposed
 * once the input has moved to revision M (positions shift under edits). Callers
 * show "recomputing" / nothing-stale rather than mismatched positions.
 */
export function useStaleGuardedValue<I, T>(
  input: I,
  keyOf: (input: I) => string | number,
  compute: (input: I) => T,
  delayMs: number,
): { value: T | null; pending: boolean } {
  const debouncedInput = useDebouncedValue(input, delayMs);

  const computeRef = useRef(compute);
  computeRef.current = compute;
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;

  // Recompute only when the SETTLED input changes. `compute` reads the SAME
  // settled input the result is keyed to, so the key always matches the data
  // the result was derived from (no live/lagging skew).
  const [state, setState] = useState<{ key: string | number; value: T } | null>(
    null,
  );
  useEffect(() => {
    setState({
      key: keyOfRef.current(debouncedInput),
      value: computeRef.current(debouncedInput),
    });
  }, [debouncedInput]);

  // GUARD: hand back the value only while the key it was computed for still
  // equals the LIVE input's key. Any divergence (edit landed, debounce not yet
  // fired, or a settled recompute not yet committed) yields null + pending.
  const liveKey = keyOf(input);
  const matched = state !== null && state.key === liveKey;
  return { value: matched ? state.value : null, pending: !matched };
}
