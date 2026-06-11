// guide_to_element logic test (ai perception bot, 2026-06-11).
//
// Tests the resolve-then-spotlight sequence with both effects injected, so no real
// DOM is needed. Covers narration building, highlighting a resolvable ref, and the
// graceful result when the ref no longer resolves (the page changed since the
// read).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { runGuide, buildNarration } from "../tools/guide-to-element";

describe("buildNarration", () => {
  it("prefers a model-supplied note", () => {
    expect(buildNarration("New method button", "Click here to add a method")).toBe(
      "Click here to add a method",
    );
  });

  it("falls back to the element name", () => {
    expect(buildNarration("New method button", undefined)).toBe(
      "Here is New method button.",
    );
  });

  it("has a final fallback when nothing is known", () => {
    expect(buildNarration(undefined, undefined).length).toBeGreaterThan(0);
  });
});

describe("runGuide", () => {
  it("resolves the ref and spotlights it", () => {
    const fakeEl = {} as HTMLElement;
    const resolve = vi.fn().mockReturnValue(fakeEl);
    const show = vi.fn();

    const result = runGuide(
      { ref: "bb-3", name: "New method button", note: "Click to add a method" },
      { resolve, show },
    );

    expect(resolve).toHaveBeenCalledWith("bb-3");
    expect(show).toHaveBeenCalledWith(fakeEl, "Click to add a method");
    expect(result.highlighted).toBe(true);
    expect(result.ref).toBe("bb-3");
  });

  it("returns a graceful result when the ref no longer resolves", () => {
    const resolve = vi.fn().mockReturnValue(null);
    const show = vi.fn();

    const result = runGuide({ ref: "bb-9" }, { resolve, show });

    expect(show).not.toHaveBeenCalled();
    expect(result.highlighted).toBe(false);
    expect(result.message).toContain("read_page");
  });
});
