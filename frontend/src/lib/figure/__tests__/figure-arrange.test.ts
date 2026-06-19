import { describe, expect, it } from "vitest";
import {
  createFigurePage,
  type Annotation,
  type FigurePage,
  type FigurePanel,
  type PlacedAsset,
} from "@/lib/figure/figure-page";
import {
  alignElements,
  bringToFront,
  computeSnap,
  distributeElements,
  distributeSpacing,
  duplicateElements,
  elementBox,
  elementsInRect,
  flipElements,
  groupMates,
  isElementHidden,
  isElementLocked,
  listElements,
  refKey,
  sendToBack,
  setElementHidden,
  setElementLocked,
  setElementSize,
  setGroupId,
  unionBox,
  type ElementRef,
} from "@/lib/figure/figure-arrange";

function panel(id: string, xIn: number, yIn: number, wIn = 1, hIn = 1): FigurePanel {
  return { panelId: id, ref: { type: "seq", id: "s1" }, xIn, yIn, wIn, hIn };
}
function asset(id: string, xIn: number, yIn: number, wIn = 0.5, hIn = 0.5): PlacedAsset {
  return {
    assetId: id,
    ref: { source: "bioicons", sourceId: "x" },
    svgPath: "a.svg",
    xIn,
    yIn,
    wIn,
    hIn,
    credit: "c",
    requiresAttribution: false,
  };
}
function textAnn(id: string, xIn: number, yIn: number): Annotation {
  return { annId: id, kind: "text", xIn, yIn, text: "hi", fontPt: 12 };
}

function pageWith(
  panels: FigurePanel[] = [],
  assets: PlacedAsset[] = [],
  annotations: Annotation[] = [],
): FigurePage {
  return { ...createFigurePage("p1", "P", null), panels, assets, annotations };
}

const pRef = (id: string): ElementRef => ({ kind: "panel", id });

describe("element model + boxes", () => {
  it("lists every element kind in render order", () => {
    const page = pageWith([panel("a", 0, 0)], [asset("b", 1, 1)], [textAnn("c", 2, 2)]);
    expect(listElements(page).map(refKey)).toEqual(["panel:a", "asset:b", "annotation:c"]);
  });

  it("reads panel + asset boxes directly", () => {
    const page = pageWith([panel("a", 1, 2, 3, 4)], [asset("b", 5, 6, 0.5, 0.5)]);
    expect(elementBox(page, pRef("a"))).toEqual({ xIn: 1, yIn: 2, wIn: 3, hIn: 4 });
    expect(elementBox(page, { kind: "asset", id: "b" })).toEqual({ xIn: 5, yIn: 6, wIn: 0.5, hIn: 0.5 });
  });

  it("returns null for a stale ref", () => {
    expect(elementBox(pageWith(), pRef("nope"))).toBeNull();
  });

  it("computes the union box across kinds", () => {
    const page = pageWith([panel("a", 0, 0, 1, 1)], [asset("b", 3, 3, 1, 1)]);
    expect(unionBox(page, [pRef("a"), { kind: "asset", id: "b" }])).toEqual({
      xIn: 0,
      yIn: 0,
      wIn: 4,
      hIn: 4,
    });
  });
});

describe("align", () => {
  it("aligns left edges to the selection bounding box", () => {
    const page = pageWith([panel("a", 1, 0), panel("b", 5, 0), panel("c", 3, 0)]);
    const out = alignElements(page, [pRef("a"), pRef("b"), pRef("c")], "left");
    expect(out.panels.map((p) => p.xIn)).toEqual([1, 1, 1]);
  });

  it("aligns right edges (accounts for differing widths)", () => {
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("b", 0, 2, 3, 1)]);
    const out = alignElements(page, [pRef("a"), pRef("b")], "right");
    // selection right edge = 3; a (w1) -> x=2, b (w3) -> x=0
    expect(out.panels.map((p) => p.xIn)).toEqual([2, 0]);
  });

  it("centers horizontally", () => {
    const page = pageWith([panel("a", 0, 0, 2, 1), panel("b", 0, 2, 4, 1)]);
    const out = alignElements(page, [pRef("a"), pRef("b")], "centerX");
    // union center x = 2; a -> 1, b -> 0
    expect(out.panels.map((p) => p.xIn)).toEqual([1, 0]);
  });

  it("is a no-op for a single element", () => {
    const page = pageWith([panel("a", 1, 1)]);
    expect(alignElements(page, [pRef("a")], "left")).toBe(page);
  });
});

describe("distribute (legacy 2-axis signature removed; new 6-anchor)", () => {
  it("distributes by left edges for 3 elements", () => {
    // a: x=0,w=1; m: x=3,w=2; z: x=9,w=1
    // Left anchors: 0, 3, 9. Step = (9-0)/2 = 4.5
    // a stays at 0, m moves to 4.5, z stays at 9.
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("m", 3, 0, 2, 1), panel("z", 9, 0, 1, 1)]);
    const out = distributeElements(page, [pRef("a"), pRef("m"), pRef("z")], "left");
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.xIn]));
    expect(byId.a).toBeCloseTo(0);
    expect(byId.m).toBeCloseTo(4.5);
    expect(byId.z).toBeCloseTo(9);
  });

  it("distributes by horizontal centers for 3 equal-width elements", () => {
    // All width=1; centers at 0.5, 2.5, 9.5. Step = (9.5-0.5)/2 = 4.5
    // a center stays 0.5 (x=0), m center -> 5 (x=4.5), z center stays 9.5 (x=9).
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("m", 2, 0, 1, 1), panel("z", 9, 0, 1, 1)]);
    const out = distributeElements(page, [pRef("a"), pRef("m"), pRef("z")], "centerX");
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.xIn]));
    expect(byId.a).toBeCloseTo(0);
    expect(byId.m).toBeCloseTo(4.5);
    expect(byId.z).toBeCloseTo(9);
  });

  it("distributes by right edges for 3 elements", () => {
    // a: x=0,w=1 -> right=1; m: x=2,w=2 -> right=4; z: x=8,w=2 -> right=10.
    // Step = (10-1)/2 = 4.5. m right -> 5.5 => x = 5.5-2 = 3.5.
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("m", 2, 0, 2, 1), panel("z", 8, 0, 2, 1)]);
    const out = distributeElements(page, [pRef("a"), pRef("m"), pRef("z")], "right");
    const mPanel = out.panels.find((p) => p.panelId === "m")!;
    expect(mPanel.xIn + mPanel.wIn).toBeCloseTo(5.5);
  });

  it("distributes vertically by top edges", () => {
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("m", 0, 2, 1, 3), panel("z", 0, 9, 1, 1)]);
    const out = distributeElements(page, [pRef("a"), pRef("m"), pRef("z")], "top");
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.yIn]));
    expect(byId.a).toBeCloseTo(0);
    expect(byId.m).toBeCloseTo(4.5);
    expect(byId.z).toBeCloseTo(9);
  });

  it("distributes by vertical centers", () => {
    // a: y=0,h=2 -> center=1; m: y=4,h=2 -> center=5; z: y=8,h=2 -> center=9.
    // Step = (9-1)/2 = 4. m center -> 5. Already there. Use asymmetric layout instead.
    // a: y=0,h=1 center=0.5; m: y=5,h=3 center=6.5; z: y=10,h=1 center=10.5
    // Step = (10.5-0.5)/2 = 5. m center -> 5.5 => y = 5.5 - 1.5 = 4
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("m", 0, 5, 1, 3), panel("z", 0, 10, 1, 1)]);
    const out = distributeElements(page, [pRef("a"), pRef("m"), pRef("z")], "centerY");
    const mPanel = out.panels.find((p) => p.panelId === "m")!;
    expect(mPanel.yIn + mPanel.hIn / 2).toBeCloseTo(5.5);
  });

  it("needs at least 3 elements", () => {
    const page = pageWith([panel("a", 0, 0), panel("b", 5, 0)]);
    expect(distributeElements(page, [pRef("a"), pRef("b")], "left")).toBe(page);
  });
});

describe("distributeSpacing (equal gap)", () => {
  it("spaces 3 elements with a 1-inch horizontal gap", () => {
    // a: x=0,w=1; m: x=3,w=2; z: x=8,w=1
    // After: a stays at x=0; m starts at 0+1+1=2, w=2; z starts at 2+2+1=5, w=1.
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("m", 3, 0, 2, 1), panel("z", 8, 0, 1, 1)]);
    const out = distributeSpacing(page, [pRef("a"), pRef("m"), pRef("z")], "horizontal", 1);
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.xIn]));
    expect(byId.a).toBeCloseTo(0);
    expect(byId.m).toBeCloseTo(2);
    expect(byId.z).toBeCloseTo(5);
  });

  it("spaces 3 elements with 0 horizontal gap (touching)", () => {
    // a: x=1,w=2; m: x=5,w=1; z: x=9,w=3
    // After: a x=1; m x=1+2+0=3; z x=3+1+0=4.
    const page = pageWith([panel("a", 1, 0, 2, 1), panel("m", 5, 0, 1, 1), panel("z", 9, 0, 3, 1)]);
    const out = distributeSpacing(page, [pRef("a"), pRef("m"), pRef("z")], "horizontal", 0);
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.xIn]));
    expect(byId.a).toBeCloseTo(1);
    expect(byId.m).toBeCloseTo(3);
    expect(byId.z).toBeCloseTo(4);
  });

  it("spaces 3 elements with a 0.5-inch vertical gap", () => {
    // a: y=0,h=1; m: y=5,h=2; z: y=10,h=1
    // After: a y=0; m y=0+1+0.5=1.5; z y=1.5+2+0.5=4.
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("m", 0, 5, 1, 2), panel("z", 0, 10, 1, 1)]);
    const out = distributeSpacing(page, [pRef("a"), pRef("m"), pRef("z")], "vertical", 0.5);
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.yIn]));
    expect(byId.a).toBeCloseTo(0);
    expect(byId.m).toBeCloseTo(1.5);
    expect(byId.z).toBeCloseTo(4);
  });

  it("requires at least 2 elements", () => {
    const page = pageWith([panel("a", 0, 0)]);
    expect(distributeSpacing(page, [pRef("a")], "horizontal", 1)).toBe(page);
  });
});

describe("alignElements with AlignTarget", () => {
  it("aligns to page left edge (target=page)", () => {
    const page = pageWith([panel("a", 3, 1), panel("b", 5, 2)]);
    const out = alignElements(page, [pRef("a"), pRef("b")], "left", {
      target: "page",
      pageWIn: 8,
      pageHIn: 6,
    });
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.xIn]));
    expect(byId.a).toBeCloseTo(0);
    expect(byId.b).toBeCloseTo(0);
  });

  it("centers on the page horizontally (target=page)", () => {
    // Page width=10; each panel w=2; center of page=5; element center -> 5 -> x=4.
    const page = pageWith([panel("a", 0, 0, 2, 1), panel("b", 7, 0, 2, 1)]);
    const out = alignElements(page, [pRef("a"), pRef("b")], "centerX", {
      target: "page",
      pageWIn: 10,
      pageHIn: 8,
    });
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.xIn]));
    expect(byId.a).toBeCloseTo(4);
    expect(byId.b).toBeCloseTo(4);
  });

  it("aligns to a key object's left edge (target=key)", () => {
    // keyRef=b at x=6; a at x=1 should move to x=6.
    const page = pageWith([panel("a", 1, 0, 2, 1), panel("b", 6, 0, 2, 1)]);
    const out = alignElements(page, [pRef("a"), pRef("b")], "left", {
      target: "key",
      keyRef: { kind: "panel", id: "b" },
    });
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.xIn]));
    // b is the key object and must not move.
    expect(byId.b).toBeCloseTo(6);
    // a aligns its left edge to key left (6).
    expect(byId.a).toBeCloseTo(6);
  });

  it("key object does not move (target=key)", () => {
    const page = pageWith([panel("a", 0, 0, 1, 2), panel("b", 4, 1, 3, 2)]);
    const out = alignElements(page, [pRef("a"), pRef("b")], "centerY", {
      target: "key",
      keyRef: { kind: "panel", id: "b" },
    });
    const bPanel = out.panels.find((p) => p.panelId === "b")!;
    expect(bPanel.yIn).toBeCloseTo(1);
  });

  it("falls back to selection behavior when target=selection (default)", () => {
    const page = pageWith([panel("a", 1, 0), panel("b", 5, 0), panel("c", 3, 0)]);
    const out = alignElements(page, [pRef("a"), pRef("b"), pRef("c")], "left");
    expect(out.panels.map((p) => p.xIn)).toEqual([1, 1, 1]);
  });
});

describe("smart-guide snap", () => {
  it("snaps a left edge to another element's left edge within threshold", () => {
    // mover is wide (w=3) so only its LEFT edge falls near a target -> deterministic.
    const page = pageWith([panel("anchor", 2, 0, 1, 1), panel("mover", 0, 5, 3, 1)]);
    const r = computeSnap(page, pRef("mover"), { xIn: 2.03, yIn: 5, wIn: 3, hIn: 1 });
    expect(r.dxIn).toBeCloseTo(-0.03);
    expect(r.guides.some((g) => g.axis === "x" && Math.abs(g.atIn - 2) < 1e-9)).toBe(true);
  });

  it("does not snap beyond threshold", () => {
    const page = pageWith([panel("anchor", 2, 0, 1, 1), panel("mover", 0, 5, 1, 1)]);
    // x=2.7: lines 2.7/3.2/3.7 vs targets 2/2.5/3 -> nearest 0.2 in, beyond 0.05
    const r = computeSnap(page, pRef("mover"), { xIn: 2.7, yIn: 5, wIn: 1, hIn: 1 }, { thresholdIn: 0.05 });
    expect(r.dxIn).toBe(0);
    expect(r.guides.filter((g) => g.axis === "x")).toHaveLength(0);
  });

  it("snaps center to the page center", () => {
    const page = pageWith([panel("mover", 0, 0, 2, 1)]);
    // page 10 wide -> center 5; mover center at x=4.98 -> snap +0.02
    const r = computeSnap(page, pRef("mover"), { xIn: 3.98, yIn: 0, wIn: 2, hIn: 1 }, { pageWIn: 10 });
    expect(r.dxIn).toBeCloseTo(0.02);
  });
});

describe("z-order", () => {
  it("brings an element to the front of its layer", () => {
    const page = pageWith([panel("a", 0, 0), panel("b", 0, 0), panel("c", 0, 0)]);
    expect(bringToFront(page, pRef("a")).panels.map((p) => p.panelId)).toEqual(["b", "c", "a"]);
  });
  it("sends an element to the back of its layer", () => {
    const page = pageWith([panel("a", 0, 0), panel("b", 0, 0), panel("c", 0, 0)]);
    expect(sendToBack(page, pRef("c")).panels.map((p) => p.panelId)).toEqual(["c", "a", "b"]);
  });
});

describe("marquee select", () => {
  it("returns elements whose box intersects the rectangle", () => {
    const page = pageWith([panel("in", 1, 1, 1, 1), panel("out", 9, 9, 1, 1)]);
    const hits = elementsInRect(page, { xIn: 0, yIn: 0, wIn: 3, hIn: 3 }).map(refKey);
    expect(hits).toEqual(["panel:in"]);
  });
});

// ── QoL Tier-1 helper tests ──────────────────────────────────────────────────

describe("group / ungroup", () => {
  it("assigns a shared groupId to multiple elements", () => {
    const page = pageWith([panel("a", 0, 0), panel("b", 1, 1)]);
    const out = setGroupId(page, [pRef("a"), pRef("b")], "g1");
    expect(out.panels.find((p) => p.panelId === "a")?.groupId).toBe("g1");
    expect(out.panels.find((p) => p.panelId === "b")?.groupId).toBe("g1");
  });

  it("clears groupId when passed null", () => {
    let page = pageWith([panel("a", 0, 0), panel("b", 1, 1)]);
    page = setGroupId(page, [pRef("a"), pRef("b")], "g1");
    const out = setGroupId(page, [pRef("a"), pRef("b")], null);
    expect(out.panels.find((p) => p.panelId === "a")?.groupId).toBeUndefined();
  });

  it("groupMates returns all members sharing a groupId", () => {
    let page = pageWith([panel("a", 0, 0), panel("b", 1, 1), panel("c", 2, 2)]);
    page = setGroupId(page, [pRef("a"), pRef("b")], "gX");
    const mates = groupMates(page, pRef("a")).map((r) => r.id);
    expect(mates.sort()).toEqual(["a", "b"]);
  });

  it("groupMates returns just the element when ungrouped", () => {
    const page = pageWith([panel("a", 0, 0), panel("b", 1, 1)]);
    const mates = groupMates(page, pRef("a")).map((r) => r.id);
    expect(mates).toEqual(["a"]);
  });
});

describe("flip elements", () => {
  it("mirrors a single panel horizontally across its own center", () => {
    // Panel at x=1, w=2 -> center=2. After horizontal flip: newX = 2*2 - (1+2) = 1 (same position, flipX set).
    const page = pageWith([panel("a", 1, 0, 2, 1)]);
    const out = flipElements(page, [pRef("a")], "horizontal");
    const p = out.panels.find((x) => x.panelId === "a")!;
    expect(p.flipX).toBe(true);
  });

  it("mirrors two panels horizontally about their union center", () => {
    // Panel a: x=0, w=1. Panel b: x=3, w=1. Union: x=0, w=4, center=2.
    // After flip: a newX = 2*2 - (0+1) = 3. b newX = 2*2 - (3+1) = 0.
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("b", 3, 0, 1, 1)]);
    const out = flipElements(page, [pRef("a"), pRef("b")], "horizontal");
    const a = out.panels.find((p) => p.panelId === "a")!;
    const b = out.panels.find((p) => p.panelId === "b")!;
    expect(a.xIn).toBeCloseTo(3);
    expect(b.xIn).toBeCloseTo(0);
  });

  it("mirrors a panel vertically", () => {
    const page = pageWith([panel("a", 0, 1, 1, 2)]);
    const out = flipElements(page, [pRef("a")], "vertical");
    const p = out.panels.find((x) => x.panelId === "a")!;
    expect(p.flipY).toBe(true);
  });
});

describe("lock / hide", () => {
  it("sets and reads locked on a panel", () => {
    const page = pageWith([panel("a", 0, 0)]);
    const locked = setElementLocked(page, pRef("a"), true);
    expect(isElementLocked(locked, pRef("a"))).toBe(true);
    const unlocked = setElementLocked(locked, pRef("a"), false);
    expect(isElementLocked(unlocked, pRef("a"))).toBe(false);
  });

  it("sets and reads hidden on a panel", () => {
    const page = pageWith([panel("a", 0, 0)]);
    const hidden = setElementHidden(page, pRef("a"), true);
    expect(isElementHidden(hidden, pRef("a"))).toBe(true);
  });

  it("returns false for a non-locked element", () => {
    const page = pageWith([panel("a", 0, 0)]);
    expect(isElementLocked(page, pRef("a"))).toBe(false);
  });
});

describe("setElementSize", () => {
  it("resizes a panel", () => {
    const page = pageWith([panel("a", 0, 0, 1, 1)]);
    const out = setElementSize(page, pRef("a"), 3, 2);
    const p = out.panels.find((x) => x.panelId === "a")!;
    expect(p.wIn).toBe(3);
    expect(p.hIn).toBe(2);
  });

  it("clamps to minimum size", () => {
    const page = pageWith([panel("a", 0, 0, 1, 1)]);
    const out = setElementSize(page, pRef("a"), 0, -1);
    const p = out.panels.find((x) => x.panelId === "a")!;
    expect(p.wIn).toBe(0.1);
    expect(p.hIn).toBe(0.1);
  });
});

describe("duplicateElements", () => {
  it("creates new panels with offset and fresh ids", () => {
    const page = pageWith([panel("a", 1, 2, 3, 4)]);
    const { page: out, newRefs } = duplicateElements(page, [pRef("a")], 0.15);
    expect(newRefs).toHaveLength(1);
    expect(newRefs[0].kind).toBe("panel");
    expect(newRefs[0].id).not.toBe("a");
    const newPanel = out.panels.find((p) => p.panelId === newRefs[0].id)!;
    expect(newPanel.xIn).toBeCloseTo(1.15);
    expect(newPanel.yIn).toBeCloseTo(2.15);
    // Original panel unchanged
    expect(out.panels.find((p) => p.panelId === "a")?.xIn).toBe(1);
  });

  it("preserves relative positions for multi-element paste", () => {
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("b", 2, 2, 1, 1)]);
    const { page: out, newRefs } = duplicateElements(page, [pRef("a"), pRef("b")], 0.2);
    expect(newRefs).toHaveLength(2);
    const na = out.panels.find((p) => p.panelId === newRefs[0].id)!;
    const nb = out.panels.find((p) => p.panelId === newRefs[1].id)!;
    // Both offset by 0.2; relative gap preserved
    expect(nb.xIn - na.xIn).toBeCloseTo(2);
    expect(nb.yIn - na.yIn).toBeCloseTo(2);
  });
});
