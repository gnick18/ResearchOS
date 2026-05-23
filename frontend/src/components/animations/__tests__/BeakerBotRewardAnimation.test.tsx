// frontend/src/components/animations/__tests__/BeakerBotRewardAnimation.test.tsx
//
// Coverage for the BeakerBot reward animation mode (the "beakerbot"
// option in Settings -> Animation). Behavior contract:
//
//   1. ALWAYS render a sky-blue ripple at the click position.
//   2. If no scene is currently playing -> pick a random scene from
//      the 8 and render it.
//   3. If a scene IS playing -> only the ripple renders this turn
//      (cooldown rule).
//   4. After the playing scene calls onComplete, a fresh reward fire
//      can again render a scene.
//   5. The parent's onComplete fires once the ripple has faded
//      (~600ms), independent of whether a scene is also still going.
//
// The 8 underlying scene components mount via React portal and run CSS
// animations that jsdom can't introspect. We MOCK each scene to a
// trivial component that:
//   - Exposes data-testid="<scene-name>-scene" so we can assert which
//     one was picked.
//   - Calls onComplete() synchronously inside a useEffect, so each
//     mocked scene "finishes" on its next tick. This lets us test the
//     cooldown release without sequencing real animation timing.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { useEffect } from "react";

// ---------------------------------------------------------------------
// Mock all 8 scenes with a trivial component. Each mock exposes a
// data-testid AND calls onComplete on mount (the test drives "scene
// finished" via vi.advanceTimersByTime + the useEffect below).
// ---------------------------------------------------------------------

function makeMockScene(testId: string) {
  return function MockScene({
    active,
    onComplete,
  }: {
    active: boolean;
    onComplete?: () => void;
  }) {
    useEffect(() => {
      if (!active) return;
      // Defer onComplete to a timer so tests can advance time to
      // "finish" the scene rather than it finishing during render.
      const t = setTimeout(() => {
        onComplete?.();
      }, 1000);
      return () => clearTimeout(t);
    }, [active, onComplete]);
    if (!active) return null;
    return <div data-testid={`${testId}-scene`} />;
  };
}

vi.mock("../../BeakerBotLadderScene", () => ({
  default: makeMockScene("ladder"),
}));
vi.mock("../../BeakerBotBugStompScene", () => ({
  default: makeMockScene("bug-stomp"),
}));
vi.mock("../../BeakerBotSkateboardScene", () => ({
  default: makeMockScene("skateboard"),
}));
vi.mock("../../BeakerBotScreenBumpScene", () => ({
  default: makeMockScene("screen-bump"),
}));
vi.mock("../../BeakerBotTooManyBeakersScene", () => ({
  default: makeMockScene("too-many-beakers"),
}));
vi.mock("../../BeakerBotMouseWaveScene", () => ({
  default: makeMockScene("mouse-wave"),
}));
vi.mock("../../BeakerBotCentrifugeScene", () => ({
  default: makeMockScene("centrifuge"),
}));
vi.mock("../../BeakerBotEurekaScene", () => ({
  default: makeMockScene("eureka"),
}));

// Import AFTER the vi.mock calls so the mocks take effect.
import BeakerBotRewardAnimation, {
  SCENE_NAMES,
  __testing,
} from "../BeakerBotRewardAnimation";

describe("BeakerBotRewardAnimation", () => {
  beforeEach(() => {
    __testing.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    __testing.reset();
  });

  it("renders the blue ripple at the click position", () => {
    const onComplete = vi.fn();
    render(<BeakerBotRewardAnimation x={123} y={456} onComplete={onComplete} />);
    const ripple = screen.getByTestId("beakerbot-reward-ripple");
    expect(ripple).toBeInTheDocument();
    // Fixed-position at click coords.
    expect(ripple.style.position).toBe("fixed");
    expect(ripple.style.left).toBe("123px");
    expect(ripple.style.top).toBe("456px");
    // Translate(-50%, -50%) centers the ripple ON the click point.
    expect(ripple.style.transform).toContain("translate(-50%, -50%)");
  });

  it("fires onComplete after the ripple lifespan (~600ms)", () => {
    const onComplete = vi.fn();
    render(<BeakerBotRewardAnimation x={50} y={50} onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
    // Just shy of 600ms -- not yet.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onComplete).not.toHaveBeenCalled();
    // Past 600ms -- fires once.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("picks a scene from the valid 8-scene registry (Math.random=0 -> first)", () => {
    // Stub Math.random to deterministically pick the first scene.
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    const onComplete = vi.fn();
    render(<BeakerBotRewardAnimation x={0} y={0} onComplete={onComplete} />);
    // With Math.random=0, sceneIndex=0 -> SCENE_NAMES[0] = "ladder".
    const wrapper = screen.getByTestId("beakerbot-reward-animation");
    expect(wrapper.getAttribute("data-scene-name")).toBe(SCENE_NAMES[0]);
    expect(wrapper.getAttribute("data-scene-playing")).toBe("true");
    expect(screen.getByTestId(`${SCENE_NAMES[0]}-scene`)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("picks a scene at the upper end of the registry with Math.random close to 1", () => {
    // 0.9999 -> floor(0.9999 * 8) = 7 -> last scene.
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.9999);
    const onComplete = vi.fn();
    render(<BeakerBotRewardAnimation x={0} y={0} onComplete={onComplete} />);
    const wrapper = screen.getByTestId("beakerbot-reward-animation");
    expect(wrapper.getAttribute("data-scene-name")).toBe(
      SCENE_NAMES[SCENE_NAMES.length - 1],
    );
    expect(
      screen.getByTestId(`${SCENE_NAMES[SCENE_NAMES.length - 1]}-scene`),
    ).toBeInTheDocument();
    spy.mockRestore();
  });

  it("cooldown: a 2nd reward fired while a scene is playing renders ripple only, no 2nd scene", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    // Fire #1 -- claims the cooldown gate, mounts the ladder scene.
    const { rerender: rerender1 } = render(
      <div data-testid="fire-1">
        <BeakerBotRewardAnimation x={0} y={0} onComplete={() => {}} />
      </div>,
    );
    expect(__testing.isScenePlaying()).toBe(true);
    expect(screen.getAllByTestId(`${SCENE_NAMES[0]}-scene`)).toHaveLength(1);

    // Fire #2 -- mounted in a SEPARATE host so it doesn't replace #1.
    // The cooldown gate should still be set, so #2 renders ripple only.
    render(
      <div data-testid="fire-2">
        <BeakerBotRewardAnimation x={10} y={10} onComplete={() => {}} />
      </div>,
    );
    // Two ripples now visible (one per fire).
    expect(screen.getAllByTestId("beakerbot-reward-ripple")).toHaveLength(2);
    // Still only ONE scene in the DOM (fire #2 was gated).
    expect(screen.getAllByTestId(`${SCENE_NAMES[0]}-scene`)).toHaveLength(1);

    // Confirm fire #2's wrapper says "no scene".
    const wrappers = screen.getAllByTestId("beakerbot-reward-animation");
    expect(wrappers).toHaveLength(2);
    const scenePlayingCounts = wrappers.map((w) =>
      w.getAttribute("data-scene-playing"),
    );
    // One "true" (fire #1) and one "false" (fire #2, cooldown).
    expect(scenePlayingCounts.sort()).toEqual(["false", "true"]);

    // Silence unused-rerender warnings.
    void rerender1;
    spy.mockRestore();
  });

  it("after the active scene completes, a fresh fire can render a new scene", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    // Fire #1: ladder scene mounts, gate claimed.
    const { unmount: unmount1 } = render(
      <BeakerBotRewardAnimation x={0} y={0} onComplete={() => {}} />,
    );
    expect(__testing.isScenePlaying()).toBe(true);
    expect(screen.getByTestId(`${SCENE_NAMES[0]}-scene`)).toBeInTheDocument();

    // Advance time past the ripple (600ms) AND past the mock scene's
    // 1000ms onComplete timer. The reward-animation wrapper itself
    // calls its onComplete after 600ms but the SCENE continues until
    // its own onComplete fires at 1000ms -- THAT is what releases the
    // gate.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(__testing.isScenePlaying()).toBe(false);

    // Unmount the first reward animation and fire fresh.
    unmount1();
    render(<BeakerBotRewardAnimation x={10} y={10} onComplete={() => {}} />);
    // Gate was clear, so a new scene mounts.
    expect(__testing.isScenePlaying()).toBe(true);
    expect(screen.getByTestId(`${SCENE_NAMES[0]}-scene`)).toBeInTheDocument();
    spy.mockRestore();
  });
});
