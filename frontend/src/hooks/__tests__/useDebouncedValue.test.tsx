/**
 * debounce-perf bot — unit tests for the debounce hook + the stale-guard
 * derivation that keeps expensive whole-sequence work (restriction digest /
 * find scan / ORF scan) off the typing hot path WITHOUT ever rendering a result
 * computed for one sequence revision against a different one.
 *
 * Coverage:
 *   useDebouncedValue
 *     1. returns the initial value immediately,
 *     2. holds the old value until the delay elapses, then emits the latest,
 *     3. collapses a burst of rapid changes to the final value (trailing edge).
 *   useStaleGuardedValue (the correctness guard)
 *     4. value is null + pending until the debounced compute settles,
 *     5. once settled, value is the freshly computed result for the live key,
 *     6. a NEW input flips back to pending (null) until its rescan settles —
 *        i.e. a stale result is REJECTED, never returned at a different key,
 *     7. compute runs on the SETTLED input (the result's key matches the data
 *        it was derived from), and compute is NOT called per intermediate value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue, useStaleGuardedValue } from "../useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 200));
    expect(result.current).toBe("a");
  });

  it("holds the old value until the delay elapses, then emits the latest", () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 200),
      { initialProps: { v: "a" } },
    );
    rerender({ v: "b" });
    // Not yet settled.
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(199));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("b");
  });

  it("collapses a rapid burst to the final value (trailing edge only)", () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 200),
      { initialProps: { v: "a" } },
    );
    rerender({ v: "ab" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "abc" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ v: "abcd" });
    // Each change reset the timer, so nothing settled yet.
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("abcd");
  });
});

describe("useStaleGuardedValue (stale-position guard)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // A stand-in for an absolute-position derivation: returns the input's length
  // tagged so we can assert WHICH revision produced the result.
  const keyOf = (s: string) => `len:${s.length}`;
  const compute = (s: string) => ({ from: s, length: s.length });

  it("settles the INITIAL input immediately (no debounce on first paint), then stays fresh", () => {
    const { result } = renderHook(() =>
      useStaleGuardedValue("AAAA", keyOf, compute, 200),
    );
    // The debounce seeds with the initial input, so the very first input's
    // result lands on mount (no artificial first-paint lag) and is fresh.
    expect(result.current.pending).toBe(false);
    expect(result.current.value).toEqual({ from: "AAAA", length: 4 });
    // Advancing time with no change keeps it settled.
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.value).toEqual({ from: "AAAA", length: 4 });
  });

  it("REJECTS a stale result when the input changes (never returns a value at a different key)", () => {
    const { result, rerender } = renderHook(
      ({ s }) => useStaleGuardedValue(s, keyOf, compute, 200),
      { initialProps: { s: "AAAA" } },
    );
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.value).toEqual({ from: "AAAA", length: 4 });

    // Input edited: the live key is now len:5, but the only settled result is
    // keyed len:4. The guard must hide it (null + pending) rather than return a
    // 4-long result against the 5-long live input.
    rerender({ s: "AAAAA" });
    expect(result.current.value).toBeNull();
    expect(result.current.pending).toBe(true);

    // Once the rescan settles, the fresh, live-keyed result appears.
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.pending).toBe(false);
    expect(result.current.value).toEqual({ from: "AAAAA", length: 5 });
  });

  it("skips intermediate revisions: computes only the initial + final settled input", () => {
    const spy = vi.fn(compute);
    const { result, rerender } = renderHook(
      ({ s }) => useStaleGuardedValue(s, keyOf, spy, 200),
      { initialProps: { s: "A" } },
    );
    // The initial "A" settled on mount (1 compute). Now a rapid burst before
    // any further settle.
    spy.mockClear();
    rerender({ s: "AB" });
    rerender({ s: "ABC" });
    rerender({ s: "ABCD" });
    act(() => vi.advanceTimersByTime(200));
    // After the burst, compute ran exactly once more — on the FINAL settled
    // input, never on the intermediate "AB"/"ABC" revisions.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("ABCD");
    // The returned result was derived from the same revision its key encodes.
    expect(result.current.value).toEqual({ from: "ABCD", length: 4 });
  });
});
