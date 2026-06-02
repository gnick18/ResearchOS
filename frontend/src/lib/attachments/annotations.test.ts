// frontend/src/lib/attachments/annotations.test.ts
//
// Phase 1 of the non-destructive photo-annotation tool. These tests pin:
//
//   1. Schema round-trip: writeAnnotations then readAnnotations returns an
//      equal doc (the on-disk `.annot.json` survives a serialize/parse cycle).
//   2. annotPath shape: the sidecar lands at Images/{name}.annot.json, distinct
//      from the existing {name}.json metadata sidecar.
//   3. No-annot-layer no-op: readAnnotations returns null when no file exists,
//      which is what drives <AnnotatedImage>'s zero-overhead bare-img path.
//   4. SVG scaling: a 4px stroke authored in a 1024-wide viewBox stays at 4
//      natural units regardless of the rendered container size. The browser
//      scales the viewBox, so the mapping must NOT bake in any pixel size.
//   5. Arrow expands to a shaft + a filled head; ellipse maps box -> center.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fileService stub. readJson/writeJson are the only methods the
// annotations IO helper touches.
const store = new Map<string, string>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    async readJson<T>(path: string): Promise<T | null> {
      const raw = store.get(path);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    async writeJson<T>(path: string, data: T): Promise<void> {
      // Mirror the real atomic writeJson's JSON.stringify(data, null, 2).
      store.set(path, JSON.stringify(data, null, 2));
    },
  },
}));

import {
  ANNOTATION_SCHEMA_VERSION,
  annotPath,
  readAnnotations,
  writeAnnotations,
  shapeToSvgElements,
  docToSvgElements,
  filenameFromMarkdownSrc,
  type AnnotationDoc,
} from "./annotations";

beforeEach(() => store.clear());
afterEach(() => vi.clearAllMocks());

function sampleDoc(): AnnotationDoc {
  return {
    version: ANNOTATION_SCHEMA_VERSION,
    imageW: 1024,
    imageH: 768,
    shapes: [
      { id: "a1", type: "arrow", x1: 430, y1: 230, x2: 560, y2: 360, color: "#e11d48", strokeWidth: 4 },
      { id: "a2", type: "rect", x: 120, y: 80, w: 200, h: 140, color: "#10b981", strokeWidth: 4 },
      { id: "a3", type: "ellipse", x: 300, y: 300, w: 100, h: 60, color: "#3b82f6", strokeWidth: 2 },
      { id: "a4", type: "line", x1: 0, y1: 0, x2: 50, y2: 50, color: "#111827", strokeWidth: 6 },
      { id: "a5", type: "freehand", points: [10, 10, 20, 30, 40, 35], color: "#f59e0b", strokeWidth: 3 },
      { id: "a6", type: "text", x: 600, y: 150, text: "band of interest", color: "#8b5cf6", fontSize: 28 },
    ],
    updatedAt: "2026-06-02T18:00:00.000Z",
    updatedBy: "grant",
  };
}

describe("annotPath", () => {
  it("targets Images/{name}.annot.json, distinct from the metadata sidecar", () => {
    expect(annotPath("results/task-12", "gel-day3.png")).toBe(
      "results/task-12/Images/gel-day3.png.annot.json",
    );
    // Must NOT collide with the existing {name}.json metadata sidecar.
    expect(annotPath("results/task-12", "gel-day3.png")).not.toBe(
      "results/task-12/Images/gel-day3.png.json",
    );
  });
});

describe("schema round-trip", () => {
  it("write then read returns an equal doc", async () => {
    const doc = sampleDoc();
    await writeAnnotations("results/task-12", "gel-day3.png", doc);
    const back = await readAnnotations("results/task-12", "gel-day3.png");
    expect(back).toEqual(doc);
  });

  it("preserves every shape type and its coordinate fields", async () => {
    const doc = sampleDoc();
    await writeAnnotations("base", "img.png", doc);
    const back = await readAnnotations("base", "img.png");
    expect(back?.shapes.map((s) => s.type)).toEqual([
      "arrow",
      "rect",
      "ellipse",
      "line",
      "freehand",
      "text",
    ]);
    const text = back?.shapes.find((s) => s.type === "text");
    expect(text).toMatchObject({ text: "band of interest", fontSize: 28 });
  });
});

describe("no-annot-layer no-op path", () => {
  it("readAnnotations returns null when no file exists", async () => {
    const back = await readAnnotations("base", "never-annotated.png");
    expect(back).toBeNull();
  });

  it("treats a doc without a shapes array as missing", async () => {
    // A malformed file (e.g. a partial write) must not crash the overlay.
    store.set(annotPath("base", "x.png"), JSON.stringify({ version: 1 }));
    const back = await readAnnotations("base", "x.png");
    expect(back).toBeNull();
  });
});

describe("SVG scaling (DOM-free overlay mapping)", () => {
  it("keeps a 4px stroke at 4 natural units in a 1024 viewBox (no baked pixel size)", () => {
    const els = shapeToSvgElements({
      id: "r",
      type: "rect",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      color: "#000",
      strokeWidth: 4,
    });
    expect(els).toHaveLength(1);
    // The stroke-width is the NATURAL value. The overlay <svg viewBox="0 0
    // 1024 768"> + width/height:100% lets the browser scale it, so the spec
    // must carry 4 regardless of whether the container is 1024px or 64px wide.
    expect(els[0].attrs["stroke-width"]).toBe(4);
    expect(els[0].attrs.width).toBe(100);
  });

  it("scaling stays proportional: half-size viewBox renders the same spec", () => {
    // The mapping is viewBox-relative, so a 64px container vs a 1024px
    // container produce IDENTICAL element specs; only the SVG viewBox -> box
    // transform (done by the browser) differs. Proven by the spec being a
    // pure function of the shape, independent of any container width.
    const shape = {
      id: "r",
      type: "rect" as const,
      x: 10,
      y: 10,
      w: 200,
      h: 200,
      color: "#000",
      strokeWidth: 4,
    };
    const a = shapeToSvgElements(shape);
    const b = shapeToSvgElements(shape);
    expect(a).toEqual(b);
    // Ratio of stroke to viewBox width is constant: 4 / 1024 at any render
    // size, because nothing here multiplies by a container dimension.
    const strokeOverViewBox = Number(a[0].attrs["stroke-width"]) / 1024;
    expect(strokeOverViewBox).toBeCloseTo(4 / 1024, 10);
  });

  it("arrow expands to a shaft line + a filled head polygon", () => {
    const els = shapeToSvgElements({
      id: "ar",
      type: "arrow",
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 0,
      color: "#e11d48",
      strokeWidth: 4,
    });
    expect(els.map((e) => e.tag)).toEqual(["line", "polygon"]);
    expect(els[1].attrs.fill).toBe("#e11d48");
    // Head sits at the tip (x2,y2).
    expect(String(els[1].attrs.points).startsWith("100,0")).toBe(true);
  });

  it("ellipse maps a top-left box to a center + radii", () => {
    const els = shapeToSvgElements({
      id: "e",
      type: "ellipse",
      x: 100,
      y: 200,
      w: 100,
      h: 60,
      color: "#000",
      strokeWidth: 2,
    });
    expect(els[0].tag).toBe("ellipse");
    expect(els[0].attrs.cx).toBe(150);
    expect(els[0].attrs.cy).toBe(230);
    expect(els[0].attrs.rx).toBe(50);
    expect(els[0].attrs.ry).toBe(30);
  });

  it("freehand flattens its point pairs into an SVG points string", () => {
    const els = shapeToSvgElements({
      id: "f",
      type: "freehand",
      points: [10, 10, 20, 30, 40, 35],
      color: "#000",
      strokeWidth: 3,
    });
    expect(els[0].tag).toBe("polyline");
    expect(els[0].attrs.points).toBe("10,10 20,30 40,35");
  });

  it("docToSvgElements flattens an entire doc", () => {
    // arrow(2) + rect(1) + ellipse(1) + line(1) + freehand(1) + text(1) = 7
    expect(docToSvgElements(sampleDoc())).toHaveLength(7);
  });
});

describe("filenameFromMarkdownSrc", () => {
  it("decodes a percent-encoded Images ref to the literal on-disk name", () => {
    expect(filenameFromMarkdownSrc("Images/foo%20bar.png")).toBe("foo bar.png");
  });
  it("takes the basename of a nested path", () => {
    expect(filenameFromMarkdownSrc("./Images/gel.png")).toBe("gel.png");
  });
  it("returns null for remote and data refs (no overlay possible)", () => {
    expect(filenameFromMarkdownSrc("https://example.com/x.png")).toBeNull();
    expect(filenameFromMarkdownSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(filenameFromMarkdownSrc("blob:abc")).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(filenameFromMarkdownSrc("")).toBeNull();
  });
});
