// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TYPEWRITER_SCROLL_RATIO,
  FOCUS_DIMMING_OPACITY,
  readStoredTypewriterScroll,
  writeStoredTypewriterScroll,
  readStoredFocusDimming,
  writeStoredFocusDimming,
} from "./editor-focus-prefs";

/**
 * Focus-behavior prefs roundtrip + default-OFF coverage
 * (UNIFIED_EDITOR_SURFACE_DESIGN.md §3A, U5 toggles). Mirrors the editor-width-
 * preset localStorage test. jsdom for window.localStorage.
 */

const TYPEWRITER_KEY = "ros.editor.typewriter";
const DIMMING_KEY = "ros.editor.dimming";

describe("editor focus prefs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults BOTH behaviors to OFF when nothing is stored (the amber decision)", () => {
    expect(readStoredTypewriterScroll()).toBe(false);
    expect(readStoredFocusDimming()).toBe(false);
  });

  it("roundtrips typewriter scroll through localStorage", () => {
    writeStoredTypewriterScroll(true);
    expect(window.localStorage.getItem(TYPEWRITER_KEY)).toBe("1");
    expect(readStoredTypewriterScroll()).toBe(true);
    writeStoredTypewriterScroll(false);
    expect(window.localStorage.getItem(TYPEWRITER_KEY)).toBe("0");
    expect(readStoredTypewriterScroll()).toBe(false);
  });

  it("roundtrips focus dimming through localStorage", () => {
    writeStoredFocusDimming(true);
    expect(window.localStorage.getItem(DIMMING_KEY)).toBe("1");
    expect(readStoredFocusDimming()).toBe(true);
    writeStoredFocusDimming(false);
    expect(window.localStorage.getItem(DIMMING_KEY)).toBe("0");
    expect(readStoredFocusDimming()).toBe(false);
  });

  it("the two prefs use independent keys (toggling one never moves the other)", () => {
    writeStoredTypewriterScroll(true);
    expect(readStoredTypewriterScroll()).toBe(true);
    expect(readStoredFocusDimming()).toBe(false);
    writeStoredFocusDimming(true);
    writeStoredTypewriterScroll(false);
    expect(readStoredTypewriterScroll()).toBe(false);
    expect(readStoredFocusDimming()).toBe(true);
  });

  it("treats any non-'1' stored value as OFF", () => {
    window.localStorage.setItem(TYPEWRITER_KEY, "yes");
    window.localStorage.setItem(DIMMING_KEY, "true");
    expect(readStoredTypewriterScroll()).toBe(false);
    expect(readStoredFocusDimming()).toBe(false);
  });

  it("exposes the design's tuning constants", () => {
    // ~42% active-line pin, ~30% dim opacity (design §3A).
    expect(TYPEWRITER_SCROLL_RATIO).toBeCloseTo(0.42, 5);
    expect(FOCUS_DIMMING_OPACITY).toBeCloseTo(0.3, 5);
  });
});
