// Tests for IdleAnimationManager. Covers the gating contract:
//  - Fires after IDLE_THRESHOLD_MS of no input
//  - Does NOT fire if user input arrives before the threshold
//  - Does NOT fire twice in the same session (sessionStorage lock)
//  - Does NOT fire when document.visibilityState === "hidden"
//  - pickRandomIdleAnimation honors Math.random for deterministic picks
//
// Strategy: render the manager, then drive
//   vi.advanceTimersByTime(IDLE_THRESHOLD_MS)
// and assert on the data-testid of the rendered scene. The underlying
// scenes (BlowingBubbles, TooManyBeakers) are real components but they
// mount portals into document.body and expose test ids, so we don't
// need to mock them — we just query the DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import IdleAnimationManager, {
  IDLE_FIRED_SESSION_KEY,
  IDLE_POOL,
  IDLE_THRESHOLD_MS,
  pickRandomIdleAnimation,
} from "@/components/onboarding/IdleAnimationManager";

// Helper: query both possible scene test ids. Manager renders ONE
// scene at a time (or none).
function activeSceneCount(): number {
  return document.querySelectorAll(
    [
      '[data-testid="beakerbot-blowing-bubbles-scene"]',
      '[data-testid="beakerbot-too-many-beakers-scene"]',
    ].join(","),
  ).length;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // Clear any leftover lock from a prior test in the same worker.
  window.sessionStorage.removeItem(IDLE_FIRED_SESSION_KEY);
  setVisibility("visible");
  // Default matchMedia stub: not reduced-motion. The scenes inspect
  // matchMedia inside their effects when they activate.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.removeItem(IDLE_FIRED_SESSION_KEY);
});

describe("IdleAnimationManager", () => {
  it("fires a scene after IDLE_THRESHOLD_MS of no input", () => {
    // Pin pickRandomIdleAnimation to entry 0 (bubbles) via Math.random
    // so the assertion is deterministic.
    vi.spyOn(Math, "random").mockReturnValue(0);

    render(<IdleAnimationManager />);
    expect(activeSceneCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 100);
    });

    expect(activeSceneCount()).toBe(1);
    // sessionStorage lock should be set after the fire.
    expect(window.sessionStorage.getItem(IDLE_FIRED_SESSION_KEY)).toBe("1");
  });

  it("does NOT fire if a user input arrives before the threshold", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    render(<IdleAnimationManager />);

    // Halfway to the threshold, simulate user input. The throttle
    // window is 250ms; this single event should re-arm the timer.
    act(() => {
      vi.advanceTimersByTime(IDLE_THRESHOLD_MS / 2);
      window.dispatchEvent(new Event("mousemove"));
    });

    // Advance past the ORIGINAL threshold but not past a fresh one.
    // If the re-arm worked, no scene yet. Use slightly less than the
    // full threshold to leave headroom.
    act(() => {
      vi.advanceTimersByTime(IDLE_THRESHOLD_MS - 1000);
    });

    expect(activeSceneCount()).toBe(0);
  });

  it("does NOT fire twice in the same session (sessionStorage lock)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    // Simulate the lock having been set by a prior fire in this
    // session. Mount + advance well past the threshold. No scene
    // should appear.
    window.sessionStorage.setItem(IDLE_FIRED_SESSION_KEY, "1");

    render(<IdleAnimationManager />);
    act(() => {
      vi.advanceTimersByTime(IDLE_THRESHOLD_MS * 2);
    });

    expect(activeSceneCount()).toBe(0);
  });

  it("does NOT fire when document.visibilityState === 'hidden'", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    setVisibility("hidden");
    render(<IdleAnimationManager />);
    act(() => {
      vi.advanceTimersByTime(IDLE_THRESHOLD_MS + 1000);
    });

    expect(activeSceneCount()).toBe(0);
    // Lock should NOT have been set — we never actually fired.
    expect(window.sessionStorage.getItem(IDLE_FIRED_SESSION_KEY)).toBeNull();
  });

  it("pickRandomIdleAnimation lands on each pool entry given the right Math.random", () => {
    // Math.random=0 → first entry. Math.random=0.99 → last entry.
    const rng = vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickRandomIdleAnimation().id).toBe(IDLE_POOL[0]!.id);
    rng.mockReturnValue(0.99);
    expect(pickRandomIdleAnimation().id).toBe(
      IDLE_POOL[IDLE_POOL.length - 1]!.id,
    );
  });
});
