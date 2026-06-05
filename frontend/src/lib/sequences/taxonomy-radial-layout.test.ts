// sequence editor master. Tests for the PURE radial layout (no DOM, no d3).
// These pin the oseiskar-style invariants: angular width proportional to a
// log-damped species count, depth maps to radius, thickness scales with the
// damped weight, and the level-of-detail / label culling helpers behave.

import { describe, it, expect } from "vitest";
import {
  layoutRadialTree,
  dampedWeight,
  isNodeVisibleAtZoom,
  visibleNodesAtZoom,
  isLabelVisibleAtZoom,
  isNodeInViewport,
  viewportRectFromTransform,
  viewportCenterPoint,
  subtreeBounds,
  fitTransform,
  polarToCartesian,
  type RadialInputNode,
  type RadialLaidOutNode,
  type ViewportRect,
} from "./taxonomy-radial-layout";

// A small synthetic tree: a root with a FAT clade (1,000,000 species) and a
// THIN sibling (1 species), each with a couple of children.
function syntheticTree(): RadialInputNode[] {
  return [
    { id: "root", name: "Life", rank: "root", speciesCount: 0, childIds: ["fat", "thin"] },
    { id: "fat", name: "Fat clade", rank: "domain", speciesCount: 1_000_000, childIds: ["fatA", "fatB"] },
    { id: "thin", name: "Thin clade", rank: "domain", speciesCount: 1, childIds: ["thinA"] },
    { id: "fatA", name: "Fat A", rank: "family", speciesCount: 500_000, childIds: [] },
    { id: "fatB", name: "Fat B", rank: "family", speciesCount: 500_000, childIds: [] },
    { id: "thinA", name: "Thin A", rank: "family", speciesCount: 1, childIds: [] },
  ];
}

function byId(laidOut: RadialLaidOutNode[]): Map<string, RadialLaidOutNode> {
  return new Map(laidOut.map((n) => [n.id, n]));
}

describe("dampedWeight", () => {
  it("is monotonic in species count (more species, larger weight)", () => {
    expect(dampedWeight(1_000_000)).toBeGreaterThan(dampedWeight(1000));
    expect(dampedWeight(1000)).toBeGreaterThan(dampedWeight(1));
    expect(dampedWeight(1)).toBeGreaterThan(dampedWeight(0));
  });

  it("compresses six orders of magnitude into a small ratio", () => {
    // Raw ratio is 1,000,000:1. After log damping the ratio must be far smaller
    // so the small clade does not vanish.
    const ratio = dampedWeight(1_000_000) / dampedWeight(1);
    expect(ratio).toBeLessThan(15);
    expect(ratio).toBeGreaterThan(1);
  });

  it("keeps a zero-species twig above zero via the floor", () => {
    expect(dampedWeight(0)).toBeGreaterThan(0);
  });

  it("treats negative or non-finite counts as zero", () => {
    expect(dampedWeight(-5)).toBe(dampedWeight(0));
    expect(dampedWeight(Number.NaN)).toBe(dampedWeight(0));
  });
});

describe("layoutRadialTree", () => {
  it("returns empty for an unknown root", () => {
    expect(layoutRadialTree(syntheticTree(), "nope")).toEqual([]);
  });

  it("places the root at depth 0 and the inner radius", () => {
    const laid = layoutRadialTree(syntheticTree(), "root", { innerRadius: 40, ringStep: 90 });
    const root = byId(laid).get("root")!;
    expect(root.depth).toBe(0);
    expect(root.radius).toBe(40);
    expect(root.parentId).toBeNull();
  });

  it("maps depth to radius linearly (each level one ring out)", () => {
    const laid = layoutRadialTree(syntheticTree(), "root", { innerRadius: 40, ringStep: 90 });
    const m = byId(laid);
    expect(m.get("fat")!.radius).toBe(40 + 90); // depth 1
    expect(m.get("fatA")!.radius).toBe(40 + 180); // depth 2
    expect(m.get("fat")!.depth).toBe(1);
    expect(m.get("fatA")!.depth).toBe(2);
  });

  it("gives the fat clade a much wider arc than the thin sibling, but the thin one survives", () => {
    const laid = layoutRadialTree(syntheticTree(), "root");
    const m = byId(laid);
    const fat = m.get("fat")!;
    const thin = m.get("thin")!;
    expect(fat.angularWidth).toBeGreaterThan(thin.angularWidth);
    // Damped, so the fat clade does not erase the thin one: thin keeps a
    // meaningful slice (well above zero, more than a hundredth of fat's).
    expect(thin.angularWidth).toBeGreaterThan(0);
    expect(thin.angularWidth / fat.angularWidth).toBeGreaterThan(0.05);
    // And NOT proportional to the raw 1,000,000:1 count ratio.
    expect(fat.angularWidth / thin.angularWidth).toBeLessThan(20);
  });

  it("allocates the children's arcs to sum within the parent's arc", () => {
    const laid = layoutRadialTree(syntheticTree(), "root", { totalAngle: Math.PI * 2 });
    const m = byId(laid);
    const fat = m.get("fat")!;
    const sumChildren = m.get("fatA")!.angularWidth + m.get("fatB")!.angularWidth;
    expect(sumChildren).toBeCloseTo(fat.angularWidth, 6);
  });

  it("fills the full circle at the root level (children spans sum to totalAngle)", () => {
    const total = Math.PI * 2;
    const laid = layoutRadialTree(syntheticTree(), "root", { totalAngle: total });
    const m = byId(laid);
    const sum = m.get("fat")!.angularWidth + m.get("thin")!.angularWidth;
    expect(sum).toBeCloseTo(total, 6);
  });

  it("derives thickness from the damped weight (fat thicker than thin)", () => {
    const laid = layoutRadialTree(syntheticTree(), "root", {
      minThickness: 1,
      maxThickness: 14,
    });
    const m = byId(laid);
    expect(m.get("fat")!.thickness).toBeGreaterThan(m.get("thin")!.thickness);
    // Bounded within [minThickness, maxThickness].
    for (const n of laid) {
      expect(n.thickness).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(n.thickness).toBeLessThanOrEqual(14 + 1e-9);
    }
  });

  it("can lay out a deep subtree when handed a deep rootId", () => {
    // Passing the whole tree but rooting on "fat" lays out only that subtree.
    const laid = layoutRadialTree(syntheticTree(), "fat");
    const ids = laid.map((n) => n.id).sort();
    expect(ids).toEqual(["fat", "fatA", "fatB"]);
    expect(byId(laid).get("fat")!.depth).toBe(0);
  });

  it("accepts a Map pool as well as an array", () => {
    const arr = syntheticTree();
    const map = new Map(arr.map((n) => [n.id, n]));
    const fromArr = layoutRadialTree(arr, "root");
    const fromMap = layoutRadialTree(map, "root");
    expect(fromMap.length).toBe(fromArr.length);
  });
});

describe("level-of-detail culling", () => {
  it("always keeps the root", () => {
    const root: RadialLaidOutNode = {
      id: "root", name: "r", rank: "root", speciesCount: 0, depth: 0,
      angle: 0, angularWidth: 0.001, radius: 40, thickness: 1, parentId: null, weight: 1,
    };
    expect(isNodeVisibleAtZoom(root, 1, 999999)).toBe(true);
  });

  it("culls a thin far node and keeps a fat wide node at the same zoom", () => {
    const thinFar: RadialLaidOutNode = {
      id: "thin", name: "t", rank: "family", speciesCount: 1, depth: 5,
      angle: 0, angularWidth: 0.0005, radius: 500, thickness: 1, parentId: "x", weight: 1,
    };
    const fatWide: RadialLaidOutNode = {
      id: "fat", name: "f", rank: "domain", speciesCount: 1e6, depth: 1,
      angle: 0, angularWidth: 1.2, radius: 130, thickness: 12, parentId: "x", weight: 14,
    };
    // arcPixels(thinFar) = 0.0005 * 500 = 0.25; below a 30px threshold.
    expect(isNodeVisibleAtZoom(thinFar, 1, 30)).toBe(false);
    // arcPixels(fatWide) = 1.2 * 130 = 156; well above.
    expect(isNodeVisibleAtZoom(fatWide, 1, 30)).toBe(true);
  });

  it("reveals the thin node once zoomed in enough", () => {
    const thinFar: RadialLaidOutNode = {
      id: "thin", name: "t", rank: "family", speciesCount: 1, depth: 5,
      angle: 0, angularWidth: 0.0005, radius: 500, thickness: 1, parentId: "x", weight: 1,
    };
    // At zoom 200, arcPixels = 0.0005 * 500 * 200 = 50 >= 30.
    expect(isNodeVisibleAtZoom(thinFar, 200, 30)).toBe(true);
  });

  it("never orphans a node whose parent was culled", () => {
    const laid: RadialLaidOutNode[] = [
      { id: "root", name: "r", rank: "root", speciesCount: 0, depth: 0, angle: 0, angularWidth: 6.28, radius: 40, thickness: 5, parentId: null, weight: 1 },
      // parent is too thin to keep at this zoom
      { id: "mid", name: "m", rank: "order", speciesCount: 2, depth: 1, angle: 0, angularWidth: 0.0001, radius: 130, thickness: 1, parentId: "root", weight: 1 },
      // child is wide on its own, but its parent is culled, so it must drop too
      { id: "leaf", name: "l", rank: "family", speciesCount: 9, depth: 2, angle: 0, angularWidth: 2, radius: 220, thickness: 3, parentId: "mid", weight: 2 },
    ];
    const visible = visibleNodesAtZoom(laid, 1, 30);
    const ids = visible.map((n) => n.id);
    expect(ids).toContain("root");
    expect(ids).not.toContain("mid");
    expect(ids).not.toContain("leaf");
  });
});

describe("label culling", () => {
  it("needs a wider arc than a marker does", () => {
    const node: RadialLaidOutNode = {
      id: "n", name: "Name", rank: "family", speciesCount: 100, depth: 2,
      angle: 0, angularWidth: 0.05, radius: 200, thickness: 4, parentId: "x", weight: 5,
    };
    // arcPixels = 0.05 * 200 = 10. Visible as a marker at 8px, but no label at 40px.
    expect(isNodeVisibleAtZoom(node, 1, 8)).toBe(true);
    expect(isLabelVisibleAtZoom(node, 1, 40)).toBe(false);
    // Zoom in 5x: arcPixels = 50 >= 40, label appears.
    expect(isLabelVisibleAtZoom(node, 5, 40)).toBe(true);
  });
});

describe("viewport culling", () => {
  // A node helper positioned by its cartesian target. We pick angle 0 (straight
  // up, so cartesian is (0, -radius)) and angle PI/2 (to the right, (radius, 0))
  // to place nodes at known points without fighting the trig.
  function nodeUp(id: string, radius: number, parentId: string | null = "p"): RadialLaidOutNode {
    return {
      id, name: id, rank: "family", speciesCount: 10, depth: 2,
      angle: 0, angularWidth: 0.5, radius, thickness: 5, parentId, weight: 5,
    };
  }
  function nodeRight(id: string, radius: number, parentId: string | null = "p"): RadialLaidOutNode {
    return {
      id, name: id, rank: "family", speciesCount: 10, depth: 2,
      angle: Math.PI / 2, angularWidth: 0.5, radius, thickness: 5, parentId, weight: 5,
    };
  }

  const rect: ViewportRect = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

  it("keeps a node whose position falls inside the rect", () => {
    // angle 0, radius 50 -> cartesian (0, -50), inside [-100, 100].
    expect(isNodeInViewport(nodeUp("inside", 50), rect, 0)).toBe(true);
  });

  it("drops a node well outside the rect", () => {
    // angle 0, radius 500 -> cartesian (0, -500), far above the rect top.
    expect(isNodeInViewport(nodeUp("outside", 500), rect, 0)).toBe(false);
  });

  it("includes a near-edge node once the margin is applied", () => {
    // angle PI/2, radius 120 -> cartesian (120, 0). Just outside maxX 100 with no
    // margin, but inside once a 30-unit margin pads the rect.
    expect(isNodeInViewport(nodeRight("edge", 120), rect, 0)).toBe(false);
    expect(isNodeInViewport(nodeRight("edge", 120), rect, 30)).toBe(true);
  });

  it("viewportRectFromTransform inverts the screen box into layout space", () => {
    // Identity-ish: k=1, translate (500, 500), a 1000 box -> layout rect is
    // [-500, 500] on both axes (the box minus the translation, over k).
    const r = viewportRectFromTransform(1, 500, 500, 1000);
    expect(r.minX).toBeCloseTo(-500, 6);
    expect(r.maxX).toBeCloseTo(500, 6);
    expect(r.minY).toBeCloseTo(-500, 6);
    expect(r.maxY).toBeCloseTo(500, 6);
  });

  it("viewportRectFromTransform shrinks the layout rect as zoom (k) grows", () => {
    // At k=10, centered, the visible layout slice is ten times smaller.
    const r = viewportRectFromTransform(10, 500, 500, 1000);
    const width = r.maxX - r.minX;
    expect(width).toBeCloseTo(100, 6); // 1000 / 10
  });

  it("visibleNodesAtZoom drops nodes outside the viewport even when big enough", () => {
    const laid: RadialLaidOutNode[] = [
      { id: "root", name: "r", rank: "root", speciesCount: 0, depth: 0, angle: 0, angularWidth: 6.28, radius: 0, thickness: 5, parentId: null, weight: 1 },
      // Inside the rect (cartesian (0, -50)), wide enough on size too.
      nodeUp("near", 50, "root"),
      // Outside the rect (cartesian (0, -2000)), but its size footprint is huge.
      { id: "far", name: "far", rank: "family", speciesCount: 1e6, depth: 9, angle: 0, angularWidth: 1.5, radius: 2000, thickness: 12, parentId: "root", weight: 14 },
    ];
    const viewport: ViewportRect = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const out = visibleNodesAtZoom(laid, 5, 6, { viewport, marginFraction: 0 });
    const ids = out.map((n) => n.id);
    expect(ids).toContain("root");
    expect(ids).toContain("near");
    expect(ids).not.toContain("far");
  });

  it("never orphans: an in-viewport node keeps its out-of-viewport ancestors", () => {
    // The child is inside the rect, but its parent sits just outside it. The
    // parent must be force-kept so the link to the child connects.
    const laid: RadialLaidOutNode[] = [
      { id: "root", name: "r", rank: "root", speciesCount: 0, depth: 0, angle: 0, angularWidth: 6.28, radius: 0, thickness: 5, parentId: null, weight: 1 },
      // Parent at (0, -200), outside a [-100,100] rect.
      { id: "parent", name: "p", rank: "order", speciesCount: 10, depth: 1, angle: 0, angularWidth: 0.5, radius: 200, thickness: 5, parentId: "root", weight: 5 },
      // Child at (0, -50), inside the rect.
      { id: "child", name: "c", rank: "family", speciesCount: 10, depth: 2, angle: 0, angularWidth: 0.5, radius: 50, thickness: 5, parentId: "parent", weight: 5 },
    ];
    const viewport: ViewportRect = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const out = visibleNodesAtZoom(laid, 5, 6, { viewport, marginFraction: 0 });
    const ids = out.map((n) => n.id);
    expect(ids).toContain("child");
    expect(ids).toContain("parent"); // force-kept so the link is not orphaned
    expect(ids).toContain("root");
  });

  it("hard cap keeps the largest-footprint nodes plus the mandatory ancestors", () => {
    // A root with many sibling children all inside the viewport. With a cap of 3
    // (root + 2), only the two fattest children survive.
    const root: RadialLaidOutNode = {
      id: "root", name: "r", rank: "root", speciesCount: 0, depth: 0, angle: 0, angularWidth: 6.28, radius: 0, thickness: 5, parentId: null, weight: 1,
    };
    const kids: RadialLaidOutNode[] = [];
    for (let i = 0; i < 10; i += 1) {
      kids.push({
        id: `k${i}`, name: `k${i}`, rank: "family", speciesCount: 10, depth: 1,
        // All near the center (inside the rect), thickness grows with i so the
        // last ones have the biggest footprint.
        angle: 0, angularWidth: 0.1, radius: 10, thickness: 1 + i, parentId: "root", weight: 5,
      });
    }
    const laid = [root, ...kids];
    const viewport: ViewportRect = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const out = visibleNodesAtZoom(laid, 1, 0, { viewport, marginFraction: 0, hardCap: 3 });
    expect(out.length).toBe(3);
    const ids = out.map((n) => n.id);
    expect(ids).toContain("root");
    // The two fattest children (k9, k8) survive; a thin one (k0) does not.
    expect(ids).toContain("k9");
    expect(ids).toContain("k8");
    expect(ids).not.toContain("k0");
  });

  it("with no viewport option, stays the legacy size-only cull", () => {
    const laid: RadialLaidOutNode[] = [
      { id: "root", name: "r", rank: "root", speciesCount: 0, depth: 0, angle: 0, angularWidth: 6.28, radius: 40, thickness: 5, parentId: null, weight: 1 },
      { id: "mid", name: "m", rank: "order", speciesCount: 2, depth: 1, angle: 0, angularWidth: 0.0001, radius: 130, thickness: 1, parentId: "root", weight: 1 },
    ];
    const out = visibleNodesAtZoom(laid, 1, 30);
    const ids = out.map((n) => n.id);
    expect(ids).toContain("root");
    expect(ids).not.toContain("mid");
  });
});

describe("polarToCartesian", () => {
  it("puts angle 0 at the top (negative y)", () => {
    const p = polarToCartesian(0, 100);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-100, 6);
  });

  it("puts a quarter turn to the right (positive x)", () => {
    const p = polarToCartesian(Math.PI / 2, 100);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe("viewportCenterPoint", () => {
  it("is the middle of the square viewBox (the +/- zoom anchor)", () => {
    expect(viewportCenterPoint(1000)).toEqual([500, 500]);
    expect(viewportCenterPoint(640)).toEqual([320, 320]);
  });
});

describe("subtreeBounds", () => {
  it("bounds a node and all its laid-out descendants", () => {
    const laid = layoutRadialTree(syntheticTree(), "root");
    const all = subtreeBounds(laid, "root")!;
    const fat = subtreeBounds(laid, "fat")!;
    // The fat clade's box must sit inside the whole-tree box.
    expect(fat.minX).toBeGreaterThanOrEqual(all.minX - 1e-6);
    expect(fat.maxX).toBeLessThanOrEqual(all.maxX + 1e-6);
    expect(fat.minY).toBeGreaterThanOrEqual(all.minY - 1e-6);
    expect(fat.maxY).toBeLessThanOrEqual(all.maxY + 1e-6);
  });

  it("a leaf bounds to its own point (zero area)", () => {
    const laid = layoutRadialTree(syntheticTree(), "root");
    const leaf = subtreeBounds(laid, "thinA")!;
    const node = byId(laid).get("thinA")!;
    const p = polarToCartesian(node.angle, node.radius);
    expect(leaf.minX).toBeCloseTo(p.x, 6);
    expect(leaf.maxX).toBeCloseTo(p.x, 6);
    expect(leaf.minY).toBeCloseTo(p.y, 6);
    expect(leaf.maxY).toBeCloseTo(p.y, 6);
  });

  it("returns null for a missing node", () => {
    const laid = layoutRadialTree(syntheticTree(), "root");
    expect(subtreeBounds(laid, "nope")).toBeNull();
  });
});

describe("fitTransform", () => {
  const VIEW = 1000;

  it("centers the box center at the viewport center", () => {
    // A box from (100,100) to (300,300) has center (200,200).
    const rect: ViewportRect = { minX: 100, minY: 100, maxX: 300, maxY: 300 };
    const t = fitTransform(rect, VIEW);
    // screen of the box center must land at VIEW/2.
    expect(t.k * 200 + t.x).toBeCloseTo(VIEW / 2, 6);
    expect(t.k * 200 + t.y).toBeCloseTo(VIEW / 2, 6);
  });

  it("scales so the box fills the padded view (bigger box, smaller scale)", () => {
    const small: ViewportRect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const big: ViewportRect = { minX: 0, minY: 0, maxX: 800, maxY: 800 };
    const ks = fitTransform(small, VIEW).k;
    const kb = fitTransform(big, VIEW).k;
    expect(ks).toBeGreaterThan(kb);
  });

  it("falls back to a readable scale for a zero-area box (a single leaf)", () => {
    const point: ViewportRect = { minX: 250, minY: 250, maxX: 250, maxY: 250 };
    const t = fitTransform(point, VIEW, { fallbackScale: 6 });
    expect(t.k).toBe(6);
    // Still centered on the point.
    expect(t.k * 250 + t.x).toBeCloseTo(VIEW / 2, 6);
  });

  it("clamps scale to the min / max bounds", () => {
    const huge: ViewportRect = { minX: -100000, minY: -100000, maxX: 100000, maxY: 100000 };
    const tiny: ViewportRect = { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 };
    expect(fitTransform(huge, VIEW, { minScale: 0.3 }).k).toBe(0.3);
    expect(fitTransform(tiny, VIEW, { maxScale: 18 }).k).toBe(18);
  });
});
