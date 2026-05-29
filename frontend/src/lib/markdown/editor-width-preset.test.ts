import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_WIDTH_PRESET,
  EDITOR_WIDTH_PRESETS,
  EDITOR_WIDTH_PRESET_LABELS,
  coerceEditorWidthPreset,
  editorWidthMeasureClass,
} from "./editor-width-preset";

/**
 * Width-preset mapping + clamp coverage (MARKDOWN_EDITOR_TYPORA_DESIGN.md
 * Phase 1). Runs in the node project (no window); the localStorage roundtrip
 * is covered separately by the jsdom component test.
 */

describe("editor width preset", () => {
  it("defaults to comfortable (~72ch)", () => {
    expect(DEFAULT_EDITOR_WIDTH_PRESET).toBe("comfortable");
    expect(editorWidthMeasureClass("comfortable")).toContain("max-w-[72ch]");
  });

  it("maps each preset to a progressively wider, centered, fluid measure", () => {
    expect(editorWidthMeasureClass("narrow")).toBe(
      "w-full max-w-[60ch] mx-auto",
    );
    expect(editorWidthMeasureClass("comfortable")).toBe(
      "w-full max-w-[72ch] mx-auto",
    );
    expect(editorWidthMeasureClass("wide")).toBe(
      "w-full max-w-[96ch] mx-auto",
    );
    // Full-bleed drops the ch cap and uses max-w-none so it also overrides
    // the prose plugin's built-in ~65ch default on the Preview render.
    expect(editorWidthMeasureClass("full")).toBe(
      "w-full max-w-none mx-auto",
    );
  });

  it("every preset is fluid (w-full) and centered (mx-auto)", () => {
    for (const preset of EDITOR_WIDTH_PRESETS) {
      const cls = editorWidthMeasureClass(preset);
      expect(cls).toContain("w-full");
      expect(cls).toContain("mx-auto");
    }
  });

  it("exposes the four presets in narrow -> full order with labels", () => {
    expect([...EDITOR_WIDTH_PRESETS]).toEqual([
      "narrow",
      "comfortable",
      "wide",
      "full",
    ]);
    expect(EDITOR_WIDTH_PRESET_LABELS.full).toBe("Full-bleed");
  });

  it("coerces unknown / garbage values back to the default", () => {
    expect(coerceEditorWidthPreset("wide")).toBe("wide");
    expect(coerceEditorWidthPreset(undefined)).toBe("comfortable");
    expect(coerceEditorWidthPreset(null)).toBe("comfortable");
    expect(coerceEditorWidthPreset("max-w-5xl")).toBe("comfortable");
    expect(coerceEditorWidthPreset(42)).toBe("comfortable");
  });
});
