import { describe, expect, it } from "vitest";
import {
  addConnector,
  createFigurePage,
  makeConnector,
  pageConnectors,
  pruneConnectors,
  removeConnector,
  updateConnector,
  type Connector,
  type FigurePage,
  type FigurePanel,
} from "@/lib/figure/figure-page";
import {
  anchorPoint,
  arrowAngle,
  connectorEndpoints,
  connectorPath,
  elementAnchors,
  nearestSide,
} from "@/lib/figure/figure-connectors";

function panel(id: string, xIn: number, yIn: number, wIn = 2, hIn = 2): FigurePanel {
  return { panelId: id, ref: { type: "seq", id: "s" }, xIn, yIn, wIn, hIn };
}
function page(panels: FigurePanel[], connectors: Connector[] = []): FigurePage {
  return { ...createFigurePage("p", "P", null), panels, connectors };
}
const box = { xIn: 0, yIn: 0, wIn: 2, hIn: 4 };

describe("anchor geometry", () => {
  it("computes side midpoints", () => {
    expect(anchorPoint(box, "top")).toEqual({ xIn: 1, yIn: 0 });
    expect(anchorPoint(box, "bottom")).toEqual({ xIn: 1, yIn: 4 });
    expect(anchorPoint(box, "left")).toEqual({ xIn: 0, yIn: 2 });
    expect(anchorPoint(box, "right")).toEqual({ xIn: 2, yIn: 2 });
  });

  it("lists all four anchors", () => {
    expect(elementAnchors(box).map((a) => a.side)).toEqual(["top", "right", "bottom", "left"]);
  });

  it("picks the side facing a target", () => {
    expect(nearestSide(box, { xIn: 9, yIn: 2 })).toBe("right");
    expect(nearestSide(box, { xIn: -9, yIn: 2 })).toBe("left");
    expect(nearestSide(box, { xIn: 1, yIn: 9 })).toBe("bottom");
    expect(nearestSide(box, { xIn: 1, yIn: -9 })).toBe("top");
  });
});

describe("connector endpoints (live from element boxes)", () => {
  it("resolves both ends from current positions", () => {
    const p = page([panel("a", 0, 0, 2, 2), panel("b", 6, 0, 2, 2)]);
    const conn = makeConnector(
      "c1",
      { ref: { kind: "panel", id: "a" }, side: "right" },
      { ref: { kind: "panel", id: "b" }, side: "left" },
    );
    expect(connectorEndpoints(p, conn)).toEqual({
      from: { xIn: 2, yIn: 1 },
      to: { xIn: 6, yIn: 1 },
    });
  });

  it("re-routes when an element moves (endpoints are not stored)", () => {
    const conn = makeConnector(
      "c1",
      { ref: { kind: "panel", id: "a" }, side: "right" },
      { ref: { kind: "panel", id: "b" }, side: "left" },
    );
    const moved = page([panel("a", 0, 0, 2, 2), panel("b", 6, 10, 2, 2)]);
    expect(connectorEndpoints(moved, conn)?.to).toEqual({ xIn: 6, yIn: 11 });
  });

  it("returns null when an endpoint element is gone", () => {
    const p = page([panel("a", 0, 0)]);
    const conn = makeConnector(
      "c1",
      { ref: { kind: "panel", id: "a" }, side: "right" },
      { ref: { kind: "panel", id: "gone" }, side: "left" },
    );
    expect(connectorEndpoints(p, conn)).toBeNull();
  });
});

describe("path + arrowhead", () => {
  const a = { xIn: 0, yIn: 0 };
  const b = { xIn: 4, yIn: 2 };
  it("builds straight / elbow / curve paths", () => {
    expect(connectorPath(a, b, "straight")).toBe("M 0 0 L 4 2");
    expect(connectorPath(a, b, "elbow")).toBe("M 0 0 L 2 0 L 2 2 L 4 2");
    expect(connectorPath(a, b, "curve")).toBe("M 0 0 C 2 0, 2 2, 4 2");
  });
  it("orients the arrowhead toward `to`", () => {
    expect(arrowAngle(a, b, "elbow")).toBe(0);
    expect(arrowAngle({ xIn: 4, yIn: 0 }, { xIn: 0, yIn: 0 }, "elbow")).toBe(Math.PI);
  });
});

describe("connector model", () => {
  const mk = () =>
    makeConnector(
      "c1",
      { ref: { kind: "panel", id: "a" }, side: "right" },
      { ref: { kind: "panel", id: "b" }, side: "left" },
    );

  it("adds + reads + removes", () => {
    let p = page([panel("a", 0, 0), panel("b", 5, 0)]);
    p = addConnector(p, mk());
    expect(pageConnectors(p)).toHaveLength(1);
    p = removeConnector(p, "c1");
    expect(pageConnectors(p)).toHaveLength(0);
  });

  it("updates style without touching endpoints", () => {
    let p = addConnector(page([panel("a", 0, 0), panel("b", 5, 0)]), mk());
    p = updateConnector(p, "c1", { shape: "curve", heads: 2, color: "#f00" });
    const c = pageConnectors(p)[0];
    expect(c.shape).toBe("curve");
    expect(c.heads).toBe(2);
    expect(c.from.side).toBe("right"); // unchanged
  });

  it("prunes connectors whose element was deleted", () => {
    const p = page([panel("a", 0, 0)], [mk()]); // b does not exist
    expect(pageConnectors(pruneConnectors(p))).toHaveLength(0);
  });

  it("keeps connectors whose elements both exist", () => {
    const p = page([panel("a", 0, 0), panel("b", 5, 0)], [mk()]);
    expect(pruneConnectors(p)).toBe(p); // unchanged reference
  });
});
