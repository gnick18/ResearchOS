// frontend/src/components/__tests__/BeakerBotPipetteAimScene.test.tsx
//
// Smoke + behavior coverage for the BeakerBot PipetteAim easter-egg
// scene. Mirrors the Eureka test shape — we don't try to assert on
// individual keyframes (CSS animations aren't introspectable from jsdom
// in any useful way). Instead we cover:
//
//   1. Mount/unmount: portal at document.body when active; nothing
//      otherwise.
//   2. enterFrom drives the BeakerBot's translation direction.
//   3. Stages fire in order (use fake timers).
//   4. onComplete fires exactly once after the full duration.
//   5. Reduced-motion: static tableau, onComplete after 2s.
//   6. Plate appears from the aim stage onward.
//   7. Droplet renders only during the drop stage.
//   8. Ripple renders only during the ripple stage.
//   9. 8 sparkle elements render during the celebrate burst stage.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import BeakerBotPipetteAimScene, {
  STAGE_DURATIONS,
  STAGE_ORDER,
  TOTAL_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
} from "../BeakerBotPipetteAimScene";

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

describe("BeakerBotPipetteAimScene", () => {
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
    render(<BeakerBotPipetteAimScene active={false} onComplete={onComplete} />);
    expect(screen.queryByTestId("beakerbot-pipette-aim-scene")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("mounts via portal at document.body when active=true", () => {
    const onComplete = vi.fn();
    render(<BeakerBotPipetteAimScene active onComplete={onComplete} />);
    // The stage driver schedules the first stage at delay 0 (so the
    // setState isn't synchronous-in-effect — keeps the
    // react-hooks/set-state-in-effect lint rule happy). Flush the 0ms
    // timer to land on the actual first stage.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const scene = screen.getByTestId("beakerbot-pipette-aim-scene");
    expect(scene).toBeInTheDocument();
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-reduced-motion")).toBe("false");
    expect(scene.getAttribute("data-stage")).toBe("walkIn");
  });

  it("walks through every stage in STAGE_ORDER", () => {
    const onComplete = vi.fn();
    render(<BeakerBotPipetteAimScene active onComplete={onComplete} />);
    // Flush the 0ms first-stage timer to land on walkIn.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    const scene = screen.getByTestId("beakerbot-pipette-aim-scene");
    const observed: string[] = [scene.getAttribute("data-stage")!];

    for (let i = 0; i < STAGE_ORDER.length; i++) {
      const dur = STAGE_DURATIONS[STAGE_ORDER[i] as keyof typeof STAGE_DURATIONS];
      act(() => {
        vi.advanceTimersByTime(dur);
      });
      observed.push(scene.getAttribute("data-stage")!);
    }

    // Should have observed walkIn (initial) plus each subsequent stage
    // transition, ending at "done".
    expect(observed).toEqual([
      "walkIn",
      "aim",
      "drop",
      "ripple",
      "celebrate",
      "exit",
      "done",
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onComplete exactly once after the full duration", () => {
    const onComplete = vi.fn();
    render(<BeakerBotPipetteAimScene active onComplete={onComplete} />);
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
    render(<BeakerBotPipetteAimScene active onComplete={onComplete} />);
    // Flush the 0ms timer that flips us into the reduced-motion "done"
    // tableau.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const scene = screen.getByTestId("beakerbot-pipette-aim-scene");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");
    expect(scene.getAttribute("data-stage")).toBe("done");

    // Reduced-motion tableau includes the plate + sparkle burst as
    // part of the static "post-drop" tableau.
    expect(screen.getByTestId("beakerbot-pipette-aim-scene-plate")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-pipette-aim-scene-sparkles")).toBeInTheDocument();

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
    render(<BeakerBotPipetteAimScene active onComplete={onComplete} />);
    const bot = screen.getByTestId("beakerbot-pipette-aim-scene-bot");
    expect(bot.style.transform).toContain("-20vw");
  });

  it("enterFrom='right' translates BeakerBot from off-right instead", () => {
    const onComplete = vi.fn();
    render(
      <BeakerBotPipetteAimScene active onComplete={onComplete} enterFrom="right" />,
    );
    const bot = screen.getByTestId("beakerbot-pipette-aim-scene-bot");
    expect(bot.style.transform).toContain("120vw");
  });

  it("does not render plate during walkIn but does from aim onward", () => {
    const onComplete = vi.fn();
    render(<BeakerBotPipetteAimScene active onComplete={onComplete} />);
    // Stage 1 (walkIn) — no plate yet.
    expect(screen.queryByTestId("beakerbot-pipette-aim-scene-plate")).toBeNull();
    // Advance walkIn → aim.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn);
    });
    const scene = screen.getByTestId("beakerbot-pipette-aim-scene");
    expect(scene.getAttribute("data-stage")).toBe("aim");
    expect(screen.getByTestId("beakerbot-pipette-aim-scene-plate")).toBeInTheDocument();
  });

  it("renders the droplet only during the drop stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotPipetteAimScene active onComplete={onComplete} />);
    // Initial walkIn — no droplet.
    expect(screen.queryByTestId("beakerbot-pipette-aim-scene-droplet")).toBeNull();
    // Advance to aim — still no droplet.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn);
    });
    expect(screen.queryByTestId("beakerbot-pipette-aim-scene-droplet")).toBeNull();
    // Advance aim → drop. Droplet should render.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.aim);
    });
    const scene = screen.getByTestId("beakerbot-pipette-aim-scene");
    expect(scene.getAttribute("data-stage")).toBe("drop");
    expect(screen.getByTestId("beakerbot-pipette-aim-scene-droplet")).toBeInTheDocument();
    // Advance drop → ripple. Droplet gone.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.drop);
    });
    expect(scene.getAttribute("data-stage")).toBe("ripple");
    expect(screen.queryByTestId("beakerbot-pipette-aim-scene-droplet")).toBeNull();
  });

  it("renders the ripple only during the ripple stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotPipetteAimScene active onComplete={onComplete} />);
    // Advance through walkIn + aim + drop.
    act(() => {
      vi.advanceTimersByTime(
        STAGE_DURATIONS.walkIn + STAGE_DURATIONS.aim + STAGE_DURATIONS.drop,
      );
    });
    const scene = screen.getByTestId("beakerbot-pipette-aim-scene");
    expect(scene.getAttribute("data-stage")).toBe("ripple");
    expect(screen.getByTestId("beakerbot-pipette-aim-scene-ripple")).toBeInTheDocument();
    // Advance ripple → celebrate. Ripple gone.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.ripple);
    });
    expect(scene.getAttribute("data-stage")).toBe("celebrate");
    expect(screen.queryByTestId("beakerbot-pipette-aim-scene-ripple")).toBeNull();
  });

  it("renders exactly 8 sparkle particles during the celebrate stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotPipetteAimScene active onComplete={onComplete} />);
    // Advance to the celebrate stage.
    const preCelebrateMs =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.aim +
      STAGE_DURATIONS.drop +
      STAGE_DURATIONS.ripple;
    act(() => {
      vi.advanceTimersByTime(preCelebrateMs);
    });
    const scene = screen.getByTestId("beakerbot-pipette-aim-scene");
    expect(scene.getAttribute("data-stage")).toBe("celebrate");
    // 8 sparkle particles in the inlined celebrate-stage burst (each
    // rendered under the `beakerbot-burst-particle` testid).
    const sparkles = screen.getAllByTestId("beakerbot-burst-particle");
    expect(sparkles).toHaveLength(8);
  });

  it("does not double-fire onComplete when parent re-renders with a new callback identity", () => {
    // Same foot-gun guarded by the other scenes — ref-cached onComplete
    // so re-renders don't reset the timer chain.
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();
    const { rerender } = render(
      <BeakerBotPipetteAimScene active onComplete={onCompleteA} />,
    );
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    rerender(<BeakerBotPipetteAimScene active onComplete={onCompleteB} />);
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS);
    });
    // Final callback wins (the one held in the ref at fire-time).
    expect(onCompleteA).not.toHaveBeenCalled();
    expect(onCompleteB).toHaveBeenCalledTimes(1);
  });
});
