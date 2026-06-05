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
  polarToCartesian,
  type RadialInputNode,
  type RadialLaidOutNode,
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
