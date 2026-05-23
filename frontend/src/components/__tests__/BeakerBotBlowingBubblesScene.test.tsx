// frontend/src/components/__tests__/BeakerBotBlowingBubblesScene.test.tsx
//
// Smoke + behavior coverage for the BeakerBot BlowingBubbles scene.
// Mirrors the structure of the sibling scene tests (Eureka, BugStomp,
// Ladder). Covers:
//
//   1. Mount/unmount via portal.
//   2. enterFrom drives the BeakerBot's initial translation.
//   3. Stages fire in STAGE_ORDER, ending at "done" with onComplete.
//   4. onComplete fires exactly once after the full duration.
//   5. Reduced-motion: static tableau, onComplete after 2s.
//   6. Wand renders in every motion stage (he carries it in + out).
//   7. Bubble spawner emits bubbles during the blowing stage.
//   8. Bubbles wear `pointer-events: auto` so they're clickable.
//   9. Clicking a bubble pops it (data-popping flips to true).
//  10. ref-cached onComplete: parent re-render with a new callback
//      identity does NOT cause a double-fire.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import BeakerBotBlowingBubblesScene, {
  STAGE_DURATIONS,
  STAGE_ORDER,
  TOTAL_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
} from "../BeakerBotBlowingBubblesScene";

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

// requestAnimationFrame shim — vitest fake-timers don't drive rAF, so
// we stub it out as setTimeout(16). The bubble physics loop reads the
// latest state via the setter callback, so a single tick is enough to
// verify spawn/pop behavior without integrating exact positions.
function installRaf() {
  Object.defineProperty(window, "requestAnimationFrame", {
    writable: true,
    configurable: true,
    value: (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 16) as unknown as number,
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    writable: true,
    configurable: true,
    value: (id: number) => {
      window.clearTimeout(id);
    },
  });
}

describe("BeakerBotBlowingBubblesScene", () => {
  beforeEach(() => {
    mqState.matches = false;
    installMatchMedia();
    installRaf();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders nothing when active=false", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBlowingBubblesScene active={false} onComplete={onComplete} />);
    expect(screen.queryByTestId("beakerbot-blowing-bubbles-scene")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("mounts via portal at document.body when active=true", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBlowingBubblesScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-blowing-bubbles-scene");
    expect(scene).toBeInTheDocument();
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-reduced-motion")).toBe("false");
    expect(scene.getAttribute("data-stage")).toBe("walkIn");
  });

  it("walks through every stage in STAGE_ORDER and ends with onComplete", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBlowingBubblesScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-blowing-bubbles-scene");
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
      "settle",
      "blowing",
      "settleDone",
      "exit",
      "done",
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onComplete exactly once after the full duration", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBlowingBubblesScene active onComplete={onComplete} />);
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
    render(<BeakerBotBlowingBubblesScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-blowing-bubbles-scene");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");
    expect(scene.getAttribute("data-stage")).toBe("done");

    // Reduced-motion tableau includes the bot, the wand, and the
    // bubble layer (with 4 static bubbles).
    expect(
      screen.getByTestId("beakerbot-blowing-bubbles-scene-bot"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("beakerbot-blowing-bubbles-scene-wand"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("beakerbot-blowing-bubbles-scene-bubble-layer"),
    ).toBeInTheDocument();
    const tableauBubbles = screen.getAllByTestId(
      "beakerbot-blowing-bubbles-scene-bubble",
    );
    expect(tableauBubbles.length).toBe(4);

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
    render(<BeakerBotBlowingBubblesScene active onComplete={onComplete} />);
    const bot = screen.getByTestId("beakerbot-blowing-bubbles-scene-bot");
    expect(bot.style.transform).toContain("120vw");
  });

  it("enterFrom='left' translates BeakerBot from off-left instead", () => {
    const onComplete = vi.fn();
    render(
      <BeakerBotBlowingBubblesScene
        active
        onComplete={onComplete}
        enterFrom="left"
      />,
    );
    const bot = screen.getByTestId("beakerbot-blowing-bubbles-scene-bot");
    expect(bot.style.transform).toContain("-20vw");
  });

  it("renders the wand at every motion stage (he carries it in + out)", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBlowingBubblesScene active onComplete={onComplete} />);
    // walkIn — wand visible.
    expect(
      screen.getByTestId("beakerbot-blowing-bubbles-scene-wand"),
    ).toBeInTheDocument();
    // Advance to blowing stage.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn + STAGE_DURATIONS.settle);
    });
    expect(
      screen.getByTestId("beakerbot-blowing-bubbles-scene-wand"),
    ).toBeInTheDocument();
    // Advance to settleDone — wand still there (raised).
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.blowing);
    });
    expect(
      screen.getByTestId("beakerbot-blowing-bubbles-scene-wand"),
    ).toBeInTheDocument();
    // Advance to exit — wand still there.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.settleDone);
    });
    expect(
      screen.getByTestId("beakerbot-blowing-bubbles-scene-wand"),
    ).toBeInTheDocument();
  });

  it("spawns bubbles during the blowing stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBlowingBubblesScene active onComplete={onComplete} />);
    // Pre-blowing: no bubbles.
    expect(
      screen.queryByTestId("beakerbot-blowing-bubbles-scene-bubble-layer"),
    ).toBeNull();

    // Advance walkIn + settle → blowing stage. Spawner fires
    // immediately on entering blowing.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn + STAGE_DURATIONS.settle);
    });
    const scene = screen.getByTestId("beakerbot-blowing-bubbles-scene");
    expect(scene.getAttribute("data-stage")).toBe("blowing");
    // Bubble layer present + has at least one bubble.
    expect(
      screen.getByTestId("beakerbot-blowing-bubbles-scene-bubble-layer"),
    ).toBeInTheDocument();
    const bubbles = screen.getAllByTestId(
      "beakerbot-blowing-bubbles-scene-bubble",
    );
    expect(bubbles.length).toBeGreaterThanOrEqual(1);
  });

  it("bubbles render with pointer-events: auto so they're clickable", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBlowingBubblesScene active onComplete={onComplete} />);
    // Enter blowing stage so a bubble exists.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn + STAGE_DURATIONS.settle);
    });
    const bubbles = screen.getAllByTestId(
      "beakerbot-blowing-bubbles-scene-bubble",
    );
    expect(bubbles.length).toBeGreaterThanOrEqual(1);
    const first = bubbles[0]! as unknown as SVGGElement;
    // Scene wrapper is pointer-events: none; the bubble overrides to
    // auto so it's interactive.
    expect(first.style.pointerEvents).toBe("auto");
    expect(first.style.cursor).toBe("pointer");
  });

  it("clicking a bubble pops it (data-popping flips to true)", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBlowingBubblesScene active onComplete={onComplete} />);
    // Enter blowing stage.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn + STAGE_DURATIONS.settle);
    });
    const bubbles = screen.getAllByTestId(
      "beakerbot-blowing-bubbles-scene-bubble",
    );
    const first = bubbles[0]!;
    const bubbleId = first.getAttribute("data-bubble-id");
    expect(first.getAttribute("data-popping")).toBe("false");
    // Click to pop.
    act(() => {
      fireEvent.click(first);
    });
    // After click, the bubble with that id should be popping.
    const sameBubbleById = document.querySelector(
      `[data-bubble-id="${bubbleId}"]`,
    );
    expect(sameBubbleById?.getAttribute("data-popping")).toBe("true");
  });

  it("does not double-fire onComplete when parent re-renders with a new callback identity", () => {
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();
    const { rerender } = render(
      <BeakerBotBlowingBubblesScene active onComplete={onCompleteA} />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender(
      <BeakerBotBlowingBubblesScene active onComplete={onCompleteB} />,
    );
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS);
    });
    expect(onCompleteA).not.toHaveBeenCalled();
    expect(onCompleteB).toHaveBeenCalledTimes(1);
  });
});
