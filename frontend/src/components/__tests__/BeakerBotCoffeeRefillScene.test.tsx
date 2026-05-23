// frontend/src/components/__tests__/BeakerBotCoffeeRefillScene.test.tsx
//
// Smoke + behavior coverage for the BeakerBot CoffeeRefill reward scene
// (R2 full redesign — coffee machine + bean pour + 8s brewing + whistle
// + carry-off). We don't try to assert on each individual keyframe (CSS
// animations are not introspectable from jsdom in any useful way) —
// instead we cover:
//
//   1. Mount/unmount: portal at document.body when active; nothing otherwise.
//   2. enterFrom drives BeakerBot's translation direction.
//   3. Stages fire in order (use fake timers).
//   4. onComplete fires exactly once after the full duration.
//   5. Reduced-motion: static tableau (full pot held, one note), onComplete after 2s.
//   6. Bag-held vs pot-on-bench vs pot-held visibility per stage.
//   7. Musical notes only render during brewing (and the static one in reduced-motion).
//   8. Drip stream only renders during brewing.

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
      "pourBeans",
      "setupComplete",
      "brewing",
      "ready",
      "carryOff",
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

    // Reduced-motion tableau: BeakerBot proudly holds the full pot next
    // to the machine, with one musical note suggesting the whistle.
    // The bench-mounted pot should NOT be present (he's holding it).
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-pot-held")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-notes")).toBeInTheDocument();
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-pot-bench")).toBeNull();
    // No falling beans, no drip stream in the static tableau.
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-beans")).toBeNull();
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-drip")).toBeNull();

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

  it("bag is held during walkIn + pourBeans + setupComplete, then disappears once brewing starts", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    // Stage 1 (walkIn) — bag held.
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-bag-held")).toBeInTheDocument();
    // Advance walkIn → pourBeans.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn);
    });
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-bag-held")).toBeInTheDocument();
    // Advance pourBeans → setupComplete.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.pourBeans);
    });
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-bag-held")).toBeInTheDocument();
    // Advance setupComplete → brewing — bag gone (set down).
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.setupComplete);
    });
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-bag-held")).toBeNull();
  });

  it("pot sits on the hot plate during walkIn → ready, then becomes held during carryOff", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    // Stage 1 (walkIn) — pot on hot plate, NOT held.
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-pot-bench")).toBeInTheDocument();
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-pot-held")).toBeNull();
    // Advance through walkIn + pourBeans + setupComplete + brewing.
    act(() => {
      vi.advanceTimersByTime(
        STAGE_DURATIONS.walkIn +
          STAGE_DURATIONS.pourBeans +
          STAGE_DURATIONS.setupComplete +
          STAGE_DURATIONS.brewing,
      );
    });
    // Should now be in "ready" stage — pot still on bench.
    const scene = screen.getByTestId("beakerbot-coffee-refill-scene");
    expect(scene.getAttribute("data-stage")).toBe("ready");
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-pot-bench")).toBeInTheDocument();
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-pot-held")).toBeNull();
    // Advance ready → carryOff. Pot swaps to held.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.ready);
    });
    expect(scene.getAttribute("data-stage")).toBe("carryOff");
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-pot-bench")).toBeNull();
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-pot-held")).toBeInTheDocument();
  });

  it("musical notes render only during brewing in motion mode", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    // Stage 1 (walkIn) — no notes yet.
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-notes")).toBeNull();
    // Advance walkIn → pourBeans → setupComplete. Still no notes.
    act(() => {
      vi.advanceTimersByTime(
        STAGE_DURATIONS.walkIn +
          STAGE_DURATIONS.pourBeans +
          STAGE_DURATIONS.setupComplete,
      );
    });
    const scene = screen.getByTestId("beakerbot-coffee-refill-scene");
    expect(scene.getAttribute("data-stage")).toBe("brewing");
    // Notes appear during brewing.
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-notes")).toBeInTheDocument();
    // Advance brewing → ready — notes gone.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.brewing);
    });
    expect(scene.getAttribute("data-stage")).toBe("ready");
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-notes")).toBeNull();
  });

  it("drip stream only renders during brewing", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    // walkIn — no drip.
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-drip")).toBeNull();
    // Advance to brewing.
    act(() => {
      vi.advanceTimersByTime(
        STAGE_DURATIONS.walkIn +
          STAGE_DURATIONS.pourBeans +
          STAGE_DURATIONS.setupComplete,
      );
    });
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-drip")).toBeInTheDocument();
    // Advance past brewing into ready — drip stops.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.brewing);
    });
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-drip")).toBeNull();
  });

  it("falling beans only render during pourBeans", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCoffeeRefillScene active onComplete={onComplete} />);
    // walkIn — no beans falling.
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-beans")).toBeNull();
    // Advance to pourBeans.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn);
    });
    expect(screen.getByTestId("beakerbot-coffee-refill-scene-beans")).toBeInTheDocument();
    // Advance past pourBeans — beans stop falling.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.pourBeans);
    });
    expect(screen.queryByTestId("beakerbot-coffee-refill-scene-beans")).toBeNull();
  });

  it("total duration matches sum of stage durations and is ~13s", () => {
    const sum =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.pourBeans +
      STAGE_DURATIONS.setupComplete +
      STAGE_DURATIONS.brewing +
      STAGE_DURATIONS.ready +
      STAGE_DURATIONS.carryOff;
    expect(TOTAL_DURATION_MS).toBe(sum);
    // Spec target: ~13000ms. The long brewing beat IS the gag.
    expect(TOTAL_DURATION_MS).toBe(13000);
  });
});
