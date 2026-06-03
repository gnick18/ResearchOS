/**
 * Bubble-flip tests for the TourBeakerBotOverlay (overnight bubble-flip
 * sub-bot, 2026-05-26).
 *
 * Problem: the BeakerBot overlay (mascot + speech bubble) lives anchored
 * bottom-right. When a step's interaction target ALSO lands in the
 * bottom-right viewport quadrant (e.g. the Add-widget catalog popup, or
 * a cursor demo poking a button down there), the bubble visually covers
 * what BeakerBot is supposed to be demonstrating.
 *
 * Tests below cover:
 *   1. Pure helper `computeBubbleAnchorSide` — no overlap returns
 *      "right" (default), spotlight-side overlap flips to "left",
 *      popup-rect overlap flips to "left", cursor-rect overlap flips
 *      to "left", and two-sided occlusion picks the side with more
 *      clearance.
 *   2. `getBubbleDangerRect` — basic shape and right/left mirroring.
 *   3. `rectsOverlap` — sanity guards.
 *   4. Integration: render the TourController in a tour-active state,
 *      mock viewport size + create a DOM element where the spotlight
 *      selector resolves so the predicate flips the anchor side and
 *      the rendered overlay's `data-bubble-anchor-side` attribute
 *      changes from "right" to "left".
 */
import { act, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

// Mirror the cursor mock from TourController.test.tsx so the in-product
// walkthrough overlay can mount without driving real cursor scripts.
vi.mock("@/components/BeakerBotCursor", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  const MockCursor = forwardRef<unknown>(function MockCursor(_, ref) {
    useImperativeHandle(
      ref,
      () => ({
        glideTo: () => Promise.resolve(),
        clickAt: () => Promise.resolve(),
        typeInto: () => Promise.resolve(),
        dragFromTo: () => Promise.resolve(),
        dragFile: () => Promise.resolve(),
        hide: () => {},
        show: () => {},
        runScript: () => Promise.resolve(),
        snapTo: () => {},
      }),
      [],
    );
    return null;
  });
  return { default: MockCursor };
});

const pushMock = vi.fn();
let mockPathname = "/";
function setMockPathname(p: string): void {
  mockPathname = p;
}
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => mockPathname,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));
vi.mock("@/lib/file-system/user-discovery", () => ({
  discoverUsers: async () => [] as string[],
}));

import {
  TourControllerProvider,
  useTourController,
  computeBubbleAnchorSide,
  getBubbleDangerRect,
  rectsOverlap,
  type BubbleAnchorSide,
} from "../TourController";

function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "no",
    calendar: "no",
    goals: "no",
    telegram: "no",
    ai_helper: "no",
    ...over,
  };
}

function wrapper(initialPicks?: FeaturePicks | null) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <TourControllerProvider initialFeaturePicks={initialPicks ?? null}>
        {children}
      </TourControllerProvider>
    );
  };
}

beforeEach(() => {
  pushMock.mockClear();
  window.history.pushState({}, "", "/");
  setMockPathname("/");
});

afterEach(() => {
  window.history.pushState({}, "", "/");
  setMockPathname("/");
});

// Standard test viewport size used by the helper-level specs below.
const VW = 1440;
const VH = 900;

// ---------------------------------------------------------------------------
// Pure helper specs — no DOM, no hooks. These exercise the math directly.
// ---------------------------------------------------------------------------

describe("computeBubbleAnchorSide — pure helper", () => {
  it("returns 'right' when no targets are provided (default resting state)", () => {
    expect(computeBubbleAnchorSide([], VW, VH)).toBe("right");
  });

  it("returns 'right' when no target overlaps the right-anchored bubble zone", () => {
    // Target in the top-left of the viewport — nowhere near the
    // bottom-right danger zone.
    const target = { left: 100, top: 100, right: 200, bottom: 200 };
    expect(computeBubbleAnchorSide([target], VW, VH)).toBe("right");
  });

  it("flips to 'left' when the spotlight target overlaps the right zone", () => {
    // Target square sitting squarely on top of where the right-
    // anchored bubble would land (bottom-right of viewport).
    const target = {
      left: VW - 200,
      top: VH - 200,
      right: VW - 50,
      bottom: VH - 100,
    };
    expect(computeBubbleAnchorSide([target], VW, VH)).toBe("left");
  });

  it("flips to 'left' when a popup rect (large bottom-right surface) overlaps", () => {
    // Simulate the home-widget-catalog popup: a tall ~400x500 surface
    // anchored near the bottom-right corner.
    const popup = {
      left: VW - 460,
      top: VH - 600,
      right: VW - 60,
      bottom: VH - 80,
    };
    expect(computeBubbleAnchorSide([popup], VW, VH)).toBe("left");
  });

  it("flips to 'left' when the cursor rect lands inside the right zone", () => {
    // The BeakerBotCursor wrapper is only 28x28, but its top-left
    // corner sits at the click target's center. A cursor mid-demo
    // hovering on a bottom-right button still represents a "BeakerBot
    // is doing something here" zone — the predicate treats the 28x28
    // square as a real interaction rect.
    const cursorRect = {
      left: VW - 100,
      top: VH - 200,
      right: VW - 72,
      bottom: VH - 172,
    };
    expect(computeBubbleAnchorSide([cursorRect], VW, VH)).toBe("left");
  });

  it("stays 'right' when the only target is in the bottom-LEFT zone (no occlusion)", () => {
    // A bottom-left target should NOT trigger a flip — the right-
    // anchored bubble doesn't overlap it.
    const target = { left: 50, top: VH - 200, right: 250, bottom: VH - 100 };
    expect(computeBubbleAnchorSide([target], VW, VH)).toBe("right");
  });

  it("two-sided occlusion: picks the side with more clearance from the closest target", () => {
    // Target spans most of the viewport bottom strip, but its center
    // sits much closer to the right edge than the left. The left side
    // therefore has more horizontal clearance and should win the flip.
    const wideTarget = {
      left: 400,
      top: VH - 250,
      right: VW - 60,
      bottom: VH - 100,
    };
    // Both right-anchored AND left-anchored zones overlap (target
    // covers most of the bottom strip), so the helper falls through to
    // the clearance-tiebreak branch.
    expect(computeBubbleAnchorSide([wideTarget], VW, VH)).toBe("left");
  });

  it("filters out invalid / zero-area rects so a stale measurement can't false-flip", () => {
    const zero = { left: 0, top: 0, right: 0, bottom: 0 };
    const offscreen = { left: NaN, top: 0, right: 10, bottom: 10 };
    // Both should be ignored. With no valid targets we get the default.
    expect(computeBubbleAnchorSide([zero, offscreen], VW, VH)).toBe("right");
  });
});

describe("getBubbleDangerRect — pure helper", () => {
  it("right side rect sits in the bottom-right quadrant", () => {
    const r = getBubbleDangerRect("right", VW, VH);
    expect(r.right).toBeLessThan(VW); // not flush against the viewport edge
    expect(r.right).toBeGreaterThan(VW * 0.95); // but in the right edge area
    expect(r.bottom).toBeLessThan(VH);
    expect(r.left).toBeLessThan(r.right);
    expect(r.top).toBeLessThan(r.bottom);
  });

  it("left side rect mirrors the right side around the viewport center", () => {
    const r = getBubbleDangerRect("right", VW, VH);
    const l = getBubbleDangerRect("left", VW, VH);
    // Same vertical extent.
    expect(l.top).toBe(r.top);
    expect(l.bottom).toBe(r.bottom);
    // Same width.
    expect(l.right - l.left).toBe(r.right - r.left);
    // Left rect sits in the left edge area.
    expect(l.left).toBeLessThan(VW * 0.05);
  });
});

describe("rectsOverlap — pure helper", () => {
  it("returns true for overlapping rects", () => {
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 50, top: 50, right: 150, bottom: 150 },
      ),
    ).toBe(true);
  });
  it("returns false for disjoint rects", () => {
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 200, top: 200, right: 300, bottom: 300 },
      ),
    ).toBe(false);
  });
  it("returns false when rects only touch on an edge", () => {
    // Strict non-overlap on shared edges — flush-against-each-other is
    // not visual occlusion.
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 100, top: 0, right: 200, bottom: 100 },
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: render the in-product walkthrough overlay, plant a fake
// spotlight target in the DOM at the bottom-right of the viewport, and
// assert the anchor flips. We use the `home-widgets-add` step because
// its `targetSelector` resolves to a known data-tour-target value, and
// we render an element carrying that attribute INSIDE a popup-like
// ancestor so the popup-rect path also activates.
// ---------------------------------------------------------------------------

describe("TourBeakerBotOverlay — anchor flips when interaction target overlaps", () => {
  // jsdom's default window dimensions are 1024x768. We pin a known
  // viewport so the helper's rect math is deterministic across the
  // pure-helper specs above and the integration spec below.
  beforeAll(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: VW,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: VH,
    });
  });

  it("renders the overlay with right anchor when no interaction target is present", () => {
    const { result } = renderHook(() => useTourController(), {
      wrapper: wrapper(picks()),
    });
    // Welcome step is a setup-modal step (no in-product overlay). Use a
    // walkthrough step with no resolvable targetSelector in the DOM
    // (the home-create-project step's anchor isn't present, so the
    // spotlight resolves to null and the predicate stays in the
    // default right state).
    act(() => result.current.start("home-create-project"));
    const overlay = document.body.querySelector(
      "[data-testid='tour-beakerbot-overlay']",
    );
    expect(overlay).toBeTruthy();
    // Default resting state.
    expect(overlay?.getAttribute("data-bubble-anchor-side")).toBe("right");
  });

  it("flips to the left anchor when the spotlight target sits in the bottom-right danger zone", async () => {
    // Plant a fake spotlight target at the bottom-right of the
    // viewport. We mock the target element's getBoundingClientRect to
    // return a deterministic bottom-right rect (jsdom layouts to 0x0
    // by default, which would never trigger the predicate).
    //
    // Widget-framework teardown v2 (2026-06-02): the prior fixture used the
    // deleted `home-widgets-add` step (target `home-widget-add-button`). Use
    // the surviving §6.1 FILL beat instead — its spotlight points at the
    // create-project form (data-tour-target="home-project-create-form").
    const createForm = document.createElement("div");
    createForm.setAttribute("data-tour-target", "home-project-create-form");
    // Wrap in a dialog ancestor so the popup-detection path also lights up,
    // exercising both the spotlight-rect and popup-rect targets in one spec.
    const popupAncestor = document.createElement("div");
    popupAncestor.setAttribute("role", "dialog");
    popupAncestor.setAttribute("data-tour-target", "home-project-create-form");
    popupAncestor.appendChild(createForm);
    document.body.appendChild(popupAncestor);

    const targetRect = {
      left: VW - 200,
      top: VH - 300,
      right: VW - 50,
      bottom: VH - 150,
      width: 150,
      height: 150,
      x: VW - 200,
      y: VH - 300,
      toJSON: () => ({}),
    } as DOMRect;
    const popupRect = {
      left: VW - 460,
      top: VH - 600,
      right: VW - 60,
      bottom: VH - 80,
      width: 400,
      height: 520,
      x: VW - 460,
      y: VH - 600,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(createForm, "getBoundingClientRect").mockReturnValue(
      targetRect,
    );
    vi.spyOn(popupAncestor, "getBoundingClientRect").mockReturnValue(popupRect);

    try {
      const { result } = renderHook(() => useTourController(), {
        wrapper: wrapper(picks()),
      });
      // `home-create-project-fill` is the surviving step whose spotlight
      // points at the create-project form
      // (data-tour-target="home-project-create-form") — the same selector
      // our planted element carries. Start the tour at this step so the
      // overlay reads our planted DOM.
      act(() => result.current.start("home-create-project-fill"));
      // The hook schedules its first compute via rAF. Allow a couple
      // of frames + microtasks to land so the MutationObserver +
      // initial rAF fire and the side state settles.
      await act(async () => {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await Promise.resolve();
      });

      const overlay = document.body.querySelector(
        "[data-testid='tour-beakerbot-overlay']",
      );
      expect(overlay).toBeTruthy();
      expect(overlay?.getAttribute("data-bubble-anchor-side")).toBe("left");
    } finally {
      popupAncestor.remove();
    }
  });

  it("popup-rect path: flips when a standalone role='dialog' covers the bottom-right zone (no spotlight)", async () => {
    // No spotlight target — a step body without a resolvable selector
    // — but a free-standing dialog is open in the bottom-right. The
    // popup-scan path (the second querySelectorAll dialogs sweep in
    // the hook) should still pick this up and flip.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    const dialogRect = {
      left: VW - 460,
      top: VH - 600,
      right: VW - 60,
      bottom: VH - 80,
      width: 400,
      height: 520,
      x: VW - 460,
      y: VH - 600,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(dialogRect);

    try {
      const { result } = renderHook(() => useTourController(), {
        wrapper: wrapper(picks()),
      });
      // home-create-project has no resolvable target in our fixture
      // DOM, so the spotlight rect is null and only the dialog-scan
      // path can drive the flip.
      act(() => result.current.start("home-create-project"));
      await act(async () => {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await Promise.resolve();
      });

      const overlay = document.body.querySelector(
        "[data-testid='tour-beakerbot-overlay']",
      );
      expect(overlay).toBeTruthy();
      expect(overlay?.getAttribute("data-bubble-anchor-side")).toBe("left");
    } finally {
      dialog.remove();
    }
  });
});

// Helper for the cursor-rect path: assert the type compiles without
// triggering a runtime hook call. The integration above already covers
// the cursor branch indirectly via the popup-flip test (cursor stays
// inactive there); a dedicated DOM-active-cursor test would require
// wiring an actual cursor mock that mounts a `[data-beakerbot-cursor]`
// node, which is more plumbing than the predicate is worth. The pure-
// helper spec "flips to 'left' when the cursor rect lands inside the
// right zone" above already covers the cursor-rect branch of
// `computeBubbleAnchorSide` directly.
const _typeOnly: BubbleAnchorSide = "left";
void _typeOnly;
