// frontend/src/components/__tests__/BeakerBotSkateboardScene.test.tsx
//
// Coverage for the side easter-egg skateboard scene.
//
//   - Renders the bot + skateboard via portal when `active` flips true.
//   - Fires `onComplete` once after the full animation duration (cruise
//     length is derived from viewport width + speedPxPerSec, so we pin
//     window.innerWidth + use a generous speed to keep the test snappy
//     while still exercising the full entry/cruise/exit pipeline).
//   - Reduced-motion shortcut: when `prefers-reduced-motion: reduce`
//     matches, we render with the `data-reduced-motion` marker, hold
//     for ~2s, then fire onComplete — no horizontal motion path.
//   - Direction prop variations: data-direction attr reflects the
//     prop both for `left-to-right` and `right-to-left`. Reduced-motion
//     branch is direction-agnostic (centered render).
//   - Unmounts cleanly when `active` flips back to false — completion
//     timer is cleared.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BeakerBotSkateboardScene from "../BeakerBotSkateboardScene";

/**
 * Helper: install a controllable matchMedia mock returning `reduced`
 * for the prefers-reduced-motion query. jsdom doesn't ship matchMedia
 * out of the box, so every test that exercises the component installs
 * its preferred answer first.
 */
function installMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/**
 * Helper: pin innerWidth so cruise duration is deterministic. The
 * default jsdom value (1024) plus the default speed (350px/s) gives
 * a ~2926ms cruise; we override both ends to keep tests fast and
 * predictable.
 */
function pinInnerWidth(px: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: px,
  });
}

describe("BeakerBotSkateboardScene", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMatchMedia(false);
    pinInnerWidth(1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when active is false", () => {
    const onComplete = vi.fn();
    render(<BeakerBotSkateboardScene active={false} onComplete={onComplete} />);
    expect(screen.queryByTestId("beakerbot-skateboard-scene")).toBeNull();
  });

  it("portals the scene into document.body when active flips true", () => {
    const onComplete = vi.fn();
    render(<BeakerBotSkateboardScene active={true} onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-skateboard-scene");
    expect(scene).toBeInTheDocument();
    // Portal target is document.body, not the RTL wrapper div.
    expect(document.body.contains(scene)).toBe(true);
    // Bot + skateboard SVG both present.
    expect(screen.getByTestId("beakerbot-skateboard-bot")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-skateboard-svg")).toBeInTheDocument();
    // Fixed positioning + z-index 800 per scene contract. `overflow:
    // visible` lets the bot leave the wrapper during the loopy-loop
    // apex without being clipped.
    expect(scene.style.position).toBe("fixed");
    expect(scene.style.zIndex).toBe("800");
    expect(scene.style.overflow).toBe("visible");
  });

  it("renders the loop wrapper for the mid-cruise loopy-loop", () => {
    const onComplete = vi.fn();
    render(<BeakerBotSkateboardScene active={true} onComplete={onComplete} />);
    // Loop wrapper is the mid-cruise translateY arc + 360° rotation
    // host. Separated from the X cruise transform so the two
    // animations compose without fighting for `transform`.
    const loop = screen.getByTestId("beakerbot-skateboard-loop");
    expect(loop).toBeInTheDocument();
    // SkateboardStack lives inside the loop wrapper so the loop's
    // translate+rotate moves the whole bot+deck rig together.
    expect(loop.contains(screen.getByTestId("beakerbot-skateboard-bot"))).toBe(true);
    expect(loop.contains(screen.getByTestId("beakerbot-skateboard-svg"))).toBe(true);
  });

  it("fires onComplete after the full entry + cruise + exit duration", () => {
    const onComplete = vi.fn();
    // Speed 1000px/s over 1000px viewport = 1000ms base cruise + 700ms
    // loop runway + 300ms entry + 300ms exit = 2300ms total. The loop
    // runway gives the mid-cruise loopy-loop room to read at human
    // speed; cruise floor is 600ms so the math holds.
    render(
      <BeakerBotSkateboardScene
        active={true}
        onComplete={onComplete}
        speedPxPerSec={1000}
      />,
    );
    expect(onComplete).not.toHaveBeenCalled();
    // Just before total: still no fire.
    vi.advanceTimersByTime(2200);
    expect(onComplete).not.toHaveBeenCalled();
    // Past total: fires exactly once.
    vi.advanceTimersByTime(200);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("respects prefers-reduced-motion: renders static center scene + fires onComplete after the hold", () => {
    installMatchMedia(true);
    const onComplete = vi.fn();
    render(<BeakerBotSkateboardScene active={true} onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-skateboard-scene");
    // Marker attribute distinguishes the reduced-motion branch.
    expect(scene.dataset.reducedMotion).toBe("true");
    // Centered on screen, not animated horizontally.
    expect(scene.style.left).toBe("50%");
    // Reduced-motion hold is ~2s.
    vi.advanceTimersByTime(1900);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("threads direction=left-to-right onto the scene wrapper", () => {
    const onComplete = vi.fn();
    render(
      <BeakerBotSkateboardScene
        active={true}
        onComplete={onComplete}
        direction="left-to-right"
      />,
    );
    const scene = screen.getByTestId("beakerbot-skateboard-scene");
    expect(scene.dataset.direction).toBe("left-to-right");
  });

  it("threads direction=right-to-left onto the scene wrapper", () => {
    const onComplete = vi.fn();
    render(
      <BeakerBotSkateboardScene
        active={true}
        onComplete={onComplete}
        direction="right-to-left"
      />,
    );
    const scene = screen.getByTestId("beakerbot-skateboard-scene");
    expect(scene.dataset.direction).toBe("right-to-left");
  });

  it("honors the bottomY prop on the scene's top position", () => {
    const onComplete = vi.fn();
    render(
      <BeakerBotSkateboardScene
        active={true}
        onComplete={onComplete}
        bottomY={50}
      />,
    );
    const scene = screen.getByTestId("beakerbot-skateboard-scene");
    expect(scene.style.top).toBe("50%");
  });

  it("does not fire onComplete if active flips back to false before the timer expires", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <BeakerBotSkateboardScene
        active={true}
        onComplete={onComplete}
        speedPxPerSec={1000}
      />,
    );
    // Mid-cruise unmount.
    vi.advanceTimersByTime(800);
    rerender(<BeakerBotSkateboardScene active={false} onComplete={onComplete} />);
    // Past the original full duration — should NOT have fired.
    vi.advanceTimersByTime(3000);
    expect(onComplete).not.toHaveBeenCalled();
    // And the portal node is gone.
    expect(screen.queryByTestId("beakerbot-skateboard-scene")).toBeNull();
  });
});
