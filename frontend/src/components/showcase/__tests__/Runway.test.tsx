// Render + behavior tests for the redesigned Runway. The runway is now a
// self-contained, hands-free AUTO-PLAYING show: BeakerBot stands center
// stage and cycles all 21 emotions on a timer (looping). The user does
// NOT scroll to advance. The "THE CATEGORY IS..." copy and the punny
// per-pose category names were dropped; the only visible text is a small
// plain emotion label.
//
// These tests assert: exactly one look is on stage at a time, the timer
// advances to the next look, the show loops, the dropped category copy
// never renders, clicking does not throw (camera flashes), and reduced
// motion replaces auto-advance with a manual "next look" control.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

import Runway from "../Runway";
import {
  SHOWCASE_FRAMES,
  SHOWCASE_LOOKS,
  POINTING_TRIO,
} from "../showcase-data";
import { RUNWAY_HOLD_MS } from "../useRunwayAutoplay";

function installMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("reduce"),
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

beforeEach(() => {
  vi.useFakeTimers();
  installMatchMedia(false);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Runway auto-show", () => {
  it("renders exactly one look on stage at a time (not all 19)", () => {
    render(<Runway />);
    expect(screen.getAllByTestId("showcase-look")).toHaveLength(1);
  });

  it("opens on the first show frame", () => {
    render(<Runway />);
    const first = SHOWCASE_FRAMES[0]!;
    // First frame is the idle greeting look.
    expect(first.kind).toBe("look");
    if (first.kind === "look") {
      expect(screen.getByLabelText(`BeakerBot ${first.pose}`)).toBeTruthy();
      expect(screen.getByText(first.emotion)).toBeTruthy();
    }
  });

  it("auto-advances to the next look on the timer", () => {
    render(<Runway />);
    const second = SHOWCASE_FRAMES[1]!;
    expect(second.kind).toBe("look");
    act(() => {
      vi.advanceTimersByTime(RUNWAY_HOLD_MS);
    });
    if (second.kind === "look") {
      expect(screen.getByLabelText(`BeakerBot ${second.pose}`)).toBeTruthy();
      expect(screen.getByText(second.emotion)).toBeTruthy();
    }
  });

  it("loops back to the first look after the last", () => {
    render(<Runway />);
    act(() => {
      // Advance through every frame and one more to wrap around.
      vi.advanceTimersByTime(RUNWAY_HOLD_MS * SHOWCASE_FRAMES.length);
    });
    const first = SHOWCASE_FRAMES[0]!;
    if (first.kind === "look") {
      expect(screen.getByLabelText(`BeakerBot ${first.pose}`)).toBeTruthy();
    }
  });

  it("shows the pointing trio as one clustered frame with all three poses", () => {
    render(<Runway />);
    const trioIdx = SHOWCASE_FRAMES.findIndex((f) => f.kind === "trio");
    expect(trioIdx).toBeGreaterThanOrEqual(0);
    act(() => {
      vi.advanceTimersByTime(RUNWAY_HOLD_MS * trioIdx);
    });
    const stage = screen.getByTestId("showcase-look");
    for (const pose of POINTING_TRIO.poses) {
      expect(stage.querySelector(`[aria-label="BeakerBot ${pose}"]`)).toBeTruthy();
    }
  });

  it("shows a small plain emotion label, never the dropped category copy", () => {
    render(<Runway />);
    expect(screen.getByTestId("showcase-emotion-label")).toBeTruthy();
    // The dropped catchphrase + punny names must never appear on screen.
    expect(screen.queryByText(/the category is/i)).toBeNull();
    for (const look of SHOWCASE_LOOKS) {
      expect(screen.queryByText(look.category)).toBeNull();
    }
    expect(screen.queryByText(POINTING_TRIO.category)).toBeNull();
  });

  it("does not throw when the stage is clicked (camera flashes)", () => {
    render(<Runway />);
    expect(() => {
      fireEvent.click(screen.getByTestId("showcase-runway"));
    }).not.toThrow();
  });

  it("does not render a manual next control while autoplaying", () => {
    render(<Runway />);
    expect(screen.queryByTestId("showcase-runway-next")).toBeNull();
  });
});

describe("Runway under reduced motion", () => {
  beforeEach(() => {
    installMatchMedia(true);
  });

  it("does not auto-advance and offers a manual next control", () => {
    render(<Runway />);
    const first = SHOWCASE_FRAMES[0]!;
    const second = SHOWCASE_FRAMES[1]!;

    // The timer would have advanced under full motion; here it must not.
    act(() => {
      vi.advanceTimersByTime(RUNWAY_HOLD_MS * 3);
    });
    if (first.kind === "look") {
      expect(screen.getByLabelText(`BeakerBot ${first.pose}`)).toBeTruthy();
    }

    // A manual control lets the viewer step at their own pace.
    const next = screen.getByTestId("showcase-runway-next");
    act(() => {
      fireEvent.click(next);
    });
    if (second.kind === "look") {
      expect(screen.getByLabelText(`BeakerBot ${second.pose}`)).toBeTruthy();
    }
  });
});
