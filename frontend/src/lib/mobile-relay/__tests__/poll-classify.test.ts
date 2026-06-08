import { describe, expect, it } from "vitest";

import { classifyCapture } from "@/lib/mobile-relay/poll";

describe("classifyCapture", () => {
  it("routes image content types to the image branch", () => {
    expect(classifyCapture("image/png")).toBe("image");
    expect(classifyCapture("image/jpeg")).toBe("image");
    expect(classifyCapture("IMAGE/HEIC")).toBe("image");
  });

  it("routes text content types to the text branch", () => {
    expect(classifyCapture("text/markdown")).toBe("text");
    expect(classifyCapture("text/plain")).toBe("text");
    expect(classifyCapture("text/markdown; charset=utf-8")).toBe("text");
    expect(classifyCapture("TEXT/PLAIN")).toBe("text");
  });

  it("routes the reorder content type to the reorder branch", () => {
    expect(classifyCapture("application/x-researchos-reorder")).toBe("reorder");
    expect(classifyCapture("APPLICATION/X-RESEARCHOS-REORDER")).toBe("reorder");
    expect(classifyCapture("application/x-researchos-reorder; charset=utf-8")).toBe(
      "reorder",
    );
  });

  it("routes everything else to other (skipped, never acked)", () => {
    expect(classifyCapture("application/pdf")).toBe("other");
    expect(classifyCapture("application/octet-stream")).toBe("other");
    expect(classifyCapture("")).toBe("other");
    expect(classifyCapture(null)).toBe("other");
    expect(classifyCapture(undefined)).toBe("other");
  });
});
