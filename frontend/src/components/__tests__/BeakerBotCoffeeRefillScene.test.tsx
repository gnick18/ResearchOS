// frontend/src/components/__tests__/BeakerBotCoffeeRefillScene.test.tsx
//
// Smoke + behavior coverage for the BeakerBot CoffeeRefill reward scene.
// We don't try to assert on each individual keyframe (CSS animations
// are not introspectable from jsdom in any useful way) — instead we
// cover:
//
//   1. Mount/unmount: portal at document.body when active; nothing otherwise.
//   2. enterFrom drives the BeakerBot's translation direction.
//   3. Stages fire in order (use fake timers).
//   4. onComplete fires exactly once after the full duration.
//   5. Reduced-motion: static tableau, onComplete after 2s.
//   6. Mug-on-bench vs held-mug visibility per stage.
//   7. Heart-eye overlay renders only during heartEyes (and reduced-motion done).

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import BeakerBotCoffeeRefillScene, {
  STAGE_DURATIONS,
  STAGE_ORDER,
  TOTAL_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
} from "../BeakerBotCoffeeRefillScene";

// matchMedia override knob for the reduced-motion query.
type MqState = { matches: boolean };
const mqState: MqState = { matches: false };

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? mqState.matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("BeakerBotCoffeeRefillScene", () => {
  beforeEach(() => {
    mqState.matches = false;
    installMatchMedia();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders nothing when active=false", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active={false} onComplete={onComplete} />);
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("mounts via portal at document.body when active=true", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-coffee-refill-scene");
    expect(scene).toBeInTheDocument();
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-reduced-motion")).toBe("false");
    // First stage should be "walkIn".
    expect(scene.getAttribute("data-stage")).toBe("walkIn");
  });

  it("walks through every stage in STAGE_ORDER", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-coffee-refill-scene");
    const observed: string[] = [scene.getAttribute("data-stage")!];

    for (let i = 0; i < STAGE_ORDER.length; i++) {
      const dur = STAGE_DURATIONS[STAGE_ORDER[i] as keyof typeof STAGE_DURATIONS];
      act(() => {
        vi.advanceTimersByTime(dur);
      });
      observed.push(scene.getAttribute("data-stage")!);
    }

    // Recorded sequence: walkIn (initial) plus each subsequent stage,
    // ending at "done".
    expect(observed).toEqual([
      "walkIn",
      "pour",
      "sipPrep",
      "blow",
      "sip",
      "heartEyes",
      "walkOff",
      "done",
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onComplete exactly once after the full duration", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
    // 100ms shy of total — not yet.
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS - 100);
    });
    expect(onComplete).not.toHaveBeenCalled();
    // After full duration, fired exactly once.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    // Advancing further should NOT re-fire.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("renders static tableau under prefers-reduced-motion and fires onComplete after 2s", () => {
    mqState.matches = true;
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-coffee-refill-scene");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");
    expect(scene.getAttribute("data-stage")).toBe("done");

    // Reduced-motion tableau: held mug + heart-eye overlay are present
    // (the "after the sip" still frame). Bench mug should NOT be on
    // bench (BeakerBot is holding it).
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-mug-held")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-heart-eyes")).toBeInTheDocument();
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-mug-bench")).toBeNull();

    // Just shy of 2s — no onComplete yet.
    act(() => {
      vi.advanceTimersByTime(REDUCED_MOTION_DURATION_MS - 100);
    });
    expect(onComplete).not.toHaveBeenCalled();
    // After 2s total — onComplete fires.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("enterFrom='left' (default) translates BeakerBot from off-left", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    const bot = screen.getByTestId("beakerbot-coffee-refill-scene-bot");
    // Default enterFrom="left" — start position is -20vw (off the left).
    expect(bot.style.transform).toContain("-20vw");
  });

  it("enterFrom='right' translates BeakerBot from off-right instead", () => {
    const onComplete = vi.fn();
    render(
      <BeakerBotCoffeeRefillScene active onComplete={onComplete} enterFrom="right" />,
    );
    const bot = screen.getByTestId("beakerbot-coffee-refill-scene-bot");
    // enterFrom="right" — start position is 120vw (off the right).
    expect(bot.style.transform).toContain("120vw");
  });

  it("mug sits on bench during walkIn + pour, then becomes held from sipPrep onward", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    // Stage 1 (walkIn) — mug on bench, NOT held.
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-mug-bench")).toBeInTheDocument();
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-mug-held")).toBeNull();
    // Advance through walkIn → pour.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn);
    });
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-mug-bench")).toBeInTheDocument();
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-mug-held")).toBeNull();
    // Advance pour → sipPrep — mug should swap to held.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.pour);
    });
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-mug-bench")).toBeNull();
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-mug-held")).toBeInTheDocument();
  });

  it("heart-eye overlay only renders during heartEyes stage (not earlier)", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    // Stage 1 (walkIn) — no heart eyes yet.
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-heart-eyes")).toBeNull();
    // Advance walkIn → pour → sipPrep → blow → sip. Still no heart eyes.
    act(() => {
      vi.advanceTimersByTime(
        STAGE_DURATIONS.walkIn +
          STAGE_DURATIONS.pour +
          STAGE_DURATIONS.sipPrep +
          STAGE_DURATIONS.blow,
      );
    });
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-heart-eyes")).toBeNull();
    // Advance sip → heartEyes.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.sip);
    });
    const scene = screen.getByTestId("beakerbot-coffee-refill-scene");
    expect(scene.getAttribute("data-stage")).toBe("heartEyes");
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-heart-eyes")).toBeInTheDocument();
  });

  it("total duration matches sum of stage durations", () => {
    const sum =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.pour +
      STAGE_DURATIONS.sipPrep +
      STAGE_DURATIONS.blow +
      STAGE_DURATIONS.sip +
      STAGE_DURATIONS.heartEyes +
      STAGE_DURATIONS.walkOff;
    expect(TOTAL_DURATION_MS).toBe(sum);
    // Spec target: ~5000ms.
    expect(TOTAL_DURATION_MS).toBe(5000);
  });
});
