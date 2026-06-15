import { describe, expect, it } from "vitest";
import { createFigurePage, pageShapes, pageConnectors } from "@/lib/figure/figure-page";
import { FIGURE_TEMPLATES, applyTemplateSized } from "@/lib/figure/figure-templates";
import { pruneConnectors } from "@/lib/figure/figure-page";

const process = FIGURE_TEMPLATES.find((t) => t.id === "process-3")!;

describe("figure templates", () => {
  it("process flow adds 3 shapes, 3 labels, 2 connectors", () => {
    const out = applyTemplateSized(createFigurePage("p", "P", null), process, 8.5, 11);
    expect(pageShapes(out)).toHaveLength(3);
    expect(out.annotations).toHaveLength(3);
    expect(pageConnectors(out)).toHaveLength(2);
  });

  it("connectors reference shapes that actually exist (survive prune)", () => {
    const out = applyTemplateSized(createFigurePage("p", "P", null), process, 8.5, 11);
    expect(pageConnectors(pruneConnectors(out))).toHaveLength(2);
  });

  it("applying appends (does not clobber existing elements)", () => {
    let out = applyTemplateSized(createFigurePage("p", "P", null), process, 8.5, 11);
    out = applyTemplateSized(out, process, 8.5, 11);
    expect(pageShapes(out)).toHaveLength(6);
    // ids are unique across the two applications
    expect(new Set(pageShapes(out).map((s) => s.shapeId)).size).toBe(6);
  });
});
