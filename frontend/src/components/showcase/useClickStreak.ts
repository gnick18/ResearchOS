"use client";

// frontend/src/components/showcase/useClickStreak.ts
//
// Click-reward engine for the BeakerBot /showcase stage (click-rewards
// sub-bot, orchestrator manager). Two tiers, both driven from one place:
//
//   TIER 1 (every click): spawn a short-lived BURST at the cursor (a
//     sparkle pop + expanding ring). Capped so spam does not pile up.
//   TIER 2 (click a TON): track the click RATE over a rolling window; when
//     the user crosses the wild threshold (>= WILD_THRESHOLD clicks within
//     WILD_WINDOW_MS), report `wild = true` so the caller can stage the
//     crowd-goes-wild celebration (thrown roses + a cheeky bra, confetti,
//     a flash flurry). `wild` SETTLES back to false a beat after the rapid
//     clicking stops (WILD_SETTLE_MS), so the tributes clear on their own.
//
// This hook owns NO DOM: it returns the live burst list + the wild flags
// and a single `registerClick(clientX, clientY)` to call from a stage
// click handler. Rendering lives in <ClickRewards>. Reused by both the
// Runway view and the Performance Hall (Scenes) view.
//
// Performance: bursts are capped (BURST_MAX_CONCURRENT); each burst self-
// expires via a tracked timer that is drained on unmount. Click timestamps
// are pruned to the rolling window on every click so the array stays tiny.
// No emojis, no em-dashes.

import { useCallback, useEffect, useRef, useState } from "react";

/** Tier-1 cursor bursts: cap concurrent so a spam-click does not queue an
 *  unbounded number of timeout closures (mirrors HEART_MAX_CONCURRENT in
 *  BeakerBot.tsx). */
export const BURST_MAX_CONCURRENT = 12;

/** How long a single cursor burst lives before it is GC'd. Must match the
 *  longest .clickBurst* keyframe duration in showcase.module.css. */
export const BURST_LIFETIME_MS = 620;

/** Tier-2 rolling window: this many clicks within this many ms crosses the
 *  "crowd goes wild" threshold. Tuned to ~5-6 fast clicks in ~1.5s, which a
 *  deliberate rapid-click reaches but normal tapping does not. */
export const WILD_THRESHOLD = 5;
export const WILD_WINDOW_MS = 1500;

/** Once wild, stay wild until the clicking stops for this long, then settle
 *  back down (tributes clear / fade). Re-arms `wild` immediately on the next
 *  qualifying streak. */
export const WILD_SETTLE_MS = 1800;

export interface ClickBurst {
  id: number;
  /** Pointer position relative to the stage element, in px. */
  x: number;
  y: number;
  /** A small variant index (0..2) so consecutive bursts are not identical. */
  variant: number;
}

export interface UseClickStreakResult {
  /** Live cursor bursts to render (Tier 1). */
  bursts: ClickBurst[];
  /** True while the crowd-goes-wild celebration should run (Tier 2). */
  wild: boolean;
  /** Monotonic counter that bumps each time a NEW wild celebration begins
   *  (a fresh threshold crossing after a settle). Lets the celebration layer
   *  re-key its thrown tributes / confetti so a new wave is staged. */
  wildWaveKey: number;
  /** Monotonic counter that bumps on EVERY click while wild (sustained
   *  clicking). The celebration uses this to escalate (throw more tributes /
   *  confetti) the longer the audience keeps clapping. */
  wildEscalateKey: number;
  /** Call from the stage click handler with the pointer position relative to
   *  the stage element. Spawns a Tier-1 burst and advances the Tier-2 streak. */
  registerClick: (x: number, y: number) => void;
}

export function useClickStreak(): UseClickStreakResult {
  const [bursts, setBursts] = useState<ClickBurst[]>([]);
  const [wild, setWild] = useState(false);
  const [wildWaveKey, setWildWaveKey] = useState(0);
  const [wildEscalateKey, setWildEscalateKey] = useState(0);

  // Monotonic ids for bursts + the spawn variant cycle.
  const burstCounterRef = useRef(0);
  // Recent click timestamps, pruned to the rolling window on each click.
  const clickTimesRef = useRef<number[]>([]);
  // Whether we are currently in a wild run (mirrors `wild` for use inside the
  // click callback without adding it to the dependency list).
  const wildRef = useRef(false);
  // The settle timer that drops back out of wild once clicking stops.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracked burst-cleanup timers so we can drain them on unmount.
  const burstTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const burstTimers = burstTimersRef.current;
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      burstTimers.forEach((t) => clearTimeout(t));
      burstTimers.clear();
    };
  }, []);

  const registerClick = useCallback((x: number, y: number) => {
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    // ── Tier 1: spawn a capped, self-expiring cursor burst ──────────────
    const id = burstCounterRef.current++;
    const variant = id % 3;
    setBursts((prev) => {
      const next = [...prev, { id, x, y, variant }];
      // Drop the oldest beyond the cap so the live list stays bounded.
      return next.length > BURST_MAX_CONCURRENT
        ? next.slice(next.length - BURST_MAX_CONCURRENT)
        : next;
    });
    const t = setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
      burstTimersRef.current.delete(t);
    }, BURST_LIFETIME_MS);
    burstTimersRef.current.add(t);

    // ── Tier 2: advance the rolling-window click rate ───────────────────
    const times = clickTimesRef.current;
    times.push(now);
    // Prune anything older than the window so the count reflects only the
    // current burst of activity.
    const cutoff = now - WILD_WINDOW_MS;
    while (times.length > 0 && times[0]! < cutoff) times.shift();

    const crossed = times.length >= WILD_THRESHOLD;
    if (crossed) {
      if (!wildRef.current) {
        // Fresh crossing: start a new wild wave.
        wildRef.current = true;
        setWild(true);
        setWildWaveKey((k) => k + 1);
      }
      // Sustained clicking while wild escalates the celebration.
      setWildEscalateKey((k) => k + 1);
      // (Re)arm the settle timer: wild persists until clicking stops.
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        wildRef.current = false;
        setWild(false);
        settleTimerRef.current = null;
      }, WILD_SETTLE_MS);
    }
  }, []);

  return { bursts, wild, wildWaveKey, wildEscalateKey, registerClick };
}
