// Component-level RTL tests for <BeakerBotScreenBumpScene />.
// Covers: portal mount under document.body, the five-stage animation
// schedule (drift-in → bonk → reaction → recovery → drift-out →
// onComplete), reduced-motion fallback (static hold + onComplete after
// ~2s), edge-direction configurability (left/right/top/bottom), and
// cleanup when `active` flips back to false mid-scene.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import BeakerBotScreenBumpScene from "../BeakerBotScreenBumpScene";

// All scenes are timer-driven, so every test runs under vitest's fake
// timers. Real timers would force ~3s of wall-clock per test which is
// untenable for CI.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Default-stub `window.matchMedia` to "no match" (motion enabled).
 *  Individual tests that exercise the reduced-motion path install
 *  their own stub before render. */
function stubMatchMedia(reduced: boolean) {
  // jsdom 27 lacks matchMedia. Define-property at the test-level
  // boundary so the component's one-shot mount detection sees the
  // expected value.
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

describe("<BeakerBotScreenBumpScene />", () => {
  it("does not render anything when active=false", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotScreenBumpScene active={false} onComplete={onComplete} />,
    );
    expect(screen.queryByTestId("beakerbot-bump-scene")).toBeNull();
  });

  it("mounts a portal under document.body when active=true", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    render(<BeakerBotScreenBumpScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-bump-scene");
    expect(scene).toBeInTheDocument();
    // The portal target is document.body — confirm the scene is a
    // direct descendant rather than inside the testing-library
    // <div id="root">.
    expect(scene.parentElement).toBe(document.body);
  });

  it("steps through all five stages and fires onComplete at ~3s", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    render(<BeakerBotScreenBumpScene active onComplete={onComplete} />);

    const inner = () =>
      screen
        .getByTestId("beakerbot-bump-scene")
        .querySelector("[data-stage]") as HTMLElement | null;

    // Initial mount → drift-in.
    expect(inner()?.dataset.stage).toBe("drift-in");

    // After 1000ms → bonk.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(inner()?.dataset.stage).toBe("bonk");

    // After +200ms → reaction.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(inner()?.dataset.stage).toBe("reaction");

    // After +700ms → recovery.
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(inner()?.dataset.stage).toBe("recovery");

    // After +600ms → drift-out.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(inner()?.dataset.stage).toBe("drift-out");

    // After +500ms → onComplete fires.
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("shows impact sparkles during bonk + reaction", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    render(<BeakerBotScreenBumpScene active onComplete={onComplete} />);

    // Sparkles container is always rendered (so the fade transition
    // has something to animate); we check its opacity to confirm
    // visibility.
    const sparkles = () =>
      screen.getByTestId("beakerbot-bump-sparkles") as HTMLElement;
    expect(sparkles().style.opacity).toBe("0");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Bonk stage → sparkles visible.
    expect(sparkles().style.opacity).toBe("1");

    // Reaction begins at +200ms; sparkles start fading 100ms into
    // reaction, so advance well past that.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(sparkles().style.opacity).toBe("0");
  });

  it("fires onComplete after ~2s in reduced-motion mode (no stage chain)", () => {
    stubMatchMedia(true);
    const onComplete = vi.fn();
    render(<BeakerBotScreenBumpScene active onComplete={onComplete} />);

    const inner = () =>
      screen
        .getByTestId("beakerbot-bump-scene")
        .querySelector("[data-stage]") as HTMLElement | null;

    // Reduced-motion path jumps straight to a static "reaction" pose.
    expect(inner()?.dataset.stage).toBe("reaction");

    // Less than 2s → still mounted, no onComplete yet.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onComplete).not.toHaveBeenCalled();

    // At 2s → onComplete fires once.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Stage never advances past reaction in reduced-motion mode.
    expect(inner()?.dataset.stage).toBe("reaction");
  });

  it("uses the configured bump edge for the bonk transform", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    const { rerender } = render(
      <BeakerBotScreenBumpScene
        active
        onComplete={onComplete}
        bumpEdge="left"
      />,
    );

    // Advance to bonk so the transform definitely reflects the bonk
    // position (drift-in already targets the bonked position too, so
    // the X translate sign is observable either way — but bonk adds
    // the squash scale which gives us a second signal).
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const leftInner = screen
      .getByTestId("beakerbot-bump-scene")
      .querySelector("[data-stage]") as HTMLElement;
    // Left bump → negative X translate.
    expect(leftInner.style.transform).toContain("translate(-");
    // Bonk stage → horizontal squash.
    expect(leftInner.style.transform).toContain("scale(0.92");

    // Re-render with bumpEdge="top" — vertical bonk should produce
    // vertical squash (scale(1.04, 0.92)) instead.
    onComplete.mockClear();
    rerender(
      <BeakerBotScreenBumpScene
        active={false}
        onComplete={onComplete}
        bumpEdge="top"
      />,
    );
    rerender(
      <BeakerBotScreenBumpScene
        active
        onComplete={onComplete}
        bumpEdge="top"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const topInner = screen
      .getByTestId("beakerbot-bump-scene")
      .querySelector("[data-stage]") as HTMLElement;
    expect(topInner.style.transform).toContain("scale(1.04, 0.92)");
  });

  it("does not double-fire onComplete if active flips false mid-scene", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    const { rerender } = render(
      <BeakerBotScreenBumpScene active onComplete={onComplete} />,
    );

    // Advance partway through, then deactivate.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    rerender(
      <BeakerBotScreenBumpScene active={false} onComplete={onComplete} />,
    );

    // Run all pending timers — none should fire onComplete because
    // the scheduler's cleanup tore them all down.
    act(() => {
      vi.runAllTimers();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("clamps anchorX / anchorY to [0, 100]", () => {
    stubMatchMedia(false);
    const onComplete = vi.fn();
    render(
      <BeakerBotScreenBumpScene
        active
        onComplete={onComplete}
        anchorX={150}
        anchorY={-25}
      />,
    );
    // [data-stage] IS the anchor wrapper — same element that owns
    // both the anchor positioning (left/top) and the stage transform.
    const anchor = screen
      .getByTestId("beakerbot-bump-scene")
      .querySelector("[data-stage]") as HTMLElement;
    expect(anchor.style.left).toBe("100%");
    expect(anchor.style.top).toBe("0%");
  });
});
