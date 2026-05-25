// frontend/src/hooks/__tests__/useLateNightCoffeeTrigger.test.tsx
//
// Unit tests for the late-night BeakerBot coffee trigger.
//
// We cover both the pure `decideLateNightFire` helper (cheap, no React
// or timers needed) AND the React hook in `renderHook` for the
// integration path (mount fires, polling crosses hour boundaries, the
// sessionStorage throttle survives a remount).

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  decideLateNightFire,
  LATE_NIGHT_POLL_MS,
  LATE_NIGHT_STORAGE_KEY,
  useLateNightCoffeeTrigger,
  __resetLateNightCoffeeTriggerForTests,
} from "../useLateNightCoffeeTrigger";
import { useSceneTriggerStore } from "@/lib/scene-trigger-store";

/** Build a Date with a specific local hour today, minute=30. */
function dateAtHour(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 30, 0, 0);
  return d;
}

describe("decideLateNightFire (pure helper)", () => {
  const visible: DocumentVisibilityState = "visible";

  it("returns the hour when in the late-night window and never fired", () => {
    for (const h of [23, 0, 1, 2]) {
      expect(
        decideLateNightFire({
          now: dateAtHour(h),
          visibilityState: visible,
          firedHours: new Set(),
          sceneActive: false,
        }),
      ).toBe(h);
    }
  });

  it("returns null at the boundary hours just outside the window", () => {
    for (const h of [22, 3]) {
      expect(
        decideLateNightFire({
          now: dateAtHour(h),
          visibilityState: visible,
          firedHours: new Set(),
          sceneActive: false,
        }),
      ).toBeNull();
    }
  });

  it("returns null when the hour has already fired this session", () => {
    expect(
      decideLateNightFire({
        now: dateAtHour(1),
        visibilityState: visible,
        firedHours: new Set([1]),
        sceneActive: false,
      }),
    ).toBeNull();
  });

  it("returns null when the tab is hidden", () => {
    expect(
      decideLateNightFire({
        now: dateAtHour(0),
        visibilityState: "hidden",
        firedHours: new Set(),
        sceneActive: false,
      }),
    ).toBeNull();
  });

  it("returns null when a scene is already active", () => {
    expect(
      decideLateNightFire({
        now: dateAtHour(0),
        visibilityState: visible,
        firedHours: new Set(),
        sceneActive: true,
      }),
    ).toBeNull();
  });

  it("fires hour 23 even when hour 1 already fired (different hour key)", () => {
    expect(
      decideLateNightFire({
        now: dateAtHour(23),
        visibilityState: visible,
        firedHours: new Set([1]),
        sceneActive: false,
      }),
    ).toBe(23);
  });
});

describe("useLateNightCoffeeTrigger (hook integration)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    useSceneTriggerStore.getState().__reset();
    // Default to visible — jsdom does not let us set
    // document.visibilityState directly, but it reads "visible" by
    // default which is what we want for most tests.
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    useSceneTriggerStore.getState().__reset();
    __resetLateNightCoffeeTriggerForTests();
  });

  it("fires on mount at 23:30", () => {
    vi.setSystemTime(dateAtHour(23));
    renderHook(() => useLateNightCoffeeTrigger());

    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeLateNight",
    );
    expect(
      JSON.parse(sessionStorage.getItem(LATE_NIGHT_STORAGE_KEY) ?? "[]"),
    ).toEqual([23]);
  });

  it("does NOT fire at 22:30 (outside the window)", () => {
    vi.setSystemTime(dateAtHour(22));
    renderHook(() => useLateNightCoffeeTrigger());

    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });

  it("does NOT fire at 03:30 (outside the window)", () => {
    vi.setSystemTime(dateAtHour(3));
    renderHook(() => useLateNightCoffeeTrigger());

    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });

  it("crosses hour boundaries: fires at 23, 0, 1, 2 each exactly once", () => {
    vi.setSystemTime(dateAtHour(23));
    renderHook(() => useLateNightCoffeeTrigger());
    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeLateNight",
    );

    // Simulate scene completion + advance to next hour.
    act(() => {
      useSceneTriggerStore.getState().clearActiveScene();
    });

    // Crossing into 00:30.
    vi.setSystemTime(dateAtHour(0));
    act(() => {
      vi.advanceTimersByTime(LATE_NIGHT_POLL_MS);
    });
    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeLateNight",
    );

    act(() => {
      useSceneTriggerStore.getState().clearActiveScene();
    });

    // Crossing into 01:30.
    vi.setSystemTime(dateAtHour(1));
    act(() => {
      vi.advanceTimersByTime(LATE_NIGHT_POLL_MS);
    });
    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeLateNight",
    );

    act(() => {
      useSceneTriggerStore.getState().clearActiveScene();
    });

    // Crossing into 02:30.
    vi.setSystemTime(dateAtHour(2));
    act(() => {
      vi.advanceTimersByTime(LATE_NIGHT_POLL_MS);
    });
    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeLateNight",
    );

    act(() => {
      useSceneTriggerStore.getState().clearActiveScene();
    });

    // Crossing into 03:30 (out of window) — no fire.
    vi.setSystemTime(dateAtHour(3));
    act(() => {
      vi.advanceTimersByTime(LATE_NIGHT_POLL_MS);
    });
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();

    // All four hours recorded.
    expect(
      JSON.parse(sessionStorage.getItem(LATE_NIGHT_STORAGE_KEY) ?? "[]")
        .sort(),
    ).toEqual([0, 1, 2, 23]);
  });

  it("does NOT double-fire on poll inside the same hour", () => {
    vi.setSystemTime(dateAtHour(0));
    renderHook(() => useLateNightCoffeeTrigger());
    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeLateNight",
    );

    act(() => {
      useSceneTriggerStore.getState().clearActiveScene();
    });

    // Same hour, advance through several poll cycles. No re-fire.
    act(() => {
      vi.advanceTimersByTime(LATE_NIGHT_POLL_MS * 5);
    });
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });

  it("sessionStorage persists across remount within the same hour", () => {
    vi.setSystemTime(dateAtHour(1));
    const { unmount } = renderHook(() => useLateNightCoffeeTrigger());
    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeLateNight",
    );

    act(() => {
      useSceneTriggerStore.getState().clearActiveScene();
    });
    unmount();

    // Remount while still hour 1 — should NOT fire again.
    renderHook(() => useLateNightCoffeeTrigger());
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });
});
