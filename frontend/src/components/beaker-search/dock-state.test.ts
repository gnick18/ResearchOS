// BeakerSearch v3 dock-state contract. Pure geometry + persistence, so the
// React shell can stay thin and the orchestrator has a deterministic gate.

import { describe, expect, it } from "vitest";
import {
  DOCK_WIDTH,
  SNAP_THRESHOLD,
  DOCK_STORAGE_KEY,
  clampPosition,
  closeDock,
  defaultFloatPos,
  endDragAt,
  ensurePlaced,
  fromPersisted,
  initialDockState,
  nearestSide,
  openDock,
  parsePersisted,
  reclampForViewport,
  resetDock,
  restingX,
  toPersisted,
  toggleCollapsed,
  toggleDock,
  tuckDecision,
  tuckDock,
  untuckDock,
  type DockState,
  type Viewport,
} from "./dock-state";

const VP: Viewport = { width: 1200, height: 800 };

describe("initial + default placement", () => {
  it("starts closed, expanded, untucked, right, unplaced", () => {
    const s = initialDockState();
    expect(s).toEqual({ open: false, collapsed: false, tucked: false, side: "right", x: null, y: null });
  });

  it("defaults to the top-right corner", () => {
    const p = defaultFloatPos(VP);
    expect(p.x).toBe(VP.width - DOCK_WIDTH - 40);
    expect(p.y).toBe(24);
  });

  it("keeps the default on screen in a very narrow viewport", () => {
    const p = defaultFloatPos({ width: 200, height: 600 });
    expect(p.x).toBeGreaterThanOrEqual(0);
  });

  it("ensurePlaced fills a concrete position once", () => {
    const placed = ensurePlaced(initialDockState(), VP);
    expect(placed.x).not.toBeNull();
    expect(placed.y).not.toBeNull();
    // Idempotent: already-placed state is returned unchanged.
    expect(ensurePlaced(placed, VP)).toBe(placed);
  });
});

describe("open / close / toggle", () => {
  it("openDock opens, places, and untucks", () => {
    const tucked: DockState = { ...initialDockState(), tucked: true };
    const s = openDock(tucked, VP);
    expect(s.open).toBe(true);
    expect(s.tucked).toBe(false);
    expect(s.x).not.toBeNull();
  });

  it("closeDock preserves geometry", () => {
    const s = openDock(initialDockState(), VP);
    const c = closeDock(s);
    expect(c.open).toBe(false);
    expect(c.x).toBe(s.x);
    expect(c.y).toBe(s.y);
  });

  it("toggleDock flips open", () => {
    const a = toggleDock(initialDockState(), VP);
    expect(a.open).toBe(true);
    const b = toggleDock(a, VP);
    expect(b.open).toBe(false);
  });
});

describe("collapse", () => {
  it("toggles the collapsed flag without touching the footprint", () => {
    const s = openDock(initialDockState(), VP);
    const c = toggleCollapsed(s);
    expect(c.collapsed).toBe(true);
    expect(c.x).toBe(s.x);
    expect(toggleCollapsed(c).collapsed).toBe(false);
  });
});

describe("clamp", () => {
  it("bounds x so the full width stays visible", () => {
    const c = clampPosition(99999, 10, VP);
    expect(c.x).toBe(VP.width - DOCK_WIDTH);
  });

  it("never goes negative", () => {
    const c = clampPosition(-50, -50, VP);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });

  it("keeps a header strip on screen at the bottom", () => {
    const c = clampPosition(10, 99999, VP);
    expect(c.y).toBe(VP.height - 44);
  });
});

describe("tuck decision + nearest side", () => {
  it("tucks right near the right edge", () => {
    const x = VP.width - DOCK_WIDTH - 10; // within SNAP_THRESHOLD of the right
    expect(tuckDecision(x, VP)).toBe("right");
  });

  it("tucks left near the left edge", () => {
    expect(tuckDecision(SNAP_THRESHOLD - 1, VP)).toBe("left");
  });

  it("does not tuck in the middle", () => {
    expect(tuckDecision(500, VP)).toBeNull();
  });

  it("right wins a corner tie", () => {
    // A tiny viewport where the dock is near both edges at once.
    const tiny: Viewport = { width: DOCK_WIDTH + 10, height: 800 };
    expect(tuckDecision(0, tiny)).toBe("right");
  });

  it("nearestSide reads the dock center", () => {
    const left: DockState = { ...initialDockState(), x: 0, y: 0 };
    const right: DockState = { ...initialDockState(), x: VP.width - DOCK_WIDTH, y: 0 };
    expect(nearestSide(left, VP)).toBe("left");
    expect(nearestSide(right, VP)).toBe("right");
  });
});

describe("tuck / untuck", () => {
  it("tuckDock parks at the resting edge x and records the side", () => {
    const s = tuckDock(openDock(initialDockState(), VP), "left", VP);
    expect(s.tucked).toBe(true);
    expect(s.side).toBe("left");
    expect(s.x).toBe(restingX("left", VP));
  });

  it("untuckDock clears tucked and rests at the side", () => {
    const tucked = tuckDock(openDock(initialDockState(), VP), "right", VP);
    const back = untuckDock(tucked, VP);
    expect(back.tucked).toBe(false);
    expect(back.x).toBe(restingX("right", VP));
  });
});

describe("endDragAt", () => {
  it("tucks when released near an edge", () => {
    const s = endDragAt(openDock(initialDockState(), VP), 5, 100, VP);
    expect(s.tucked).toBe(true);
    expect(s.side).toBe("left");
  });

  it("stays floating in the middle and stores the position", () => {
    const s = endDragAt(openDock(initialDockState(), VP), 400, 250, VP);
    expect(s.tucked).toBe(false);
    expect(s.x).toBe(400);
    expect(s.y).toBe(250);
  });
});

describe("reset + reclamp", () => {
  it("resetDock returns to the default top-right", () => {
    const moved: DockState = { ...openDock(initialDockState(), VP), x: 10, y: 10, side: "left", tucked: true };
    const r = resetDock(moved, VP);
    const p = defaultFloatPos(VP);
    expect(r.x).toBe(p.x);
    expect(r.side).toBe("right");
    expect(r.tucked).toBe(false);
  });

  it("reclampForViewport pulls an off-screen dock back in", () => {
    const off: DockState = { ...initialDockState(), x: 9000, y: 9000 };
    const r = reclampForViewport(off, VP);
    expect(r.x).toBe(VP.width - DOCK_WIDTH);
  });

  it("reclampForViewport reparks a tucked dock at its side", () => {
    const tucked: DockState = { ...initialDockState(), tucked: true, side: "right", x: 5, y: 5 };
    const r = reclampForViewport(tucked, { width: 900, height: 700 });
    expect(r.x).toBe(restingX("right", { width: 900, height: 700 }));
  });
});

describe("persistence", () => {
  it("round-trips through to/parse/fromPersisted", () => {
    const s = tuckDock(openDock(initialDockState(), VP), "left", VP);
    const raw = JSON.stringify(toPersisted(s));
    const parsed = parsePersisted(raw);
    const restored = fromPersisted(parsed);
    expect(restored.tucked).toBe(true);
    expect(restored.side).toBe("left");
    expect(restored.x).toBe(s.x);
    // open is never persisted.
    expect(restored.open).toBe(false);
  });

  it("parsePersisted tolerates garbage", () => {
    expect(parsePersisted(null)).toBeNull();
    expect(parsePersisted("not json")).toBeNull();
    expect(parsePersisted("123")).toBeNull();
    expect(parsePersisted("[]")).not.toBeNull(); // array is an object; coerced to defaults
  });

  it("parsePersisted coerces missing fields to safe defaults", () => {
    const p = parsePersisted("{}");
    expect(p).toEqual({ collapsed: false, tucked: false, side: "right", x: null, y: null });
  });

  it("fromPersisted with null keeps the initial state", () => {
    expect(fromPersisted(null)).toEqual(initialDockState());
  });

  it("exposes a stable storage key", () => {
    expect(DOCK_STORAGE_KEY).toBe("beakersearch-dock-v3");
  });
});
