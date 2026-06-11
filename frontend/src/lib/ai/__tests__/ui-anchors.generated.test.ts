// Manifest shape test (ai spotlight bot, 2026-06-10).
//
// Guards the generated UI-anchor manifest. The generator is the source of truth,
// this test only asserts the committed output is non-empty and well-formed so a
// bad regenerate (or a hand-edit) cannot ship a broken manifest that breaks the
// spotlight tools.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { UI_ANCHORS } from "../ui-anchors.generated";

describe("UI_ANCHORS manifest", () => {
  it("is non-empty", () => {
    expect(UI_ANCHORS.length).toBeGreaterThan(0);
  });

  it("has well-formed entries", () => {
    for (const a of UI_ANCHORS) {
      expect(typeof a.id).toBe("string");
      expect(a.id.length).toBeGreaterThan(0);
      expect(typeof a.label).toBe("string");
      expect(a.label.length).toBeGreaterThan(0);
      expect(typeof a.page).toBe("string");
      expect(a.page.startsWith("/")).toBe(true);
    }
  });

  it("uses only static kebab ids (no templated anchors)", () => {
    for (const a of UI_ANCHORS) {
      // A dynamic anchor would carry a "$" or "{" from a template literal, or an
      // uppercase letter. The generator excludes those, this is the guard.
      expect(a.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("has unique ids", () => {
    const ids = new Set(UI_ANCHORS.map((a) => a.id));
    expect(ids.size).toBe(UI_ANCHORS.length);
  });

  it("only maps to known top-level routes", () => {
    // The curated prefix map only points at these pages. If a new prefix sneaks
    // in unmapped, this catches it.
    const allowed = new Set([
      "/gantt",
      "/methods",
      "/purchases",
      "/search",
      "/settings",
      "/workbench",
      "/calendar",
    ]);
    for (const a of UI_ANCHORS) {
      expect(allowed.has(a.page)).toBe(true);
    }
  });

  it("excludes shared-modal prefixes that cannot be navigated to on load", () => {
    // None of these dropped areas should appear, they only mount behind a user
    // interaction (a popup, a dialog, an open note).
    const droppedPrefixes = ["task", "note", "share", "experiment", "pcr", "lc"];
    for (const a of UI_ANCHORS) {
      const prefix = a.id.split("-")[0];
      expect(droppedPrefixes).not.toContain(prefix);
    }
  });
});
