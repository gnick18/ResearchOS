// Tests for the IntersectionObserver sequencer (useCenteredActive,
// R1 section 4 Option 3 / R3.8) and the Performance Hall it drives.
// The sequencer is the no-overlap mechanism for P1: exactly ONE element
// is active at any scroll position, so two full-screen-portal scenes
// never stack.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { useCenteredActive } from "../useCenteredActive";
import PerformanceHall, {
  PERFORMANCE_HALL_ACT_COUNT,
} from "../PerformanceHall";

// ── Controllable IntersectionObserver mock ──────────────────────────
//
// Captures the callback so a test can push synthetic intersection
// entries and assert the sequencer picks exactly one winner.

type IOCallback = (
  entries: { target: Element; intersectionRatio: number }[],
) => void;

let ioCallbacks: IOCallback[] = [];
let observedTargets: Element[] = [];

class MockIntersectionObserver {
  cb: IOCallback;
  constructor(cb: IOCallback) {
    this.cb = cb;
    ioCallbacks.push(cb);
  }
  observe(el: Element) {
    observedTargets.push(el);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
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
  ioCallbacks = [];
  observedTargets = [];
  installMatchMedia(); // jsdom lacks matchMedia; the mounted scenes need it
  vi.useFakeTimers();
  // jsdom lacks IntersectionObserver; install the controllable mock.
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  // getBoundingClientRect is used for tie-breaking; give each element a
  // stable rect (jsdom returns all-zero by default, which is fine for
  // the non-tie path we exercise).
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCenteredActive sequencer", () => {
  it("activates exactly one index, the highest-ratio one above 0.6", () => {
    const seen: number[] = [];
    function Harness() {
      const { activeIndex, registerRef } = useCenteredActive(3);
      seen.push(activeIndex);
      return (
        <div>
          <div ref={registerRef(0)} data-i="0" />
          <div ref={registerRef(1)} data-i="1" />
          <div ref={registerRef(2)} data-i="2" />
        </div>
      );
    }
    render(<Harness />);
    expect(observedTargets).toHaveLength(3);

    // Push entries: element 1 is most centered (ratio 0.9). 0 and 2 are
    // below the 0.6 floor.
    act(() => {
      ioCallbacks[0]!([
        { target: observedTargets[0]!, intersectionRatio: 0.2 },
        { target: observedTargets[1]!, intersectionRatio: 0.9 },
        { target: observedTargets[2]!, intersectionRatio: 0.1 },
      ]);
    });
    expect(seen.at(-1)).toBe(1);

    // Scroll on: now element 2 dominates.
    act(() => {
      ioCallbacks[0]!([
        { target: observedTargets[1]!, intersectionRatio: 0.3 },
        { target: observedTargets[2]!, intersectionRatio: 0.95 },
      ]);
    });
    expect(seen.at(-1)).toBe(2);
  });

  it("ignores elements below the 0.6 centered floor", () => {
    const seen: number[] = [];
    function Harness() {
      const { activeIndex, registerRef } = useCenteredActive(2);
      seen.push(activeIndex);
      return (
        <div>
          <div ref={registerRef(0)} />
          <div ref={registerRef(1)} />
        </div>
      );
    }
    render(<Harness />);
    // Both only half on screen: no element crosses 0.6, so the active
    // index stays at its initial 0 (no thrash).
    act(() => {
      ioCallbacks[0]!([
        { target: observedTargets[0]!, intersectionRatio: 0.5 },
        { target: observedTargets[1]!, intersectionRatio: 0.4 },
      ]);
    });
    expect(seen.at(-1)).toBe(0);
  });
});

describe("PerformanceHall", () => {
  it("renders one proscenium per act", () => {
    render(<PerformanceHall />);
    const frames = screen.getAllByTestId("showcase-proscenium");
    expect(frames).toHaveLength(PERFORMANCE_HALL_ACT_COUNT);
    // 9 original scenes + 2 new P1 scenes = 11 acts.
    expect(PERFORMANCE_HALL_ACT_COUNT).toBe(11);
  });

  it("never marks more than one proscenium active at a time", () => {
    render(<PerformanceHall />);
    // Drive several acts into view in sequence; after each push, assert
    // at most one frame is data-active="true".
    const assertSingleActive = () => {
      const frames = screen.getAllByTestId("showcase-proscenium");
      const active = frames.filter(
        (f) => f.getAttribute("data-active") === "true",
      );
      expect(active.length).toBeLessThanOrEqual(1);
    };
    assertSingleActive();
    act(() => {
      ioCallbacks[0]!([
        { target: observedTargets[2]!, intersectionRatio: 0.9 },
      ]);
    });
    assertSingleActive();
    act(() => {
      ioCallbacks[0]!([
        { target: observedTargets[2]!, intersectionRatio: 0.2 },
        { target: observedTargets[5]!, intersectionRatio: 0.85 },
      ]);
    });
    assertSingleActive();
  });
});
