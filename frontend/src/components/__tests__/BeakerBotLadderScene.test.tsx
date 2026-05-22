// Component tests for BeakerBotLadderScene — the side easter-egg
// scene that mounts BeakerBot on a ladder, plays the
// climb→clean→fall choreography, then calls onComplete.
//
// Covers:
//  - mount / unmount on active toggle
//  - portal target (document.body)
//  - onComplete fires after full duration (full motion path)
//  - both outcome paths render their disruption visuals
//  - reduced-motion short-circuit calls onComplete after ~3s without
//    cycling through the climb/clean/fall stages

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import BeakerBotLadderScene from "../BeakerBotLadderScene";

const FULL_DURATION_MS = 12300; // ladder-rise 800 + climb 2800 + top 300 +
//                                 clean 5000 + disruption 1900 + fall 1500
//
// Updated by the ladder-scene-polish pass: climb stretched 2000→2800ms
// so BeakerBot covers the *full* ladder height (was visibly jumping at
// the top), and disruption stretched 300→1900ms so the bird actually
// has time to fly across the screen and visibly bump him.

describe("BeakerBotLadderScene", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setMatchMedia(reducedMotion: boolean) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches:
          query.includes("prefers-reduced-motion") && reducedMotion ? true : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  it("does not mount when active is false", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    render(<BeakerBotLadderScene active={false} onComplete={onComplete} />);
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene"]'),
    ).toBeNull();
  });

  it("mounts into document.body when active becomes true", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    const { rerender } = render(
      <BeakerBotLadderScene
        active={false}
        onComplete={onComplete}
        outcome="slip"
      />,
    );
    rerender(
      <BeakerBotLadderScene active onComplete={onComplete} outcome="slip" />,
    );
    // Flush the mount effect.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const scene = document.body.querySelector(
      '[data-testid="beakerbot-ladder-scene"]',
    );
    expect(scene).not.toBeNull();
    expect(scene?.parentElement).toBe(document.body);
  });

  it("renders ladder + BeakerBot at mount", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotLadderScene active onComplete={onComplete} outcome="slip" />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene-ladder"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene-bot"]'),
    ).not.toBeNull();
  });

  it("calls onComplete once after the full animation duration", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotLadderScene active onComplete={onComplete} outcome="slip" />,
    );
    // Mount.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // Halfway through — should not have completed yet.
    act(() => {
      vi.advanceTimersByTime(FULL_DURATION_MS / 2);
    });
    expect(onComplete).not.toHaveBeenCalled();
    // Past the full duration.
    act(() => {
      vi.advanceTimersByTime(FULL_DURATION_MS);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("progresses through stages in order", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotLadderScene active onComplete={onComplete} outcome="slip" />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const scene = () =>
      document.querySelector('[data-testid="beakerbot-ladder-scene"]');

    // Initial: ladder-rise.
    expect(scene()?.getAttribute("data-stage")).toBe("ladder-rise");

    // After 800ms: climb.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(scene()?.getAttribute("data-stage")).toBe("climb");

    // After climb (2800ms more): top.
    act(() => {
      vi.advanceTimersByTime(2800);
    });
    expect(scene()?.getAttribute("data-stage")).toBe("top");

    // After top (300ms more): clean.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(scene()?.getAttribute("data-stage")).toBe("clean");

    // After clean (5000ms more): disruption.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(scene()?.getAttribute("data-stage")).toBe("disruption");

    // After disruption (1900ms more): fall.
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(scene()?.getAttribute("data-stage")).toBe("fall");
  });

  it("renders cleaning sparkles + wipe overlay during clean stage", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotLadderScene active onComplete={onComplete} outcome="slip" />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // Skip to clean stage: 800 + 2800 + 300 = 3900ms.
    act(() => {
      vi.advanceTimersByTime(3900);
    });
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene-wipe"]'),
    ).not.toBeNull();
    expect(
      document.querySelectorAll(
        '[data-testid="beakerbot-ladder-scene-sparkle"]',
      ).length,
    ).toBeGreaterThan(0);
  });

  it("renders bird element when outcome is bird-bump", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotLadderScene
        active
        onComplete={onComplete}
        outcome="bird-bump"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // Advance to disruption: 800 + 2800 + 300 + 5000 = 8900ms.
    act(() => {
      vi.advanceTimersByTime(8900);
    });
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene-bird"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene"]')
        ?.getAttribute("data-outcome"),
    ).toBe("bird-bump");
  });

  it("does NOT render a bird when outcome is slip", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotLadderScene active onComplete={onComplete} outcome="slip" />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // Advance to disruption: 800 + 2800 + 300 + 5000 = 8900ms.
    act(() => {
      vi.advanceTimersByTime(8900);
    });
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene-bird"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene"]')
        ?.getAttribute("data-outcome"),
    ).toBe("slip");
  });

  it("respects prefers-reduced-motion: short-circuits to onComplete after ~3s", () => {
    setMatchMedia(true);
    const onComplete = vi.fn();
    render(
      <BeakerBotLadderScene active onComplete={onComplete} outcome="slip" />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const scene = () =>
      document.querySelector('[data-testid="beakerbot-ladder-scene"]');
    expect(scene()?.getAttribute("data-reduced-motion")).toBe("true");
    // Should land directly on "top" stage (static).
    expect(scene()?.getAttribute("data-stage")).toBe("top");

    // After 2.5s: still hasn't completed.
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(onComplete).not.toHaveBeenCalled();

    // After 3s total: completes.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("unmounts cleanly when active toggles back to false mid-animation", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    const { rerender } = render(
      <BeakerBotLadderScene active onComplete={onComplete} outcome="slip" />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene"]'),
    ).not.toBeNull();

    // Cancel mid-animation.
    rerender(
      <BeakerBotLadderScene
        active={false}
        onComplete={onComplete}
        outcome="slip"
      />,
    );
    expect(
      document.querySelector('[data-testid="beakerbot-ladder-scene"]'),
    ).toBeNull();

    // Even after the full duration elapses, onComplete must not fire —
    // the timers were cleared on unmount.
    act(() => {
      vi.advanceTimersByTime(FULL_DURATION_MS + 1000);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("places the ladder on the left when side='left'", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotLadderScene
        active
        onComplete={onComplete}
        outcome="slip"
        side="left"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const ladder = document.querySelector(
      '[data-testid="beakerbot-ladder-scene-ladder"]',
    ) as HTMLElement | null;
    expect(ladder).not.toBeNull();
    expect(ladder?.style.left).not.toBe("");
    expect(ladder?.style.right).toBe("");
  });

  it("has aria-hidden + pointer-events: none on the overlay", () => {
    setMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotLadderScene active onComplete={onComplete} outcome="slip" />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const scene = document.querySelector(
      '[data-testid="beakerbot-ladder-scene"]',
    ) as HTMLElement | null;
    expect(scene?.getAttribute("aria-hidden")).toBe("true");
    expect(scene?.style.pointerEvents).toBe("none");
  });
});

// Type-only re-import to make sure the public type surface stays usable
// for callers (catches accidental non-exporting of the props type).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { BeakerBotLadderSceneProps } from "../BeakerBotLadderScene";
// Trivial usage so the import isn't tree-shaken / flagged.
const _typecheckScreenIsImported: typeof screen = screen;
void _typecheckScreenIsImported;
