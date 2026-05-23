// Component test for the BeakerBotTooManyBeakersScene easter-egg.
// Covers:
//   1. Mounts via portal at document.body when `active` is true
//   2. Fires `onComplete` after the full stage chain duration
//   3. Reduced-motion shortcut: skips to aftermath and exits in 2s
//   4. Double-trip beat: both `firstStumble` and `secondStumble` stages
//      get exercised in sequence (the comedy beat is the whole point —
//      regressing the second stumble silently would kill the joke).

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import BeakerBotTooManyBeakersScene, {
  STAGE_DURATIONS,
  TOTAL_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
  STAGE_ORDER,
} from "../BeakerBotTooManyBeakersScene";

// Track matchMedia override so we can flip prefers-reduced-motion per
// test without polluting other tests.
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

describe("BeakerBotTooManyBeakersScene", () => {
  beforeEach(() => {
    mqState.matches = false;
    installMatchMedia();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("does not render when inactive", () => {
    const onComplete = vi.fn();
    render(<BeakerBotTooManyBeakersScene active={false} onComplete={onComplete} />);
    expect(screen.queryByTestId("beakerbot-too-many-beakers-scene")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("mounts via portal at document.body when active", () => {
    const onComplete = vi.fn();
    render(<BeakerBotTooManyBeakersScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-too-many-beakers-scene");
    expect(scene).toBeTruthy();
    // Portal mounts at document.body — confirm the scene is a direct
    // descendant of body, not nested inside the test container.
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-stage")).toBe("entry");
  });

  it("walks through every stage in STAGE_ORDER, exercising both stumbles", () => {
    const onComplete = vi.fn();
    render(<BeakerBotTooManyBeakersScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-too-many-beakers-scene");
    const observed: string[] = [scene.getAttribute("data-stage")!];

    // Walk through each stage; record what we observe at each boundary.
    for (let i = 0; i < STAGE_ORDER.length; i++) {
      const dur = STAGE_DURATIONS[STAGE_ORDER[i] as keyof typeof STAGE_DURATIONS];
      act(() => {
        vi.advanceTimersByTime(dur);
      });
      const current = screen
        .getByTestId("beakerbot-too-many-beakers-scene")
        .getAttribute("data-stage")!;
      observed.push(current);
    }

    // The double-trip beat: first stumble AND second stumble must
    // both appear in the observed stage sequence.
    expect(observed).toContain("firstStumble");
    expect(observed).toContain("secondStumble");
    expect(observed).toContain("catchRebalance");
    expect(observed).toContain("phew");
    expect(observed).toContain("dropFall");
    expect(observed).toContain("rollOff");
    // first stumble strictly precedes second stumble (comedy beat
    // is fake-out THEN payoff — flipping them kills the joke).
    expect(observed.indexOf("firstStumble")).toBeLessThan(observed.indexOf("secondStumble"));

    // After the full chain elapsed, onComplete should have fired.
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("renders the phew bubble during the phew stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotTooManyBeakersScene active onComplete={onComplete} />);

    // Advance through entry + firstStumble + catchRebalance to reach phew.
    const upToPhew =
      STAGE_DURATIONS.entry + STAGE_DURATIONS.firstStumble + STAGE_DURATIONS.catchRebalance;
    act(() => {
      vi.advanceTimersByTime(upToPhew);
    });

    expect(screen.getByTestId("phew-bubble")).toBeTruthy();
    expect(screen.getByText("phew!")).toBeTruthy();
  });

  it("renders falling beakers during dropFall stage", () => {
    const onComplete = vi.fn();
    render(
      <BeakerBotTooManyBeakersScene active onComplete={onComplete} beakerCount={4} />,
    );

    // Advance to the dropFall stage.
    const upToDrop =
      STAGE_DURATIONS.entry +
      STAGE_DURATIONS.firstStumble +
      STAGE_DURATIONS.catchRebalance +
      STAGE_DURATIONS.phew +
      STAGE_DURATIONS.walkingAway +
      STAGE_DURATIONS.secondStumble;
    act(() => {
      vi.advanceTimersByTime(upToDrop);
    });

    expect(screen.getByTestId("falling-beakers")).toBeTruthy();
    // 4 beakers default, expect 4 falling-beaker elements
    expect(screen.getAllByTestId(/falling-beaker-\d/)).toHaveLength(4);
  });

  it("fires onComplete exactly once after TOTAL_DURATION_MS", () => {
    const onComplete = vi.fn();
    render(<BeakerBotTooManyBeakersScene active onComplete={onComplete} />);

    // Just before total — should NOT have fired yet.
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS - 10);
    });
    expect(onComplete).not.toHaveBeenCalled();

    // Cross the threshold.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("respects prefers-reduced-motion: skips animation, fires after 2s, renders aftermath", () => {
    mqState.matches = true;
    const onComplete = vi.fn();
    render(<BeakerBotTooManyBeakersScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-too-many-beakers-scene");
    // Should skip straight to the "done" stage (aftermath rendering).
    expect(scene.getAttribute("data-stage")).toBe("done");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");
    expect(screen.getByTestId("aftermath-scattered")).toBeTruthy();
    // The full slapstick scene is short-circuited — no falling beakers
    // mid-animation, no phew bubble.
    expect(screen.queryByTestId("falling-beakers")).toBeNull();
    expect(screen.queryByTestId("phew-bubble")).toBeNull();

    // Before 2s, no completion.
    act(() => {
      vi.advanceTimersByTime(REDUCED_MOTION_DURATION_MS - 10);
    });
    expect(onComplete).not.toHaveBeenCalled();

    // After 2s, exactly one completion call.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("respects custom beakerCount and clamps to [3, 6]", () => {
    const onComplete = vi.fn();
    // Way out of range — should clamp to 6.
    render(
      <BeakerBotTooManyBeakersScene active onComplete={onComplete} beakerCount={20} />,
    );
    // Advance to dropFall so the falling beakers render.
    const upToDrop =
      STAGE_DURATIONS.entry +
      STAGE_DURATIONS.firstStumble +
      STAGE_DURATIONS.catchRebalance +
      STAGE_DURATIONS.phew +
      STAGE_DURATIONS.walkingAway +
      STAGE_DURATIONS.secondStumble;
    act(() => {
      vi.advanceTimersByTime(upToDrop);
    });
    expect(screen.getAllByTestId(/falling-beaker-\d/)).toHaveLength(6);
  });

  it("entersFrom mirrors body translateX direction (left vs right)", () => {
    const onCompleteLeft = vi.fn();
    const { unmount: unmountLeft } = render(
      <BeakerBotTooManyBeakersScene active onComplete={onCompleteLeft} entersFrom="left" />,
    );
    const leftBody = screen.getByTestId("beakerbot-body");
    const leftStyle = leftBody.getAttribute("style") ?? "";
    unmountLeft();

    const onCompleteRight = vi.fn();
    render(
      <BeakerBotTooManyBeakersScene active onComplete={onCompleteRight} entersFrom="right" />,
    );
    const rightBody = screen.getByTestId("beakerbot-body");
    const rightStyle = rightBody.getAttribute("style") ?? "";

    // Left enters from negative-x side, right enters from positive — at
    // the same instant the transforms differ. Specifically the
    // translateX expression sign should flip between the two.
    expect(leftStyle).not.toBe(rightStyle);
    // Left variant settles at -8vw centerLeft; right variant mirrors to +8vw.
    expect(leftStyle).toContain("-8vw");
    expect(rightStyle).toContain("+ 8vw");
  });

  it("renders crying tears during the rollOff (crying walk-off) stage", () => {
    // The ending was reworked: instead of tumbling off-screen with a
    // weird elastic bounce, BeakerBot stands up, starts crying, and
    // slowly walks off to the side. Regressing the tears would silently
    // bring back the bounce-off (or render an emotion-less walk).
    const onComplete = vi.fn();
    render(<BeakerBotTooManyBeakersScene active onComplete={onComplete} />);

    const upToRollOff =
      STAGE_DURATIONS.entry +
      STAGE_DURATIONS.firstStumble +
      STAGE_DURATIONS.catchRebalance +
      STAGE_DURATIONS.phew +
      STAGE_DURATIONS.walkingAway +
      STAGE_DURATIONS.secondStumble +
      STAGE_DURATIONS.dropFall;
    act(() => {
      vi.advanceTimersByTime(upToRollOff);
    });

    const scene = screen.getByTestId("beakerbot-too-many-beakers-scene");
    expect(scene.getAttribute("data-stage")).toBe("rollOff");
    expect(screen.getByTestId("beakerbot-tears")).toBeTruthy();

    // The body wrapper should have the sad-sway class (gentle walking
    // gait) and target opacity 0 (fade-out toward the exit edge).
    const body = screen.getByTestId("beakerbot-body");
    expect(body.className).toContain("beakerbot-sad-sway");
    expect(body.getAttribute("style") ?? "").toContain("opacity: 0");
  });

  it("cleans up pending timers when unmounted mid-sequence", () => {
    const onComplete = vi.fn();
    const { unmount } = render(
      <BeakerBotTooManyBeakersScene active onComplete={onComplete} />,
    );
    // Advance partially, then unmount.
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.entry + 100);
    });
    unmount();
    // Advance past where onComplete would have fired — must not fire
    // after unmount (pending timers should be cleared).
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
