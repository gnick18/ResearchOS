// Component-level RTL tests for <BeakerBotMouseWaveScene />.
// Covers: portal mount under document.body, the three-stage schedule
// (turn -> wave -> settle -> onComplete), reduced-motion fallback
// (static hold, onComplete after 1500ms, no keyframes attached),
// facing-direction computation based on targetX vs anchor position,
// and the default-to-viewport-center behavior when targetX/targetY are
// omitted.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import BeakerBotMouseWaveScene from "../BeakerBotMouseWaveScene";

// Every test runs under vitest fake timers because the scene is
// timer-driven. Real timers would force 2s of wall-clock per test which
// adds up across the matrix.
beforeEach(() => {
  vi.useFakeTimers();
  // Pin a known viewport size so facing-direction math is deterministic
  // across tests. innerWidth/innerHeight are writable in jsdom.
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(window, "innerHeight", {
    writable: true,
    configurable: true,
    value: 800,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Default-stub `window.matchMedia` to either reduced-motion on or off.
 *  jsdom 27 has no matchMedia implementation, so each test that cares
 *  installs its own stub before render. */
function stubMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("reduce") ? reduced : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe("<BeakerBotMouseWaveScene />", () => {
  it("renders nothing when active=false", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotMouseWaveScene active={false} onComplete={onComplete} />,
    );
    expect(
      screen.queryByTestId("beakerbot-mouse-wave-scene"),
    ).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("portals into document.body when active=true", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    render(<BeakerBotMouseWaveScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-mouse-wave-scene");
    expect(scene).toBeInTheDocument();
    // The scene root is a direct child of document.body, not nested
    // under the RTL container div.
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-reduced-motion")).toBe("false");
  });

  it("progresses through turn -> wave -> settle and fires onComplete at ~2000ms", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    render(<BeakerBotMouseWaveScene active onComplete={onComplete} />);

    const scene = () =>
      screen.getByTestId("beakerbot-mouse-wave-scene") as HTMLElement;

    // Initial stage right after mount is "turn".
    // (The opening setStage("turn") is scheduled at 0ms, so we advance
    // a tick to let it settle.)
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(scene().getAttribute("data-stage")).toBe("turn");

    // After 200ms -> wave.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(scene().getAttribute("data-stage")).toBe("wave");

    // After +1500ms -> settle.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(scene().getAttribute("data-stage")).toBe("settle");

    // onComplete still has not fired during settle.
    expect(onComplete).not.toHaveBeenCalled();

    // After +300ms -> onComplete fires exactly once.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("computes facing='right' when targetX is right of the anchor", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    // Default anchor is bottom-right (at x ~= 1000 - 24 - 48 = 928).
    // Use a left-leaning anchor so the test target can be clearly to
    // the RIGHT of the anchor center without exceeding viewport width.
    render(
      <BeakerBotMouseWaveScene
        active
        onComplete={onComplete}
        beakerBotAnchor="bottom-left"
        targetX={500}
        targetY={400}
      />,
    );
    // Anchor (bottom-left) center-x is 24 + 48 = 72. targetX=500 is
    // well to the right of 72, so facing should resolve to "right".
    const scene = screen.getByTestId("beakerbot-mouse-wave-scene");
    expect(scene.getAttribute("data-facing")).toBe("right");
  });

  it("computes facing='left' when targetX is left of the anchor", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    // bottom-right anchor center-x ~= 1000 - 24 - 48 = 928. targetX=100
    // is clearly to the left of that, so facing should be "left".
    render(
      <BeakerBotMouseWaveScene
        active
        onComplete={onComplete}
        beakerBotAnchor="bottom-right"
        targetX={100}
        targetY={400}
      />,
    );
    const scene = screen.getByTestId("beakerbot-mouse-wave-scene");
    expect(scene.getAttribute("data-facing")).toBe("left");
  });

  it("defaults targetX/targetY to viewport center when omitted", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    // Viewport is 1000x800 (pinned in beforeEach). Center is (500, 400).
    // With bottom-right anchor (center-x ~928), center-x=500 is to the
    // LEFT -> facing should be "left".
    render(
      <BeakerBotMouseWaveScene
        active
        onComplete={onComplete}
        beakerBotAnchor="bottom-right"
      />,
    );
    const scene = screen.getByTestId("beakerbot-mouse-wave-scene");
    expect(scene.getAttribute("data-facing")).toBe("left");

    // Mirror check: bottom-left anchor (center-x ~72), center-x=500 is
    // to the RIGHT -> facing should be "right".
    // Re-render not strictly required; just confirm the math is
    // symmetric by mounting a second instance.
    render(
      <BeakerBotMouseWaveScene
        active
        onComplete={onComplete}
        beakerBotAnchor="bottom-left"
      />,
    );
    const scenes = screen.getAllByTestId("beakerbot-mouse-wave-scene");
    // The second scene is the bottom-left one (RTL appends).
    expect(scenes[scenes.length - 1].getAttribute("data-facing")).toBe(
      "right",
    );
  });

  it("reduced-motion: static hold for 1500ms then onComplete, no keyframes attached", () => {
    stubMatchMedia(true);
    const onComplete = vi.fn();
    render(<BeakerBotMouseWaveScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-mouse-wave-scene");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");

    // Inner bot wrapper should have no `animation` style applied in
    // reduced-motion mode (motion mode would set wave-pulse here).
    const bot = screen.getByTestId(
      "beakerbot-mouse-wave-scene-bot",
    ) as HTMLElement;
    expect(bot.style.animation).toBe("");

    // Reduced-motion path: setStage("turn") then immediately
    // setStage("wave"). After a tick the stage should be "wave".
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(scene.getAttribute("data-stage")).toBe("wave");

    // Less than 1500ms in -> still waiting.
    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(onComplete).not.toHaveBeenCalled();

    // At 1500ms -> onComplete fires exactly once.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Stage never advances past "done" (and never through "settle")
    // in reduced-motion mode.
    expect(scene.getAttribute("data-stage")).toBe("done");
  });

  it("does not fire onComplete if active flips false mid-scene", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    const { rerender } = render(
      <BeakerBotMouseWaveScene active onComplete={onComplete} />,
    );

    // Advance partway through the wave, then deactivate.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender(
      <BeakerBotMouseWaveScene active={false} onComplete={onComplete} />,
    );

    // Run all pending timers. The scheduler's cleanup should have torn
    // them all down, so onComplete must not fire.
    act(() => {
      vi.runAllTimers();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("calls onComplete only once even if the parent re-renders with a fresh callback identity", () => {
    // Common foot-gun: parent passes an inline arrow each render. The
    // timer effect re-binds and could fire onComplete on the previous
    // callback. We use a ref internally; verify the final callback
    // wins and the earlier ones never fire.
    stubMatchMedia(false);
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();
    const { rerender } = render(
      <BeakerBotMouseWaveScene active onComplete={onCompleteA} />,
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender(
      <BeakerBotMouseWaveScene active onComplete={onCompleteB} />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onCompleteA).not.toHaveBeenCalled();
    expect(onCompleteB).toHaveBeenCalledTimes(1);
  });

  it("renders a speech bubble by default during wave, hides it when showSpeechBubble=false", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    const { rerender } = render(
      <BeakerBotMouseWaveScene active onComplete={onComplete} />,
    );

    // Advance past the turn stage into the wave so the bubble mounts.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(
      screen.queryByTestId("beakerbot-mouse-wave-scene-bubble"),
    ).toBeInTheDocument();

    // Reset and re-render with showSpeechBubble=false. The bubble must
    // never render in this configuration.
    rerender(
      <BeakerBotMouseWaveScene
        active={false}
        onComplete={onComplete}
        showSpeechBubble={false}
      />,
    );
    rerender(
      <BeakerBotMouseWaveScene
        active
        onComplete={onComplete}
        showSpeechBubble={false}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(
      screen.queryByTestId("beakerbot-mouse-wave-scene-bubble"),
    ).toBeNull();
  });

  it("works when onComplete is omitted entirely (optional prop)", () => {
    stubMatchMedia(false);
    // No onComplete passed. The scene should still mount, run through
    // its full duration, and not throw at the completion step.
    render(<BeakerBotMouseWaveScene active />);
    expect(
      screen.getByTestId("beakerbot-mouse-wave-scene"),
    ).toBeInTheDocument();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(2500);
      });
    }).not.toThrow();
  });
});
