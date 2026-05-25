// frontend/src/hooks/__tests__/useMorningCalendarCoffeeTrigger.test.tsx
//
// Unit tests for the morning-calendar BeakerBot coffee trigger.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { renderHook } from "@testing-library/react";

import {
  decideMorningCalendarFire,
  formatLocalDateKey,
  MORNING_CUTOFF_HOUR,
  MORNING_STORAGE_KEY,
  useMorningCalendarCoffeeTrigger,
  __resetMorningCalendarCoffeeTriggerForTests,
} from "../useMorningCalendarCoffeeTrigger";
import { useSceneTriggerStore } from "@/lib/scene-trigger-store";

/** Build a Date at a specific local hour today, minute=`minute`. */
function dateAtHour(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

describe("formatLocalDateKey", () => {
  it("returns YYYY-MM-DD with zero-padded month + day", () => {
    const d = new Date(2026, 0, 5, 7, 30); // Jan 5 2026, 07:30 local
    expect(formatLocalDateKey(d)).toBe("2026-01-05");
  });

  it("uses LOCAL date, not UTC", () => {
    // Pick a moment late in the day so a UTC vs local conversion would
    // shift the date in some timezones.
    const d = new Date(2026, 11, 31, 23, 59); // Dec 31 2026, 23:59 local
    expect(formatLocalDateKey(d)).toBe("2026-12-31");
  });
});

describe("decideMorningCalendarFire (pure helper)", () => {
  const visible: DocumentVisibilityState = "visible";

  it("fires before the cutoff when nothing is stored", () => {
    const now = dateAtHour(7, 59);
    expect(
      decideMorningCalendarFire({
        now,
        visibilityState: visible,
        storedDateKey: null,
        sceneActive: false,
      }),
    ).toBe(formatLocalDateKey(now));
  });

  it("does NOT fire at the cutoff hour exactly", () => {
    expect(
      decideMorningCalendarFire({
        now: dateAtHour(MORNING_CUTOFF_HOUR),
        visibilityState: visible,
        storedDateKey: null,
        sceneActive: false,
      }),
    ).toBeNull();
  });

  it("does NOT fire after the cutoff", () => {
    expect(
      decideMorningCalendarFire({
        now: dateAtHour(9),
        visibilityState: visible,
        storedDateKey: null,
        sceneActive: false,
      }),
    ).toBeNull();
  });

  it("does NOT fire when today's date is already stored", () => {
    const now = dateAtHour(6);
    expect(
      decideMorningCalendarFire({
        now,
        visibilityState: visible,
        storedDateKey: formatLocalDateKey(now),
        sceneActive: false,
      }),
    ).toBeNull();
  });

  it("fires when stored date is yesterday (or any non-today key)", () => {
    const now = dateAtHour(6);
    expect(
      decideMorningCalendarFire({
        now,
        visibilityState: visible,
        storedDateKey: "1999-01-01",
        sceneActive: false,
      }),
    ).toBe(formatLocalDateKey(now));
  });

  it("does NOT fire when tab is hidden", () => {
    expect(
      decideMorningCalendarFire({
        now: dateAtHour(6),
        visibilityState: "hidden",
        storedDateKey: null,
        sceneActive: false,
      }),
    ).toBeNull();
  });

  it("does NOT fire when another scene is active", () => {
    expect(
      decideMorningCalendarFire({
        now: dateAtHour(6),
        visibilityState: visible,
        storedDateKey: null,
        sceneActive: true,
      }),
    ).toBeNull();
  });
});

describe("useMorningCalendarCoffeeTrigger (hook integration)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    useSceneTriggerStore.getState().__reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    useSceneTriggerStore.getState().__reset();
    __resetMorningCalendarCoffeeTriggerForTests();
  });

  it("fires at 07:59 on first mount and persists today's date", () => {
    const now = dateAtHour(7, 59);
    vi.setSystemTime(now);
    renderHook(() => useMorningCalendarCoffeeTrigger());

    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeMorningCalendar",
    );
    expect(sessionStorage.getItem(MORNING_STORAGE_KEY)).toBe(
      formatLocalDateKey(now),
    );
  });

  it("does NOT fire at 08:00 (cutoff exclusive)", () => {
    vi.setSystemTime(dateAtHour(8));
    renderHook(() => useMorningCalendarCoffeeTrigger());

    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });

  it("does NOT fire twice the same day (remount)", () => {
    const now = dateAtHour(6, 30);
    vi.setSystemTime(now);
    const { unmount } = renderHook(() =>
      useMorningCalendarCoffeeTrigger(),
    );
    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeMorningCalendar",
    );

    useSceneTriggerStore.getState().clearActiveScene();
    unmount();

    // Remount same morning — should NOT re-fire.
    renderHook(() => useMorningCalendarCoffeeTrigger());
    expect(useSceneTriggerStore.getState().activeScene).toBeNull();
  });

  it("fires again on a different day's morning", () => {
    // Day 1 morning.
    vi.setSystemTime(new Date(2026, 4, 25, 7, 30));
    const { unmount } = renderHook(() =>
      useMorningCalendarCoffeeTrigger(),
    );
    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeMorningCalendar",
    );
    useSceneTriggerStore.getState().clearActiveScene();
    unmount();

    // Day 2 morning — even though sessionStorage persists, the stored
    // date is yesterday, so the trigger should fire again.
    vi.setSystemTime(new Date(2026, 4, 26, 7, 30));
    renderHook(() => useMorningCalendarCoffeeTrigger());
    expect(useSceneTriggerStore.getState().activeScene).toBe(
      "coffeeMorningCalendar",
    );
  });
});
