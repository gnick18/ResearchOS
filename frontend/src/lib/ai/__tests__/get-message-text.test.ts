// Unit tests for getMessageText (vision router, 2026-06-13).
//
// Covers the three legal content shapes a LoopMessage carries:
//   - string (the original path, must return unchanged)
//   - null / undefined (must return "")
//   - LoopContentBlock[] (text blocks concatenated, image_url blocks skipped)
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { getMessageText, type LoopContentBlock } from "../agent-loop";

describe("getMessageText", () => {
  it("returns a plain string unchanged", () => {
    expect(getMessageText("hello world")).toBe("hello world");
  });

  it("returns an empty string unchanged", () => {
    expect(getMessageText("")).toBe("");
  });

  it("returns empty string for null", () => {
    expect(getMessageText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(getMessageText(undefined)).toBe("");
  });

  it("concatenates text blocks in a block array", () => {
    const blocks: LoopContentBlock[] = [
      { type: "text", text: "hello " },
      { type: "text", text: "world" },
    ];
    expect(getMessageText(blocks)).toBe("hello world");
  });

  it("skips image_url blocks and returns only text", () => {
    const blocks: LoopContentBlock[] = [
      { type: "text", text: "describe this image" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
    ];
    expect(getMessageText(blocks)).toBe("describe this image");
  });

  it("returns empty string for a block array with only image_url blocks", () => {
    const blocks: LoopContentBlock[] = [
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,xyz" } },
    ];
    expect(getMessageText(blocks)).toBe("");
  });

  it("returns empty string for an empty block array", () => {
    expect(getMessageText([])).toBe("");
  });

  it("handles a mixed block array where text blocks are not first", () => {
    const blocks: LoopContentBlock[] = [
      { type: "image_url", image_url: { url: "data:image/png;base64,img1" } },
      { type: "text", text: "what is shown here" },
    ];
    expect(getMessageText(blocks)).toBe("what is shown here");
  });
});
