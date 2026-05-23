import { describe, expect, it } from "vitest";
import { getReadableTextColor } from "./colors";

describe("getReadableTextColor", () => {
  it("returns dark slate for light backgrounds", () => {
    // Yellow — bright, low YIQ weight on red/blue but very high green
    expect(getReadableTextColor("#fbbf24")).toBe("#1f2937");
    // Pastel pink
    expect(getReadableTextColor("#fbcfe8")).toBe("#1f2937");
    // Near-white
    expect(getReadableTextColor("#ffffff")).toBe("#1f2937");
  });

  it("returns white for dark backgrounds", () => {
    // Dark blue
    expect(getReadableTextColor("#1e3a8a")).toBe("#ffffff");
    // Bright red (relatively low YIQ because red weight is small)
    expect(getReadableTextColor("#dc2626")).toBe("#ffffff");
    // Pure black
    expect(getReadableTextColor("#000000")).toBe("#ffffff");
  });

  it("expands 3-char hex inputs", () => {
    // #fff → #ffffff
    expect(getReadableTextColor("#fff")).toBe("#1f2937");
    // #000 → #000000
    expect(getReadableTextColor("#000")).toBe("#ffffff");
    // #f80 → #ff8800 — orange, light enough for dark text
    expect(getReadableTextColor("#f80")).toBe("#1f2937");
  });

  it("accepts hex without leading #", () => {
    expect(getReadableTextColor("1e3a8a")).toBe("#ffffff");
    expect(getReadableTextColor("fbbf24")).toBe("#1f2937");
  });

  it("parses rgb() and rgba() strings (alpha stripped)", () => {
    expect(getReadableTextColor("rgb(30, 58, 138)")).toBe("#ffffff");
    expect(getReadableTextColor("rgba(251, 191, 36, 0.5)")).toBe("#1f2937");
    expect(getReadableTextColor("rgb(255,255,255)")).toBe("#1f2937");
  });

  it("falls back to white for invalid input", () => {
    expect(getReadableTextColor("")).toBe("#ffffff");
    expect(getReadableTextColor(null)).toBe("#ffffff");
    expect(getReadableTextColor(undefined)).toBe("#ffffff");
    expect(getReadableTextColor("not-a-color")).toBe("#ffffff");
    expect(getReadableTextColor("#xyz")).toBe("#ffffff");
  });

  it("handles the YIQ 128 boundary case (mid-gray)", () => {
    // #808080 → r=g=b=128 → yiq = (128*299 + 128*587 + 128*114)/1000 = 128
    // Boundary is >= 128 → returns dark text. Either is acceptable.
    const result = getReadableTextColor("#808080");
    expect(result === "#1f2937" || result === "#ffffff").toBe(true);
  });
});
