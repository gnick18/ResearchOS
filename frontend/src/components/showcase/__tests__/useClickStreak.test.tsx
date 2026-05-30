// Tests for the showcase click-reward engine (click-rewards sub-bot,
// orchestrator manager). Asserts the TWO tiers:
//   TIER 1: every registerClick spawns a capped, self-expiring cursor burst
//     at the supplied point; the live list never exceeds the cap.
//   TIER 2: crossing the rolling-window threshold (>= WILD_THRESHOLD clicks
//     within WILD_WINDOW_MS) flips `wild` true and bumps the wave key; slow
//     clicks (outside the window) never go wild; `wild` settles back to false
//     after WILD_SETTLE_MS of no clicks; a fresh streak re-arms a new wave.
//
// Timing is driven by a mocked performance.now (the hook reads it for the
// rolling window) advanced in lockstep with vitest fake timers (the hook's
// burst-expiry + settle timers). No emojis, no em-dashes.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useClickStreak,
  BURST_MAX_CONCURRENT,
  BURST_LIFETIME_MS,
  WILD_THRESHOLD,
  WILD_WINDOW_MS,
  WILD_SETTLE_MS,
} from "../useClickStreak";

// A controllable clock shared by performance.now() (rolling window) and the
// fake timers (burst-expiry + settle). advanceClock moves both together.
let now = 0;
function advanceClock(ms: number) {
  now += ms;
  vi.advanceTimersByTime(ms);
}

beforeEach(() => {
  now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useClickStreak - Tier 1 cursor bursts", () => {
  it("spawns a burst at the click point on each click", () => {
    const { result } = renderHook(() => useClickStreak());
    expect(result.current.bursts).toHaveLength(0);
    act(() => result.current.registerClick(120, 240));
    expect(result.current.bursts).toHaveLength(1);
    expect(result.current.bursts[0]).toMatchObject({ x: 120, y: 240 });
  });

  it("expires a burst after its lifetime", () => {
    const { result } = renderHook(() => useClickStreak());
    act(() => result.current.registerClick(10, 10));
    expect(result.current.bursts).toHaveLength(1);
    act(() => advanceClock(BURST_LIFETIME_MS + 20));
    expect(result.current.bursts).toHaveLength(0);
  });

  it("caps concurrent bursts so spam does not pile up unbounded", () => {
    const { result } = renderHook(() => useClickStreak());
    act(() => {
      for (let i = 0; i < BURST_MAX_CONCURRENT + 8; i++) {
        result.current.registerClick(i, i);
      }
    });
    expect(result.current.bursts.length).toBeLessThanOrEqual(
      BURST_MAX_CONCURRENT,
    );
  });
});

describe("useClickStreak - Tier 2 crowd goes wild", () => {
  it("does NOT go wild on slow clicks (outside the rolling window)", () => {
    const { result } = renderHook(() => useClickStreak());
    // Click WILD_THRESHOLD+2 times but spaced so the window never holds enough.
    const spacing = WILD_WINDOW_MS + 50; // each click ages the prior out of window
    for (let i = 0; i < WILD_THRESHOLD + 2; i++) {
      act(() => result.current.registerClick(0, 0));
      act(() => advanceClock(spacing));
    }
    expect(result.current.wild).toBe(false);
    expect(result.current.wildWaveKey).toBe(0);
  });

  it("goes wild when the threshold is crossed inside the window", () => {
    const { result } = renderHook(() => useClickStreak());
    act(() => {
      for (let i = 0; i < WILD_THRESHOLD; i++) {
        result.current.registerClick(0, 0);
        now += 100; // fast: well inside WILD_WINDOW_MS
      }
    });
    expect(result.current.wild).toBe(true);
    expect(result.current.wildWaveKey).toBe(1);
  });

  it("escalates on sustained clicking while wild", () => {
    const { result } = renderHook(() => useClickStreak());
    act(() => {
      for (let i = 0; i < WILD_THRESHOLD; i++) {
        result.current.registerClick(0, 0);
        now += 100;
      }
    });
    const wave = result.current.wildWaveKey;
    const escalateBefore = result.current.wildEscalateKey;
    // Keep clicking fast: still wild, same wave, escalate key advances.
    act(() => {
      for (let i = 0; i < 3; i++) {
        result.current.registerClick(0, 0);
        now += 100;
      }
    });
    expect(result.current.wild).toBe(true);
    expect(result.current.wildWaveKey).toBe(wave); // same wave, not a new one
    expect(result.current.wildEscalateKey).toBeGreaterThan(escalateBefore);
  });

  it("settles back down after clicking stops, then re-arms a new wave", () => {
    const { result } = renderHook(() => useClickStreak());
    // Cross the threshold.
    act(() => {
      for (let i = 0; i < WILD_THRESHOLD; i++) {
        result.current.registerClick(0, 0);
        now += 100;
      }
    });
    expect(result.current.wild).toBe(true);
    expect(result.current.wildWaveKey).toBe(1);
    // Stop clicking: after the settle window it drops back to calm.
    act(() => advanceClock(WILD_SETTLE_MS + 50));
    expect(result.current.wild).toBe(false);
    // A fresh rapid streak re-arms wild AND a NEW wave (key increments).
    act(() => {
      for (let i = 0; i < WILD_THRESHOLD; i++) {
        result.current.registerClick(0, 0);
        now += 100;
      }
    });
    expect(result.current.wild).toBe(true);
    expect(result.current.wildWaveKey).toBe(2);
  });
});
