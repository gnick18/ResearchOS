// Component tests for <TourSpotlight />, P3 of the Onboarding v4 arc. Covers
// the public contract from ONBOARDING_V4_PROPOSAL.md §4.3 (revised 2026-05-21:
// dim layer removed per Grant feedback, see TourSpotlight.tsx file header):
//
//  - Resolves an HTMLElement OR a CSS selector target; null = no render.
//  - Mounts via portal into document.body with ONLY the pulsing glow ring
//    (no dim strips, no cutout).
//  - Updates position on scroll + resize via requestAnimationFrame batching.
//  - Honors prefers-reduced-motion (ring stays visible, pulse animation off).
//  - Warns once when a selector doesn't resolve.
//
// jsdom doesn't ship ResizeObserver or IntersectionObserver — we stub both
// at the top of the file so the component's `new ResizeObserver(...)` /
// `new IntersectionObserver(...)` calls succeed. The stubs also expose a
// `triggerAll()` test hook so we can simulate observer callbacks.

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";

import TourSpotlight from "../TourSpotlight";

// ---- jsdom polyfills ------------------------------------------------------

class ResizeObserverStub {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    ResizeObserverStub.instances.push(this);
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  static instances: ResizeObserverStub[] = [];
  static triggerAll() {
    for (const inst of ResizeObserverStub.instances) {
      inst.callback([], inst as unknown as ResizeObserver);
    }
  }
}

class IntersectionObserverStub {
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    IntersectionObserverStub.instances.push(this);
  }
  observe = (el: Element) => {
    this.observed.push(el);
  };
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn();
  root: Element | null = null;
  rootMargin = "";
  thresholds: number[] = [];
  static instances: IntersectionObserverStub[] = [];
  static triggerLeaveAll() {
    for (const inst of IntersectionObserverStub.instances) {
      const entries = inst.observed.map(
        (target) =>
          ({
            isIntersecting: false,
            target,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRatio: 0,
            intersectionRect: new DOMRect(),
            rootBounds: null,
            time: performance.now(),
          }) as IntersectionObserverEntry
      );
      inst.callback(entries, inst as unknown as IntersectionObserver);
    }
  }
}

beforeEach(() => {
  ResizeObserverStub.instances = [];
  IntersectionObserverStub.instances = [];
  // Replace globals fresh each test so instance counters don't leak across.
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
  (
    globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }
  ).IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver;

  // Default to "no reduced motion" — individual tests override via
  // mockMatchMedia(true). matchMedia is otherwise absent from jsdom.
  mockMatchMedia(false);

  // Synchronous rAF so scheduled `measure()` calls run before assertions.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(performance.now());
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => mql as unknown as MediaQueryList,
  });
}

/** Helper — mount a target element into document.body and stub its
 *  getBoundingClientRect so the component sees a real rect. */
function mountTarget(opts: {
  id?: string;
  rect?: { left: number; top: number; width: number; height: number };
}) {
  const el = document.createElement("div");
  if (opts.id) el.id = opts.id;
  document.body.appendChild(el);
  const r = opts.rect ?? { left: 100, top: 200, width: 80, height: 40 };
  el.getBoundingClientRect = () =>
    ({
      x: r.left,
      y: r.top,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      right: r.left + r.width,
      bottom: r.top + r.height,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

describe("<TourSpotlight />", () => {
  it("renders just the glow ring (no dim strips) when given an HTMLElement target", () => {
    const target = mountTarget({ id: "anchor-a" });
    render(<TourSpotlight target={target} />);
    expect(screen.getByTestId("tour-spotlight")).toBeInTheDocument();
    expect(screen.getByTestId("tour-spotlight-ring")).toBeInTheDocument();
    // Dim layer removed 2026-05-21 (Grant feedback). None of the four
    // historical dim-strip test ids should appear in the DOM.
    expect(screen.queryByTestId("tour-spotlight-dim-top")).toBeNull();
    expect(screen.queryByTestId("tour-spotlight-dim-bottom")).toBeNull();
    expect(screen.queryByTestId("tour-spotlight-dim-left")).toBeNull();
    expect(screen.queryByTestId("tour-spotlight-dim-right")).toBeNull();
  });

  it("unmounts when target is null", () => {
    const { rerender } = render(<TourSpotlight target={null} />);
    expect(screen.queryByTestId("tour-spotlight")).toBeNull();

    const target = mountTarget({ id: "anchor-b" });
    rerender(<TourSpotlight target={target} />);
    expect(screen.getByTestId("tour-spotlight")).toBeInTheDocument();

    rerender(<TourSpotlight target={null} />);
    expect(screen.queryByTestId("tour-spotlight")).toBeNull();
  });

  it("resolves a CSS selector to an element", () => {
    mountTarget({ id: "anchor-c" });
    render(<TourSpotlight target="#anchor-c" />);
    expect(screen.getByTestId("tour-spotlight")).toBeInTheDocument();
  });

  it("renders nothing and warns once when a selector does not resolve", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(<TourSpotlight target="#nope-no-match-xyzzy" />);
    expect(screen.queryByTestId("tour-spotlight")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    // Re-render with same selector — the once-per-selector cache suppresses
    // a second console warning.
    rerender(<TourSpotlight target="#nope-no-match-xyzzy" />);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("updates spotlight position when ResizeObserver fires", () => {
    const target = mountTarget({
      id: "anchor-d",
      rect: { left: 10, top: 20, width: 100, height: 50 },
    });
    render(<TourSpotlight target={target} />);

    const ring = screen.getByTestId("tour-spotlight-ring");
    // Cutout = rect + 4px padding; ring sits 2px outside cutout.
    // initial left = 10 - 4 - 2 = 4
    expect(ring.style.left).toBe("4px");

    // Move target; trigger a ResizeObserver callback (component schedules a
    // measure via rAF, which our stub runs synchronously).
    target.getBoundingClientRect = () =>
      ({
        x: 200,
        y: 300,
        left: 200,
        top: 300,
        width: 100,
        height: 50,
        right: 300,
        bottom: 350,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      ResizeObserverStub.triggerAll();
    });

    expect(ring.style.left).toBe("194px"); // 200 - 4 - 2
  });

  it("updates spotlight position on document scroll", () => {
    const target = mountTarget({
      id: "anchor-e",
      rect: { left: 50, top: 60, width: 30, height: 30 },
    });
    render(<TourSpotlight target={target} />);
    const ring = screen.getByTestId("tour-spotlight-ring");
    expect(ring.style.top).toBe("54px"); // 60 - 4 - 2

    target.getBoundingClientRect = () =>
      ({
        x: 50,
        y: 10,
        left: 50,
        top: 10,
        width: 30,
        height: 30,
        right: 80,
        bottom: 40,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(ring.style.top).toBe("4px"); // 10 - 4 - 2
  });

  it("updates spotlight position on window resize", () => {
    const target = mountTarget({
      id: "anchor-f",
      rect: { left: 0, top: 0, width: 20, height: 20 },
    });
    render(<TourSpotlight target={target} />);
    const ring = screen.getByTestId("tour-spotlight-ring");
    const initialWidth = ring.style.width;

    target.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 200,
        height: 20,
        right: 200,
        bottom: 20,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(ring.style.width).not.toBe(initialWidth);
    // 200 + (4 padding * 2) + (2 ring offset * 2) = 212
    expect(ring.style.width).toBe("212px");
  });

  it("disables pulse animation under prefers-reduced-motion", () => {
    mockMatchMedia(true);
    const target = mountTarget({ id: "anchor-g" });
    render(<TourSpotlight target={target} />);
    const ring = screen.getByTestId("tour-spotlight-ring");
    expect(ring.dataset.reducedMotion).toBe("true");
    // The pulse keyframe name is `tourSpotlightPulse` — when reduced motion
    // is on we should be playing the fade-in animation only, not the pulse.
    expect(ring.style.animation).not.toContain("tourSpotlightPulse");
    expect(ring.style.animation).toContain("tourSpotlightFadeIn");
    // Ring must still be visually present (full-ish opacity, not 0).
    expect(ring.style.opacity).toBe("0.8");
  });

  it("plays pulse animation when reduced motion is OFF", () => {
    mockMatchMedia(false);
    const target = mountTarget({ id: "anchor-h" });
    render(<TourSpotlight target={target} />);
    const ring = screen.getByTestId("tour-spotlight-ring");
    expect(ring.dataset.reducedMotion).toBe("false");
    expect(ring.style.animation).toContain("tourSpotlightPulse");
  });

  it("calls target.scrollIntoView when target leaves the viewport", () => {
    const target = mountTarget({ id: "anchor-i" });
    const spy = vi.fn();
    target.scrollIntoView = spy;
    render(<TourSpotlight target={target} />);

    act(() => {
      IntersectionObserverStub.triggerLeaveAll();
    });
    expect(spy).toHaveBeenCalled();
  });

  // ── Popup-occlusion guard (widget tile-anatomy fix manager, 2026-05-27) ──
  //
  // SnapshotTilePopup (dashboard tile popup) stamps
  // `data-tour-popup-occluding` on its overlay root. While that
  // attribute is in the DOM the spotlight ring should disappear (the
  // popup is the active surface; pulsing on the tile beneath it would
  // be visually noisy). Once the popup unmounts the ring re-appears.

  it("hides the ring while an element with data-tour-popup-occluding is mounted", () => {
    const target = mountTarget({ id: "anchor-occluded-1" });
    render(<TourSpotlight target={target} />);
    // Sanity: ring visible before any popup mounts.
    expect(screen.getByTestId("tour-spotlight-ring")).toBeInTheDocument();

    // Mount the popup marker + dispatch the open event the way
    // SnapshotTilePopup does.
    const popup = document.createElement("div");
    popup.setAttribute("data-tour-popup-occluding", "snapshot-tile");
    document.body.appendChild(popup);
    act(() => {
      window.dispatchEvent(new CustomEvent("tour:snapshot-tile-popup-opened"));
    });
    expect(screen.queryByTestId("tour-spotlight-ring")).toBeNull();

    // Unmount the popup + dispatch the close event. Ring re-appears.
    popup.remove();
    act(() => {
      window.dispatchEvent(new CustomEvent("tour:snapshot-tile-popup-closed"));
    });
    expect(screen.getByTestId("tour-spotlight-ring")).toBeInTheDocument();
  });

  it("seeds occlusion from the DOM when the spotlight mounts mid-popup", () => {
    // A popup is already mounted (the controller pushed the spotlight
    // mid-step, e.g. on tour resume into an open dashboard popup). The
    // initial render must seed occlusion=true from the DOM, not from
    // the event.
    const popup = document.createElement("div");
    popup.setAttribute("data-tour-popup-occluding", "snapshot-tile");
    document.body.appendChild(popup);
    try {
      const target = mountTarget({ id: "anchor-occluded-2" });
      render(<TourSpotlight target={target} />);
      // Ring should be suppressed on first paint.
      expect(screen.queryByTestId("tour-spotlight-ring")).toBeNull();
    } finally {
      popup.remove();
    }
  });
});
