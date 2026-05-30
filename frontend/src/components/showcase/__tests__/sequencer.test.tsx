// Tests for the Performance Hall (Scenes view) picker model and the
// (now standalone) useCenteredActive hook.
//
// PICKER REDESIGN: the Hall no longer scrolls between 11 prosceniums. It
// is ONE fixed window plus a scene-picker (one pill per act). Clicking a
// pill plays THAT act inside the window; exactly one scene is mounted +
// active at a time (the selected one), so two full-screen-portal scenes
// never overlap. The Hall no longer uses useCenteredActive; the hook
// remains exported + tested here for its own contract.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { useCenteredActive } from "../useCenteredActive";
import PerformanceHall, {
  PERFORMANCE_HALL_ACT_COUNT,
} from "../PerformanceHall";

// ── Controllable IntersectionObserver mock ──────────────────────────
//
// Captures the callback so the hook tests can push synthetic
// intersection entries and assert the hook picks exactly one winner.

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
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCenteredActive hook", () => {
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

    // Now element 2 dominates.
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
    act(() => {
      ioCallbacks[0]!([
        { target: observedTargets[0]!, intersectionRatio: 0.5 },
        { target: observedTargets[1]!, intersectionRatio: 0.4 },
      ]);
    });
    expect(seen.at(-1)).toBe(0);
  });
});

describe("PerformanceHall (picker model)", () => {
  it("renders exactly ONE fixed proscenium window (not one per act)", () => {
    render(<PerformanceHall />);
    const frames = screen.getAllByTestId("showcase-proscenium");
    expect(frames).toHaveLength(1);
  });

  it("renders a scene-picker with one button per act", () => {
    render(<PerformanceHall />);
    const picker = screen.getByTestId("showcase-scene-picker");
    const buttons = within(picker).getAllByRole("tab");
    expect(buttons).toHaveLength(PERFORMANCE_HALL_ACT_COUNT);
    // 9 original scenes + 2 new P1 scenes = 11 acts.
    expect(PERFORMANCE_HALL_ACT_COUNT).toBe(11);
  });

  it("defaults to the first act (The Greeting) selected", () => {
    render(<PerformanceHall />);
    const greeting = screen.getByTestId("showcase-scene-pick-mouse-wave");
    expect(greeting.getAttribute("aria-selected")).toBe("true");
    expect(greeting.getAttribute("data-selected")).toBe("true");
    // Every other pill is unselected: exactly one selected at a time.
    const picker = screen.getByTestId("showcase-scene-picker");
    const selected = within(picker)
      .getAllByRole("tab")
      .filter((b) => b.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
  });

  it("clicking a picker button selects that act (exactly one selected)", () => {
    render(<PerformanceHall />);
    const eureka = screen.getByTestId("showcase-scene-pick-eureka");
    act(() => {
      fireEvent.click(eureka);
    });
    expect(eureka.getAttribute("aria-selected")).toBe("true");
    // The previous default is no longer selected.
    const greeting = screen.getByTestId("showcase-scene-pick-mouse-wave");
    expect(greeting.getAttribute("aria-selected")).toBe("false");
    // Still exactly one selected.
    const picker = screen.getByTestId("showcase-scene-picker");
    const selected = within(picker)
      .getAllByRole("tab")
      .filter((b) => b.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
  });

  it("the placard caption reflects the selected act", () => {
    render(<PerformanceHall />);
    // Default placard names The Greeting.
    expect(
      screen.getByTestId("showcase-proscenium").textContent,
    ).toContain("The Greeting");
    act(() => {
      fireEvent.click(screen.getByTestId("showcase-scene-pick-twirl"));
    });
    expect(
      screen.getByTestId("showcase-proscenium").textContent,
    ).toContain("The Twirl");
  });

  it("exposes the in-frame scaled scene viewport (the portal target)", () => {
    render(<PerformanceHall />);
    // One window => one scene viewport the active scene portals into.
    const viewports = screen.getAllByTestId("showcase-scene-viewport");
    expect(viewports).toHaveLength(1);
  });

  it("renders the two reveal curtains inside the window", () => {
    render(<PerformanceHall />);
    expect(
      screen.getByTestId("showcase-reveal-curtain-left"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("showcase-reveal-curtain-right"),
    ).toBeTruthy();
  });

  it("plays a curtain reveal: closed on enter, then parts open", () => {
    render(<PerformanceHall />);
    const left = () => screen.getByTestId("showcase-reveal-curtain-left");
    const right = () => screen.getByTestId("showcase-reveal-curtain-right");
    // On enter the curtains start CLOSED (covering the scene).
    expect(left().getAttribute("data-closed")).toBe("true");
    expect(right().getAttribute("data-closed")).toBe("true");
    // After the rAF + hold, the panels part to reveal the scene.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(left().getAttribute("data-closed")).toBe("false");
    expect(right().getAttribute("data-closed")).toBe("false");
  });

  it("re-plays the reveal on each scene-pick (snap closed, then part)", () => {
    render(<PerformanceHall />);
    const left = () => screen.getByTestId("showcase-reveal-curtain-left");
    // Open after the initial reveal settles.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(left().getAttribute("data-closed")).toBe("false");
    // Pick a new act: curtains snap CLOSED again for the reveal.
    act(() => {
      fireEvent.click(screen.getByTestId("showcase-scene-pick-eureka"));
    });
    expect(left().getAttribute("data-closed")).toBe("true");
    // Then part open again.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(left().getAttribute("data-closed")).toBe("false");
  });
});
