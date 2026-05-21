// Component test for the BeakerBotCentrifugeScene easter-egg.
// Covers:
//   1. Portal mount + unmount via `active` prop
//   2. Stage chain walks through STAGE_ORDER in sequence
//   3. onComplete fires exactly once at TOTAL_DURATION_MS
//   4. Reduced-motion shortcut renders the static aftermath + fires
//      onComplete after 2000ms
//   5. enterFrom mirrors the body translateX direction (left vs right)
//   6. Sample tubes get independent --bb-fall-x trajectories (the joke
//      depends on each tube flying its own way — sharing a trajectory
//      would collapse them into one big blob).
//   7. Lid pops + flying tubes render during the explosion stage
//   8. Alarm + shrug bubbles fire on the correct stages
//   9. Pending timers are cleared on unmount mid-sequence

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import BeakerBotCentrifugeScene, {
  STAGE_DURATIONS,
  TOTAL_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
  STAGE_ORDER,
} from "../BeakerBotCentrifugeScene";

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

describe("BeakerBotCentrifugeScene", () => {
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
    render(<BeakerBotCentrifugeScene active={false} onComplete={onComplete} />);
    expect(screen.queryByTestId("beakerbot-centrifuge-scene")).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("mounts via portal at document.body when active", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCentrifugeScene active onComplete={onComplete} />);
    const scene = screen.getByTestId("beakerbot-centrifuge-scene");
    expect(scene).toBeTruthy();
    // Portal renders directly under document.body, not nested under
    // the RTL render container.
    expect(scene.parentElement).toBe(document.body);
    expect(scene.getAttribute("data-stage")).toBe("walkIn");
    expect(scene.getAttribute("data-reduced-motion")).toBe("false");
  });

  it("walks through every stage in STAGE_ORDER", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCentrifugeScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-centrifuge-scene");
    const observed: string[] = [scene.getAttribute("data-stage")!];

    for (let i = 0; i < STAGE_ORDER.length; i++) {
      const dur = STAGE_DURATIONS[STAGE_ORDER[i] as keyof typeof STAGE_DURATIONS];
      act(() => {
        vi.advanceTimersByTime(dur);
      });
      observed.push(
        screen
          .getByTestId("beakerbot-centrifuge-scene")
          .getAttribute("data-stage")!,
      );
    }

    // Every named stage should appear in the observed sequence — the
    // out-of-control build, the explosion, the reaction, and the
    // sheepish shrug are all load-bearing slapstick beats. Regressing
    // any of them would kill the joke.
    for (const s of STAGE_ORDER) {
      expect(observed).toContain(s);
    }
    // Strict ordering: explosion must come AFTER outOfControl,
    // reaction AFTER explosion, exit LAST.
    expect(observed.indexOf("outOfControl")).toBeLessThan(observed.indexOf("explosion"));
    expect(observed.indexOf("explosion")).toBeLessThan(observed.indexOf("reaction"));
    expect(observed.indexOf("reaction")).toBeLessThan(observed.indexOf("sheepishShrug"));
    expect(observed.indexOf("sheepishShrug")).toBeLessThan(observed.indexOf("exit"));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("fires onComplete exactly once after TOTAL_DURATION_MS", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCentrifugeScene active onComplete={onComplete} />);

    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS - 10);
    });
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("respects prefers-reduced-motion: renders static aftermath + fires after 2s", () => {
    mqState.matches = true;
    const onComplete = vi.fn();
    render(<BeakerBotCentrifugeScene active onComplete={onComplete} />);

    const scene = screen.getByTestId("beakerbot-centrifuge-scene");
    expect(scene.getAttribute("data-stage")).toBe("done");
    expect(scene.getAttribute("data-reduced-motion")).toBe("true");
    expect(screen.getByTestId("aftermath-scattered")).toBeTruthy();
    // No mid-explosion artifacts visible in the reduced-motion path.
    expect(screen.queryByTestId("flying-tubes")).toBeNull();
    expect(screen.queryByTestId("alarm-bubble")).toBeNull();
    expect(screen.queryByTestId("shrug-bubble")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(REDUCED_MOTION_DURATION_MS - 10);
    });
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("renders flying tubes during the explosion stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCentrifugeScene active onComplete={onComplete} />);

    // Advance to the explosion stage.
    const upToExplosion =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.setDown +
      STAGE_DURATIONS.startSpinning +
      STAGE_DURATIONS.outOfControl;
    act(() => {
      vi.advanceTimersByTime(upToExplosion);
    });

    expect(screen.getByTestId("flying-tubes")).toBeTruthy();
    // 4 colors -> 4 flying tubes
    expect(screen.getAllByTestId(/flying-tube-\d/)).toHaveLength(4);
  });

  it("gives each sample tube an independent --bb-fall-x trajectory", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCentrifugeScene active onComplete={onComplete} />);

    const upToExplosion =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.setDown +
      STAGE_DURATIONS.startSpinning +
      STAGE_DURATIONS.outOfControl;
    act(() => {
      vi.advanceTimersByTime(upToExplosion);
    });

    const tubes = screen.getAllByTestId(/flying-tube-\d/);
    const xValues = tubes.map((t) => {
      const style = t.getAttribute("style") ?? "";
      // Pull the --bb-fall-x value out of the inline style string.
      const m = style.match(/--bb-fall-x:\s*([^;]+)/);
      return m ? m[1].trim() : "";
    });
    // No two tubes share the same horizontal trajectory — otherwise
    // they'd overlap and the explosion would read as a single blob.
    const unique = new Set(xValues);
    expect(unique.size).toBe(xValues.length);
  });

  it("renders the alarm bubble during the reaction stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCentrifugeScene active onComplete={onComplete} />);

    const upToReaction =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.setDown +
      STAGE_DURATIONS.startSpinning +
      STAGE_DURATIONS.outOfControl +
      STAGE_DURATIONS.explosion;
    act(() => {
      vi.advanceTimersByTime(upToReaction);
    });

    expect(screen.getByTestId("alarm-bubble")).toBeTruthy();
  });

  it("renders the shrug bubble during the sheepish shrug stage", () => {
    const onComplete = vi.fn();
    render(<BeakerBotCentrifugeScene active onComplete={onComplete} />);

    const upToShrug =
      STAGE_DURATIONS.walkIn +
      STAGE_DURATIONS.setDown +
      STAGE_DURATIONS.startSpinning +
      STAGE_DURATIONS.outOfControl +
      STAGE_DURATIONS.explosion +
      STAGE_DURATIONS.reaction;
    act(() => {
      vi.advanceTimersByTime(upToShrug);
    });

    expect(screen.getByTestId("shrug-bubble")).toBeTruthy();
    // Alarm bubble should be gone by now (only fires during reaction).
    expect(screen.queryByTestId("alarm-bubble")).toBeNull();
  });

  it("enterFrom mirrors body translateX direction (left vs right)", () => {
    const onCompleteLeft = vi.fn();
    const { unmount: unmountLeft } = render(
      <BeakerBotCentrifugeScene
        active
        onComplete={onCompleteLeft}
        enterFrom="left"
      />,
    );
    const leftBody = screen.getByTestId("beakerbot-body");
    const leftStyle = leftBody.getAttribute("style") ?? "";
    unmountLeft();

    const onCompleteRight = vi.fn();
    render(
      <BeakerBotCentrifugeScene
        active
        onComplete={onCompleteRight}
        enterFrom="right"
      />,
    );
    const rightBody = screen.getByTestId("beakerbot-body");
    const rightStyle = rightBody.getAttribute("style") ?? "";

    // Same instant, different transforms — sign convention should
    // flip the bench-side vw expression. enterFrom="left" settles at
    // -2vw (slightly left of center). enterFrom="right" mirrors to
    // +2vw.
    expect(leftStyle).not.toBe(rightStyle);
    expect(leftStyle).toContain("-2vw");
    expect(rightStyle).toContain("+ 2vw");
  });

  it("cleans up pending timers when unmounted mid-sequence", () => {
    const onComplete = vi.fn();
    const { unmount } = render(
      <BeakerBotCentrifugeScene active onComplete={onComplete} />,
    );
    act(() => {
      vi.advanceTimersByTime(STAGE_DURATIONS.walkIn + 100);
    });
    unmount();
    // After unmount, no further onComplete calls regardless of time.
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("does not require onComplete (prop is optional)", () => {
    // Spec marks onComplete optional — confirm the component renders
    // and runs the timer chain without one.
    render(<BeakerBotCentrifugeScene active />);
    const scene = screen.getByTestId("beakerbot-centrifuge-scene");
    expect(scene).toBeTruthy();
    // Just walking through should not throw.
    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION_MS + 10);
    });
  });
});
