// frontend/src/components/__tests__/BeakerBotEurekaScene.test.tsx
//
// Smoke + behavior coverage for the BeakerBot Eureka easter-egg scene.
// We don't try to assert on each individual keyframe (CSS animations
// are not introspectable from jsdom in any useful way) — instead we
// cover:
//
//   1. Mount/unmount: portal at document.body when active; nothing otherwise.
//   2. enterFrom drives the BeakerBot's translation direction.
//   3. Stages fire in order (use fake timers).
//   4. onComplete fires exactly once after the full duration.
//   5. Reduced-motion: static tableau, onComplete after 2s.
//   6. Light bulb appears in stages 6+ but not 1-5.
//   7. 8 sparkle elements render during the burst stage.
//   8. "Eureka!" speech bubble renders during cheering stage only.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import BeakerBotEurekaScene, {
  STAGE_DURATIONS,
  STAGE_ORDER,
  TOTAL_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
} from "../BeakerBotEurekaScene";

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

describe("BeakerBotEurekaScene", () => {
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
    render(<BeakerBotEurekaScene active={false} onComplete={onComplete} />);
    expect(screen.queryByTestId("beakerbot-eureka-scene")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("mounts via portal at document.body when active=true", () => {
    const onComplete = vi.fn();
    render(<BeakerBotEurekaScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-eureka-scene");
    expect(scene).toBeInTheDocument();
    // Portal sanity: scene element is a direct child of document.body.
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-reduced-motion")).toBe("false");
    // First stage should be "walkIn".
    expect(scene.getAttribute("data-stage")).toBe("walkIn");
  });

  it("walks through every stage in STAGE_ORDER", () => {
    const onComplete = vi.fn();
    render(<BeakerBotEurekaScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-eureka-scene");
    const observed: string[] = [scene.getAttribute("data-stage")!];

    for (let i = 0; i < STAGE_ORDER.length; i++) {
      const dur = STAGE_DURATIONS[STAGE_ORDER[i] as keyof typeof STAGE_DURATIONS];
      act(() => {
        vi.advanceTimersByTime(dur);
      });
      observed.push(scene.getAttribute("data-stage")!);
    }

    // Should have observed walkIn (initial) plus each subsequent stage
    // transition, ending at "done". The recorded sequence is:
    //   [walkIn, setDown, leanPeek, peeking, pullBack, bulbOn,
    //    sparkles, cheering, scan, exit, done]
    // (`scan` is the L→R→L head-turn over the bulb, between cheering
    // and exit, so the user can see the whole bulb.)
    expect(observed).toEqual([
      "walkIn",
      "setDown",
      "leanPeek",
      "peeking",
      "pullBack",
      "bulbOn",
      "sparkles",
      "cheering",
      "scan",
      "exit",
      "done",
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onComplete exactly once after the full duration", () => {
    const onComplete = vi.fn();
    render(<BeakerBotEurekaScene active onComplete={onComplete} />);
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
    render(<BeakerBotEurekaScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-eureka-scene");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");
    expect(scene.getAttribute("data-stage")).toBe("done");

    // Reduced-motion tableau includes microscope, lightbulb, and
    // sparkles — visible from the start (static).
    expect(screen.getByTestId("beakerbot-eureka-scene-microscope")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-eureka-scene-lightbulb")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-eureka-scene-sparkle-burst")).toBeInTheDocument();

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

  it("enterFrom='right' (default) translates BeakerBot from off-right", () => {
    const onComplete = vi.fn();
    render(<BeakerBotEurekaScene active onComplete={onComplete} />);
    const bot = screen.getByTestId("beakerbot-eureka-scene-bot");
    // Default enterFrom="right" — start position is 120vw (off the right).
    expect(bot.style.transform).toContain("120vw");
  });

  it("enterFrom='left' translates BeakerBot from off-left instead", () => {
    const onComplete = vi.fn();
    render(<BeakerBotEurekaScene active onComplete={onComplete} enterFrom="left" />);
    const bot = screen.getByTestId("beakerbot-eureka-scene-bot");
    // enterFrom="left" — start position is -20vw (off the left).
    expect(bot.style.transform).toContain("-20vw");
  });

  it("does not render light bulb during early stages (walkIn → pullBack)", () => {
    const onComplete = vi.fn();
    render(<BeakerBotEurekaScene active onComplete={onComplete} />);
    // Stage 1 (walkIn) — no bulb yet.
    expect(screen.queryByTestId("beakerbot-eureka-scene-lightbulb")).toBeNull();
    // Advance through walkIn + setDown + leanPeek + peeking + pullBack.
    act(() => {
      vi.advanceTimersByTime(
        STAGE_DURATIONS.walkIn +
          STAGE_DURATIONS.setDown +
          STAGE_DURATIONS.leanPeek +
          STAGE_DURATIONS.peeking,
      );
    });
    // Now at "pullBack" — still no bulb.
    const sceneMid = screen.getByTestId("beakerbot-eureka-scene");
    expect(sceneMid.getAttribute("data-stage")).toBe("pullBack");
    expect(screen.queryByTestId("beakerbot-eureka-scene-lightbulb")).toBeNull();
    // Advance pullBack → bulbOn.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.pullBack);
    });
    expect(sceneMid.getAttribute("data-stage")).toBe("bulbOn");
    expect(screen.getByTestId("beakerbot-eureka-scene-lightbulb")).toBeInTheDocument();
  });

  it("renders exactly 8 sparkle elements during the sparkles burst stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotEurekaScene active onComplete={onComplete} />);
    // Advance to the sparkles stage.
    const preSparkleMs =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.setDown +
      STAGE_DURATIONS.leanPeek +
      STAGE_DURATIONS.peeking +
      STAGE_DURATIONS.pullBack +
      STAGE_DURATIONS.bulbOn;
    act(() => {
      vi.advanceTimersByTime(preSparkleMs);
    });
    const scene = screen.getByTestId("beakerbot-eureka-scene");
    expect(scene.getAttribute("data-stage")).toBe("sparkles");
    const sparkles = screen.getAllByTestId("beakerbot-eureka-scene-sparkle");
    expect(sparkles).toHaveLength(8);
  });

  it("renders the Eureka! speech bubble only during the cheering stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotEurekaScene active onComplete={onComplete} />);
    // Initial stage — no bubble.
    expect(screen.queryByTestId("beakerbot-eureka-scene-bubble")).toBeNull();
    // Advance to cheering.
    const preCheerMs =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.setDown +
      STAGE_DURATIONS.leanPeek +
      STAGE_DURATIONS.peeking +
      STAGE_DURATIONS.pullBack +
      STAGE_DURATIONS.bulbOn +
      STAGE_DURATIONS.sparkles;
    act(() => {
      vi.advanceTimersByTime(preCheerMs);
    });
    const scene = screen.getByTestId("beakerbot-eureka-scene");
    expect(scene.getAttribute("data-stage")).toBe("cheering");
    const bubble = screen.getByTestId("beakerbot-eureka-scene-bubble");
    expect(bubble).toBeInTheDocument();
    expect(bubble.textContent).toContain("Eureka!");
    // Advance past cheering → scan (head-turn over the bulb). Bubble
    // should be gone. (`scan` was added between `cheering` and `exit`
    // so the user can see the whole bulb before BeakerBot leaves.)
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.cheering);
    });
    expect(scene.getAttribute("data-stage")).toBe("scan");
    expect(screen.queryByTestId("beakerbot-eureka-scene-bubble")).toBeNull();
  });

  it("enters the `scan` head-turn stage between cheering and exit, with bulb still visible", () => {
    const onComplete = vi.fn();
    render(<BeakerBotEurekaScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-eureka-scene");

    // Advance to scan: walkIn + setDown + leanPeek + peeking + pullBack
    // + bulbOn + sparkles + cheering.
    const preScanMs =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.setDown +
      STAGE_DURATIONS.leanPeek +
      STAGE_DURATIONS.peeking +
      STAGE_DURATIONS.pullBack +
      STAGE_DURATIONS.bulbOn +
      STAGE_DURATIONS.sparkles +
      STAGE_DURATIONS.cheering;
    act(() => {
      vi.advanceTimersByTime(preScanMs);
    });
    expect(scene.getAttribute("data-stage")).toBe("scan");
    // Bulb must still be visible during scan — that's the whole point.
    expect(screen.getByTestId("beakerbot-eureka-scene-lightbulb")).toBeInTheDocument();
    // Microscope still on the bench during scan too.
    expect(screen.getByTestId("beakerbot-eureka-scene-microscope")).toBeInTheDocument();

    // Advancing scan duration moves us to exit.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.scan);
    });
    expect(scene.getAttribute("data-stage")).toBe("exit");
  });

  it("does not double-fire onComplete when parent re-renders with a new callback identity", () => {
    // Same foot-gun guarded by BugStompScene + LadderScene — ref-cached
    // onComplete so re-renders don't reset the timer chain.
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();
    const { rerender } = render(<BeakerBotEurekaScene active onComplete={onCompleteA} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender(<BeakerBotEurekaScene active onComplete={onCompleteB} />);
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS);
    });
    // Final callback wins (the one held in the ref at fire-time).
    expect(onCompleteA).not.toHaveBeenCalled();
    expect(onCompleteB).toHaveBeenCalledTimes(1);
  });
});
