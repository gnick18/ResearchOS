// BeakerSearch v3 dock-state contract. Pure geometry + persistence, so the
// React shell can stay thin and the orchestrator has a deterministic gate.

import { describe, expect, it } from "vitest";
import {
  ARM_OVERSHOOT,
  DOCK_WIDTH,
  DOCK_STORAGE_KEY,
  applyArrowKey,
  armedWall,
  arrowToSide,
  clampPosition,
  closeDock,
  defaultFloatPos,
  endDrag,
  ensurePlaced,
  fromPersisted,
  initialDockState,
  nearestSide,
  openDock,
  oppositeSide,
  parsePersisted,
  reclampForViewport,
  resetDock,
  restingPos,
  toPersisted,
  toggleCollapsed,
  toggleDock,
  tuckDock,
  untuckDock,
  type DockState,
  type Viewport,
} from "./dock-state";

const VP: Viewport = { width: 1200, height: 800 };
const H = 420; // a representative measured dock height

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
    expect(toggleDock(a, VP).open).toBe(false);
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
    expect(clampPosition(99999, 10, VP).x).toBe(VP.width - DOCK_WIDTH);
  });
  it("never goes negative", () => {
    const c = clampPosition(-50, -50, VP);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });
  it("keeps a header strip on screen at the bottom", () => {
    expect(clampPosition(10, 99999, VP).y).toBe(VP.height - 44);
  });
  it("keeps the whole height on screen when a height is given", () => {
    expect(clampPosition(10, 99999, VP, 44, H).y).toBe(VP.height - H);
  });
});

describe("armedWall (overshoot, not proximity)", () => {
  it("does NOT arm merely near an edge (must be pushed past the wall)", () => {
    // 10px short of the right wall: on screen, so no arm.
    const x = VP.width - DOCK_WIDTH - 10;
    expect(armedWall(x, 100, VP, H)).toBeNull();
    // Exactly flush, still within ARM_OVERSHOOT: no arm.
    expect(armedWall(VP.width - DOCK_WIDTH + ARM_OVERSHOOT - 1, 100, VP, H)).toBeNull();
  });

  it("arms right when pushed past the right wall", () => {
    expect(armedWall(VP.width - DOCK_WIDTH + 30, 100, VP, H)).toBe("right");
  });
  it("arms left when pushed past the left wall", () => {
    expect(armedWall(-30, 100, VP, H)).toBe("left");
  });
  it("arms top when pushed past the top wall", () => {
    expect(armedWall(400, -30, VP, H)).toBe("top");
  });
  it("arms bottom when pushed past the bottom wall", () => {
    expect(armedWall(400, VP.height - H + 30, VP, H)).toBe("bottom");
  });
  it("picks the wall with the largest overshoot", () => {
    // Pushed far past the left and slightly past the top: left wins.
    expect(armedWall(-200, -10, VP, H)).toBe("left");
  });
});

describe("nearest side (4-way)", () => {
  it("reads the dock footprint distance to each wall", () => {
    const left: DockState = { ...initialDockState(), x: 0, y: 300 };
    const right: DockState = { ...initialDockState(), x: VP.width - DOCK_WIDTH, y: 300 };
    const top: DockState = { ...initialDockState(), x: 400, y: 0 };
    const bottom: DockState = { ...initialDockState(), x: 400, y: VP.height - H };
    expect(nearestSide(left, VP, H)).toBe("left");
    expect(nearestSide(right, VP, H)).toBe("right");
    expect(nearestSide(top, VP, H)).toBe("top");
    expect(nearestSide(bottom, VP, H)).toBe("bottom");
  });
});

describe("tuck / untuck (4 sides)", () => {
  it("tucks left, pinning x to the inset and keeping y", () => {
    const base = { ...openDock(initialDockState(), VP), y: 200 };
    const s = tuckDock(base, "left", VP, H);
    expect(s.tucked).toBe(true);
    expect(s.side).toBe("left");
    expect(s.x).toBe(restingPos("left", base, VP, H).x);
    expect(s.x).toBe(16);
  });

  it("tucks bottom, pinning y to the bottom inset and keeping x", () => {
    const base = { ...openDock(initialDockState(), VP), x: 400, y: 100 };
    const s = tuckDock(base, "bottom", VP, H);
    expect(s.side).toBe("bottom");
    expect(s.y).toBe(VP.height - H - 16);
    expect(s.x).toBe(400);
  });

  it("untuckDock clears tucked and rests at the side", () => {
    const tucked = tuckDock(openDock(initialDockState(), VP), "top", VP, H);
    const back = untuckDock(tucked, VP, H);
    expect(back.tucked).toBe(false);
    expect(back.y).toBe(16);
  });
});

describe("endDrag (desired position, overshoot decides hide)", () => {
  it("hides when the release was pushed past a wall", () => {
    const s = endDrag(openDock(initialDockState(), VP), -30, 100, VP, H);
    expect(s.tucked).toBe(true);
    expect(s.side).toBe("left");
  });
  it("stays floating in the middle and stores the clamped position", () => {
    const s = endDrag(openDock(initialDockState(), VP), 400, 250, VP, H);
    expect(s.tucked).toBe(false);
    expect(s.x).toBe(400);
    expect(s.y).toBe(250);
  });
  it("does not hide when merely flush (no overshoot)", () => {
    const s = endDrag(openDock(initialDockState(), VP), VP.width - DOCK_WIDTH, 100, VP, H);
    expect(s.tucked).toBe(false);
  });
});

describe("arrow-key control", () => {
  it("maps arrows to walls and finds opposites", () => {
    expect(arrowToSide("ArrowLeft")).toBe("left");
    expect(arrowToSide("ArrowDown")).toBe("bottom");
    expect(arrowToSide("Enter")).toBeNull();
    expect(oppositeSide("right")).toBe("left");
    expect(oppositeSide("top")).toBe("bottom");
  });

  it("a floating dock hides toward the arrow's wall", () => {
    const f = openDock(initialDockState(), VP);
    expect(applyArrowKey(f, "ArrowLeft", VP, H)?.side).toBe("left");
    expect(applyArrowKey(f, "ArrowUp", VP, H)?.tucked).toBe(true);
    expect(applyArrowKey(f, "Enter", VP, H)).toBeNull();
  });

  it("a tucked dock comes back only on the away-arrow", () => {
    const tuckedRight = tuckDock(openDock(initialDockState(), VP), "right", VP, H);
    expect(applyArrowKey(tuckedRight, "ArrowLeft", VP, H)?.tucked).toBe(false); // away
    expect(applyArrowKey(tuckedRight, "ArrowRight", VP, H)).toBeNull(); // into the wall
    expect(applyArrowKey(tuckedRight, "ArrowUp", VP, H)).toBeNull(); // unrelated
  });
});

describe("reset + reclamp", () => {
  it("resetDock returns to the default top-right", () => {
    const moved: DockState = { ...openDock(initialDockState(), VP), x: 10, y: 10, side: "left", tucked: true };
    const r = resetDock(moved, VP);
    expect(r.x).toBe(defaultFloatPos(VP).x);
    expect(r.side).toBe("right");
    expect(r.tucked).toBe(false);
  });

  it("reclampForViewport pulls an off-screen dock back in", () => {
    const off: DockState = { ...initialDockState(), x: 9000, y: 9000 };
    expect(reclampForViewport(off, VP, H).x).toBe(VP.width - DOCK_WIDTH);
  });

  it("reclampForViewport reparks a tucked dock at its side", () => {
    const tucked: DockState = { ...initialDockState(), tucked: true, side: "right", x: 5, y: 5 };
    const small: Viewport = { width: 900, height: 700 };
    expect(reclampForViewport(tucked, small, H).x).toBe(restingPos("right", tucked, small, H).x);
  });
});

describe("persistence", () => {
  it("round-trips a tucked-bottom state", () => {
    const s = tuckDock(openDock(initialDockState(), VP), "bottom", VP, H);
    const restored = fromPersisted(parsePersisted(JSON.stringify(toPersisted(s))));
    expect(restored.tucked).toBe(true);
    expect(restored.side).toBe("bottom");
    expect(restored.y).toBe(s.y);
    expect(restored.open).toBe(false);
  });

  it("parsePersisted tolerates garbage", () => {
    expect(parsePersisted(null)).toBeNull();
    expect(parsePersisted("not json")).toBeNull();
    expect(parsePersisted("123")).toBeNull();
    expect(parsePersisted("[]")).not.toBeNull();
  });

  it("parsePersisted accepts all four sides and coerces the rest", () => {
    expect(parsePersisted('{"side":"top"}')?.side).toBe("top");
    expect(parsePersisted('{"side":"bogus"}')?.side).toBe("right");
    expect(parsePersisted("{}")).toEqual({ collapsed: false, tucked: false, side: "right", x: null, y: null });
  });

  it("fromPersisted with null keeps the initial state", () => {
    expect(fromPersisted(null)).toEqual(initialDockState());
  });

  it("exposes a stable storage key", () => {
    expect(DOCK_STORAGE_KEY).toBe("beakersearch-dock-v3");
  });
});
