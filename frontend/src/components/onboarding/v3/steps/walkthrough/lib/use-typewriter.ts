import { useEffect, useRef, useState } from "react";

/**
 * Simulate BeakerBot live-typing text character by character at a
 * human-readable cadence (L12 lock: ~80-120ms per char). Used by W5
 * (hybrid editor shortcut demo) and W7 (search query demo).
 *
 * Returns the substring revealed so far plus a `done` flag. The hook
 * starts typing immediately on mount; `key` lets the parent restart a
 * stream when the source text changes (e.g. moving between the bold /
 * italic / code-block segments of W5).
 *
 * Cadence rationale: the brief specifies 80-120ms per char. A flat
 * 95ms lands inside the range and reads as deliberate without being
 * too slow. Tests can override via `cadenceMs` (and we recommend
 * `cadenceMs: 0` in jsdom for instant resolution).
 */

interface UseTypewriterOptions {
  /** Characters revealed per tick. Default 1. Tests can bump to e.g. 1000
   *  so a single tick reveals the whole string. */
  charsPerTick?: number;
  /** Milliseconds between ticks. Default 95. Pass 0 to skip the timer
   *  entirely and resolve fully on next microtask (used by tests). */
  cadenceMs?: number;
  /** When provided, called once per tick with `revealed` so far. Useful
   *  for syncing a secondary surface (e.g. a real input element) with
   *  the typewriter's progress. */
  onTick?: (revealed: string) => void;
  /** Restart the stream when this value changes. */
  key?: string | number;
  /** When false, the hook is dormant — useful to defer until the user
   *  reaches the step. Default true. */
  active?: boolean;
}

export function useTypewriter(
  source: string,
  options: UseTypewriterOptions = {},
): { revealed: string; done: boolean } {
  const {
    charsPerTick = 1,
    cadenceMs = 95,
    onTick,
    key,
    active = true,
  } = options;

  const [revealed, setRevealed] = useState("");
  const sourceRef = useRef(source);
  const onTickRef = useRef(onTick);
  // Sync refs in an effect so the interval closure always sees the
  // latest callback / source string without forcing a re-create on
  // every render. Doing this during render trips React's
  // refs-in-render lint.
  useEffect(() => {
    onTickRef.current = onTick;
    sourceRef.current = source;
  }, [onTick, source]);

  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- typewriter resets to empty on key change before scheduling the next tick; this is a sync-with-external-cadence pattern, not a cascading render trigger
    setRevealed("");
    let index = 0;
    if (cadenceMs <= 0) {
      // Reveal everything on the next microtask so callers can still
      // assert before/after states in tests.
      void Promise.resolve().then(() => {
        const all = sourceRef.current;
        setRevealed(all);
        onTickRef.current?.(all);
      });
      return;
    }
    const id = window.setInterval(() => {
      const src = sourceRef.current;
      index = Math.min(index + charsPerTick, src.length);
      const next = src.slice(0, index);
      setRevealed(next);
      onTickRef.current?.(next);
      if (index >= src.length) {
        window.clearInterval(id);
      }
    }, cadenceMs);
    return () => window.clearInterval(id);
  }, [active, cadenceMs, charsPerTick, key]);

  return {
    revealed,
    done: revealed.length >= source.length,
  };
}
