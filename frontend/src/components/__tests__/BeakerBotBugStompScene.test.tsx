// frontend/src/components/__tests__/BeakerBotBugStompScene.test.tsx
//
// Smoke + behavior coverage for the BeakerBot bug-stomp easter-egg
// scene. We don't try to assert on each individual keyframe (CSS
// animations are not introspectable from jsdom in any useful way) —
// instead we cover:
//
//   1. Mount: when `active=true`, the scene portals into document.body
//      and exposes the testid.
//   2. Unmount: when `active=false`, the scene renders nothing.
//   3. onComplete: after the full scene duration elapses, the parent's
//      onComplete callback fires exactly once. We use vi.useFakeTimers()
//      so we don't wait 7+ seconds per test.
//   4. Reduced-motion shortcut: when the browser reports
//      prefers-reduced-motion: reduce, onComplete fires after the
//      shorter 2s tableau and the scene renders the static fallback
//      (data-reduced-motion="true") instead of the full animation.
//   5. Direction prop: `beakerBotEntersFrom="left"` swaps the bug to
//      enter from the right. Asserted via the CSS custom properties
//      on the scene container.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import BeakerBotBugStompScene from "../BeakerBotBugStompScene";

/** Helper: mock window.matchMedia for the reduced-motion query.
 *  jsdom 27 doesn't implement matchMedia by default; we provide a
 *  minimal stub keyed on the query string. */
function mockMatchMedia(reduced: boolean) {
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

describe("BeakerBotBugStompScene", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when active=false", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBugStompScene active={false} onComplete={onComplete} />);
    expect(screen.queryByTestId("beakerbot-bug-stomp-scene")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("mounts via portal to document.body when active=true", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBugStompScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-bug-stomp-scene");
    expect(scene).toBeInTheDocument();
    // Portal sanity: the scene element should be a child of document.body
    // (not nested under the RTL render container).
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-reduced-motion")).toBe("false");
  });

  it("calls onComplete after the full scene duration (~7.4s)", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBugStompScene active onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
    // 7s in — should still be waiting.
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(onComplete).not.toHaveBeenCalled();
    // After the full 7400ms duration, onComplete fires exactly once.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("uses the reduced-motion shortcut when prefers-reduced-motion is set", () => {
    mockMatchMedia(true);
    const onComplete = vi.fn();
    render(<BeakerBotBugStompScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-bug-stomp-scene");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");
    // Reduced-motion fallback is only 2s, not 7.4s — onComplete should
    // fire well before the full animation duration.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("places bug on the opposite side of BeakerBot's entry", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <BeakerBotBugStompScene active onComplete={onComplete} beakerBotEntersFrom="right" />,
    );
    const right = screen.getByTestId("beakerbot-bug-stomp-scene") as HTMLElement;
    // When BeakerBot enters from the right, the bug should start from
    // the left edge of the viewport. Verified via the CSS custom prop
    // we wired into the scene container's style.
    expect(right.style.getPropertyValue("--bbs-bug-start-x")).toBe("-10vw");
    expect(right.style.getPropertyValue("--bbs-beaker-start-x")).toBe("120vw");

    // Flip the prop — the values should swap.
    rerender(
      <BeakerBotBugStompScene active onComplete={onComplete} beakerBotEntersFrom="left" />,
    );
    const left = screen.getByTestId("beakerbot-bug-stomp-scene") as HTMLElement;
    expect(left.style.getPropertyValue("--bbs-bug-start-x")).toBe("120vw");
    expect(left.style.getPropertyValue("--bbs-beaker-start-x")).toBe("-20vw");
  });

  it("does not double-fire onComplete if the parent re-renders with a new callback ref", () => {
    // Common foot-gun: parent passes an inline arrow each render. The
    // timer effect re-binds and could fire onComplete twice. We use a
    // ref internally to guard against that; verify here.
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();
    const { rerender } = render(<BeakerBotBugStompScene active onComplete={onCompleteA} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender(<BeakerBotBugStompScene active onComplete={onCompleteB} />);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // The final callback (the one held in the ref at fire-time) should
    // win; the earlier one should never fire.
    expect(onCompleteA).not.toHaveBeenCalled();
    expect(onCompleteB).toHaveBeenCalledTimes(1);
  });
});
