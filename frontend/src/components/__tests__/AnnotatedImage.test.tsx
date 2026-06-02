// Component tests for <AnnotatedImage /> — Phase 1 of the photo-annotation
// tool. The shared renderer must:
//
//   1. No-op path: with NO `.annot.json`, render a BARE <img> (no wrapper,
//      no <svg>) so unannotated images carry zero overhead and zero behavior
//      change. This is the 99% case and the common-bundle regression guard.
//   2. Overlay path: with a `.annot.json`, wrap the <img> in a relative
//      container and lay a `viewBox`-scaled <svg> overlay over it, drawing the
//      stored shapes in natural coords. The viewBox is the natural image size
//      so the overlay scales to any container with no per-surface math.
//   3. Stay SVG-only: never import konva on the render path (asserted by the
//      module graph; the component only pulls in the SVG mapping helpers).
//
// fileService is an in-memory Map so readAnnotations resolves synchronously
// against fixtures.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

const store = new Map<string, string>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    async readJson<T>(path: string): Promise<T | null> {
      const raw = store.get(path);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async writeJson<T>(path: string, data: T): Promise<void> {
      store.set(path, JSON.stringify(data, null, 2));
    },
  },
}));

import AnnotatedImage from "../AnnotatedImage";
import { annotPath, type AnnotationDoc } from "@/lib/attachments/annotations";

beforeEach(() => store.clear());
afterEach(() => vi.clearAllMocks());

function seedLayer(basePath: string, filename: string) {
  const doc: AnnotationDoc = {
    version: 1,
    imageW: 1024,
    imageH: 768,
    shapes: [
      { id: "r", type: "rect", x: 100, y: 80, w: 200, h: 140, color: "#e11d48", strokeWidth: 4 },
    ],
    updatedAt: "2026-06-02T00:00:00.000Z",
  };
  store.set(annotPath(basePath, filename), JSON.stringify(doc));
}

describe("no-annot-layer no-op path", () => {
  it("renders a bare <img> with no wrapper and no <svg> overlay", async () => {
    const { container } = render(
      <AnnotatedImage
        src="blob:fake"
        alt="gel"
        basePath="results/task-1"
        filename="unannotated.png"
        className="max-w-full rounded-lg"
      />,
    );
    // Let the (async) readAnnotations effect resolve; it returns null.
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("svg")).toBeNull();
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    // The className lands directly on the img (matches the previous bare-img
    // behavior the surfaces relied on).
    expect(img?.className).toContain("max-w-full");
    // No relative wrapper span.
    expect(container.querySelector('span[data-annotated="true"]')).toBeNull();
  });

  it("renders bare <img> when basePath/filename are omitted", async () => {
    const { container } = render(<AnnotatedImage src="blob:x" alt="x" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });
});

describe("overlay path", () => {
  it("wraps the img and draws a viewBox-scaled <svg> overlay from the layer", async () => {
    seedLayer("results/task-1", "gel.png");
    const { container } = render(
      <AnnotatedImage
        src="blob:fake"
        alt="gel"
        basePath="results/task-1"
        filename="gel.png"
        className="max-w-full rounded-lg"
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // viewBox is the natural image size -> the overlay scales to any container.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 1024 768");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    // The rect is drawn in natural coords with its natural stroke width.
    const rect = svg?.querySelector("rect");
    expect(rect?.getAttribute("width")).toBe("200");
    expect(rect?.getAttribute("stroke-width")).toBe("4");
    // Overlay does not eat pointer events (clicks reach the img / surface).
    expect((svg as SVGElement).style.pointerEvents).toBe("none");
    // The wrapper is present and the img still renders inside it.
    const wrapper = container.querySelector('span[data-annotated="true"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("img")).not.toBeNull();
  });
});
