// frontend/src/components/__tests__/BeakerBotMicroscopeBubbleScene.test.tsx
//
// Smoke + behavior coverage for the BeakerBot MicroscopeBubble scene.
// Mirrors the structure of the sibling scene tests (Eureka, BugStomp,
// Ladder). Covers:
//
//   1. Mount/unmount via portal.
//   2. enterFrom drives the BeakerBot's initial translation.
//   3. Stages fire in STAGE_ORDER, ending at "done" with onComplete.
//   4. onComplete fires exactly once after the full duration.
//   5. Reduced-motion: static tableau, onComplete after 2s.
//   6. Microscope appears from the peek stage onward (not during walkIn).
//   7. Big bubble + tiny inner BeakerBot appear during bubbleRise + pop.
//   8. "pop!" speech bubble renders during the pop stage only.
//   9. ref-cached onComplete: parent re-render with a new callback
//      identity does NOT cause a double-fire.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import BeakerBotMicroscopeBubbleScene, {
  STAGE_DURATIONS,
  STAGE_ORDER,
  TOTAL_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
} from "../BeakerBotMicroscopeBubbleScene";

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

describe("BeakerBotMicroscopeBubbleScene", () => {
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
    render(<BeakerBotMicroscopeBubbleScene active={false} onComplete={onComplete} />);
    expect(screen.queryByTestId("beakerbot-microscope-bubble-scene")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("mounts via portal at document.body when active=true", () => {
    const onComplete = vi.fn();
    render(<BeakerBotMicroscopeBubbleScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-microscope-bubble-scene");
    expect(scene).toBeInTheDocument();
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-reduced-motion")).toBe("false");
    expect(scene.getAttribute("data-stage")).toBe("walkIn");
  });

  it("walks through every stage in STAGE_ORDER and ends with onComplete", () => {
    const onComplete = vi.fn();
    render(<BeakerBotMicroscopeBubbleScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-microscope-bubble-scene");
    const observed: string[] = [scene.getAttribute("data-stage")!];

    for (let i = 0; i < STAGE_ORDER.length; i++) {
      const dur = STAGE_DURATIONS[STAGE_ORDER[i] as keyof typeof STAGE_DURATIONS];
      act(() => {
        vi.advanceTimersByTime(dur);
      });
      observed.push(scene.getAttribute("data-stage")!);
    }

    expect(observed).toEqual([
      "walkIn",
      "peek",
      "glow",
      "bubbleRise",
      "pop",
      "reaction",
      "done",
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onComplete exactly once after the full duration", () => {
    const onComplete = vi.fn();
    render(<BeakerBotMicroscopeBubbleScene active onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS - 100);
    });
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("renders static tableau under prefers-reduced-motion and fires onComplete after 2s", () => {
    mqState.matches = true;
    const onComplete = vi.fn();
    render(<BeakerBotMicroscopeBubbleScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-microscope-bubble-scene");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");
    expect(scene.getAttribute("data-stage")).toBe("done");

    // Reduced-motion tableau includes the microscope + big bubble +
    // eyepiece glow visible from the start (static).
    expect(
      screen.getByTestId("beakerbot-microscope-bubble-scene-microscope"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("beakerbot-microscope-bubble-scene-bubble"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("beakerbot-microscope-bubble-scene-eyepiece-glow"),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(REDUCED_MOTION_DURATION_MS - 100);
    });
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("enterFrom='right' (default) translates BeakerBot from off-right", () => {
    const onComplete = vi.fn();
    render(<BeakerBotMicroscopeBubbleScene active onComplete={onComplete} />);
    const bot = screen.getByTestId("beakerbot-microscope-bubble-scene-bot");
    expect(bot.style.transform).toContain("120vw");
  });

  it("enterFrom='left' translates BeakerBot from off-left instead", () => {
    const onComplete = vi.fn();
    render(
      <BeakerBotMicroscopeBubbleScene
        active
        onComplete={onComplete}
        enterFrom="left"
      />,
    );
    const bot = screen.getByTestId("beakerbot-microscope-bubble-scene-bot");
    expect(bot.style.transform).toContain("-20vw");
  });

  it("does not render the microscope during walkIn (only from peek onward)", () => {
    const onComplete = vi.fn();
    render(<BeakerBotMicroscopeBubbleScene active onComplete={onComplete} />);
    // Stage 1 (walkIn) — no microscope yet.
    expect(
      screen.queryByTestId("beakerbot-microscope-bubble-scene-microscope"),
    ).toBeNull();
    // Advance walkIn → peek.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn);
    });
    const scene = screen.getByTestId("beakerbot-microscope-bubble-scene");
    expect(scene.getAttribute("data-stage")).toBe("peek");
    expect(
      screen.getByTestId("beakerbot-microscope-bubble-scene-microscope"),
    ).toBeInTheDocument();
  });

  it("renders the big bubble + tiny inner BeakerBot during bubbleRise + pop", () => {
    const onComplete = vi.fn();
    render(<BeakerBotMicroscopeBubbleScene active onComplete={onComplete} />);
    // Pre-bubbleRise stages — no bubble yet.
    expect(
      screen.queryByTestId("beakerbot-microscope-bubble-scene-bubble"),
    ).toBeNull();
    expect(
      screen.queryByTestId("beakerbot-microscope-bubble-scene-tiny-bot"),
    ).toBeNull();
    // Advance through walkIn + peek + glow → bubbleRise.
    const preBubbleMs =
      STAGE_DURATIONS.walkIn + STAGE_DURATIONS.peek + STAGE_DURATIONS.glow;
    act(() => {
      vi.advanceTimersByTime(preBubbleMs);
    });
    const scene = screen.getByTestId("beakerbot-microscope-bubble-scene");
    expect(scene.getAttribute("data-stage")).toBe("bubbleRise");
    expect(
      screen.getByTestId("beakerbot-microscope-bubble-scene-bubble"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("beakerbot-microscope-bubble-scene-tiny-bot"),
    ).toBeInTheDocument();

    // Advance bubbleRise → pop. Bubble + tiny bot still present.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.bubbleRise);
    });
    expect(scene.getAttribute("data-stage")).toBe("pop");
    expect(
      screen.getByTestId("beakerbot-microscope-bubble-scene-bubble"),
    ).toBeInTheDocument();

    // Advance pop → reaction. Bubble gone now.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.pop);
    });
    expect(scene.getAttribute("data-stage")).toBe("reaction");
    expect(
      screen.queryByTestId("beakerbot-microscope-bubble-scene-bubble"),
    ).toBeNull();
  });

  it("renders the 'pop!' speech bubble only during the pop stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotMicroscopeBubbleScene active onComplete={onComplete} />);
    expect(
      screen.queryByTestId("beakerbot-microscope-bubble-scene-pop-bubble"),
    ).toBeNull();
    // Advance to pop.
    const prePopMs =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.peek +
      STAGE_DURATIONS.glow +
      STAGE_DURATIONS.bubbleRise;
    act(() => {
      vi.advanceTimersByTime(prePopMs);
    });
    const scene = screen.getByTestId("beakerbot-microscope-bubble-scene");
    expect(scene.getAttribute("data-stage")).toBe("pop");
    const popBubble = screen.getByTestId(
      "beakerbot-microscope-bubble-scene-pop-bubble",
    );
    expect(popBubble).toBeInTheDocument();
    expect(popBubble.textContent).toContain("pop!");
    // Advance past pop → reaction. Pop bubble gone.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.pop);
    });
    expect(scene.getAttribute("data-stage")).toBe("reaction");
    expect(
      screen.queryByTestId("beakerbot-microscope-bubble-scene-pop-bubble"),
    ).toBeNull();
  });

  it("does not double-fire onComplete when parent re-renders with a new callback identity", () => {
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();
    const { rerender } = render(
      <BeakerBotMicroscopeBubbleScene active onComplete={onCompleteA} />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender(
      <BeakerBotMicroscopeBubbleScene active onComplete={onCompleteB} />,
    );
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS);
    });
    expect(onCompleteA).not.toHaveBeenCalled();
    expect(onCompleteB).toHaveBeenCalledTimes(1);
  });
});
