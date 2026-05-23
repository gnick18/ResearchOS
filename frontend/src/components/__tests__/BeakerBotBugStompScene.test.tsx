// frontend/src/components/__tests__/BeakerBotBugStompScene.test.tsx
//
// Smoke + behavior coverage for the BeakerBot bug-stomp easter-egg
// scene (R2: scatter swarm + sneak + fly swatter + splat residue).
//
// We don't try to assert on each individual keyframe (CSS animations
// are not introspectable from jsdom) — instead we cover:
//
//   1. Mount: when `active=true`, the scene portals into document.body
//      and exposes the testid.
//   2. Unmount: when `active=false`, the scene renders nothing.
//   3. onComplete: after the full scene duration (6300ms) elapses, the
//      parent's onComplete fires exactly once. Uses vi.useFakeTimers.
//   4. Reduced-motion shortcut: when prefers-reduced-motion: reduce,
//      onComplete fires after the shorter 2s tableau and the scene
//      renders the static fallback (data-reduced-motion="true").
//   5. Direction prop: `beakerBotEntersFrom="left"` swaps BeakerBot's
//      start/exit edges. Asserted via the CSS custom properties on
//      the scene container.
//   6. Swarm: multiple bugs render (BUG_COUNT = 5), one marked as the
//      target.
//   7. Splat + swatter: residue and swatter elements render so the
//      "evidence remains" gag is wired up.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import BeakerBotBugStompScene, {
  SCENE_DURATION_MS,
  STAGE_DURATIONS,
} from "../BeakerBotBugStompScene";

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

  it("derives SCENE_DURATION_MS as the sum of stage durations", () => {
    // Guardrail: if a stage duration changes, the exported constant
    // must update with it. Both the timer and the keyframe offsets
    // depend on this invariant.
    const sum = Object.values(STAGE_DURATIONS).reduce((a, b) => a + b, 0);
    expect(SCENE_DURATION_MS).toBe(sum);
    // Sanity: ~6.3s, tighter than the v1 ~7.4s despite more story.
    expect(SCENE_DURATION_MS).toBeLessThan(7000);
    expect(SCENE_DURATION_MS).toBeGreaterThan(5500);
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
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-reduced-motion")).toBe("false");
  });

  it("calls onComplete after the full scene duration (~6.3s)", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBugStompScene active onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
    // Just before the duration — should still be waiting.
    act(() => {
      vi.advanceTimersByTime(SCENE_DURATION_MS - 100);
    });
    expect(onComplete).not.toHaveBeenCalled();
    // After the full duration, onComplete fires exactly once.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("uses the reduced-motion shortcut when prefers-reduced-motion is set", () => {
    mockMatchMedia(true);
    const onComplete = vi.fn();
    render(<BeakerBotBugStompScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-bug-stomp-scene");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");
    // Reduced-motion fallback is only 2s, not 6.3s.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("renders splat residue + fly swatter inside the static tableau on reduced motion", () => {
    mockMatchMedia(true);
    const onComplete = vi.fn();
    render(<BeakerBotBugStompScene active onComplete={onComplete} />);
    // The "evidence stays" gag — splat residue is visible from the
    // moment the scene mounts in reduced-motion mode.
    expect(screen.getByTestId("beakerbot-bug-stomp-splat")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-bug-stomp-swatter")).toBeInTheDocument();
  });

  it("renders a swarm of multiple bugs with one marked as the target", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBugStompScene active onComplete={onComplete} />);
    // Bug 0 is the target (the one BeakerBot whacks).
    const target = screen.getByTestId("beakerbot-bug-stomp-bug-0");
    expect(target.getAttribute("data-bug-is-target")).toBe("true");
    // At least one non-target bug exists (swarm reads as infestation).
    const witness = screen.getByTestId("beakerbot-bug-stomp-bug-1");
    expect(witness.getAttribute("data-bug-is-target")).toBe("false");
  });

  it("renders splat residue + fly swatter inside the animated scene", () => {
    const onComplete = vi.fn();
    render(<BeakerBotBugStompScene active onComplete={onComplete} />);
    // Both are mounted from the start (opacity-keyed in by CSS so
    // they're present in the DOM but invisible until their stage).
    expect(screen.getByTestId("beakerbot-bug-stomp-splat")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-bug-stomp-swatter")).toBeInTheDocument();
  });

  it("swaps BeakerBot's start + exit edges when beakerBotEntersFrom changes", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <BeakerBotBugStompScene
        active
        onComplete={onComplete}
        beakerBotEntersFrom="right"
      />,
    );
    const right = screen.getByTestId("beakerbot-bug-stomp-scene") as HTMLElement;
    expect(right.style.getPropertyValue("--bbs-beaker-start-x")).toBe("120vw");
    expect(right.style.getPropertyValue("--bbs-beaker-exit-x")).toBe("130vw");

    rerender(
      <BeakerBotBugStompScene
        active
        onComplete={onComplete}
        beakerBotEntersFrom="left"
      />,
    );
    const left = screen.getByTestId("beakerbot-bug-stomp-scene") as HTMLElement;
    expect(left.style.getPropertyValue("--bbs-beaker-start-x")).toBe("-20vw");
    expect(left.style.getPropertyValue("--bbs-beaker-exit-x")).toBe("-30vw");
  });

  it("does not double-fire onComplete if the parent re-renders with a new callback ref", () => {
    // Common foot-gun: parent passes an inline arrow each render. The
    // timer effect re-binds and could fire onComplete twice. We use a
    // ref internally to guard against that; verify here.
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();
    const { rerender } = render(
      <BeakerBotBugStompScene active onComplete={onCompleteA} />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender(<BeakerBotBugStompScene active onComplete={onCompleteB} />);
    act(() => {
      vi.advanceTimersByTime(SCENE_DURATION_MS);
    });
    expect(onCompleteA).not.toHaveBeenCalled();
    expect(onCompleteB).toHaveBeenCalledTimes(1);
  });
});
