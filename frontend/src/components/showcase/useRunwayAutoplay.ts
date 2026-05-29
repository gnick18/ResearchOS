"use client";

// frontend/src/components/showcase/useRunwayAutoplay.ts
//
// The runway auto-show clock. The redesigned runway is hands-free: it
// stands BeakerBot center stage and cycles through the 21 emotions on a
// timer, looping forever, with no scroll involved. This hook owns that
// clock: it returns the index of the look currently on stage and a
// `bumpKey` that ticks on every advance (so the spotlight + flash entry
// can re-fire per look).
//
// Reduced motion (project rule + R3.10): under prefers-reduced-motion we
// do NOT auto-advance. The show holds a single static pose; the caller
// surfaces a manual "next look" affordance so a reduced-motion viewer can
// still walk the looks at their own pace. `advance()` is the manual step
// used both by that affordance and (harmlessly) at any time.

import { useCallback, useEffect, useRef, useState } from "react";

/** Default hold per look (ms). ~2.4s reads as a watchable runway beat:
 *  long enough to register the pose, short enough to keep moving. */
export const RUNWAY_HOLD_MS = 2400;

export function useRunwayAutoplay(
  count: number,
  options?: { holdMs?: number },
): {
  /** Index of the look currently on stage. */
  activeIndex: number;
  /** Ticks on every advance; key the spotlight / flash entry off this. */
  bumpKey: number;
  /** True when the timer is driving the show (full motion). */
  autoplaying: boolean;
  /** Manually step to the next look (used by the reduced-motion control
   *  and available to any caller). */
  advance: () => void;
} {
  const holdMs = options?.holdMs ?? RUNWAY_HOLD_MS;
  const [activeIndex, setActiveIndex] = useState(0);
  const [bumpKey, setBumpKey] = useState(0);
  const [autoplaying, setAutoplaying] = useState(false);

  const advance = useCallback(() => {
    if (count <= 0) return;
    setActiveIndex((i) => (i + 1) % count);
    setBumpKey((k) => k + 1);
  }, [count]);

  // Keep a stable advance ref so the interval effect does not re-subscribe
  // every render (count is the only real dependency).
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (count <= 1) return;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setAutoplaying(false);
      return;
    }

    setAutoplaying(true);
    const id = window.setInterval(() => {
      advanceRef.current();
    }, holdMs);
    return () => {
      window.clearInterval(id);
      setAutoplaying(false);
    };
  }, [count, holdMs]);

  return { activeIndex, bumpKey, autoplaying, advance };
}
