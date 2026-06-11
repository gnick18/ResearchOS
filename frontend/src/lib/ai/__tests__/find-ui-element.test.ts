// find_ui_element matching test (ai spotlight bot, 2026-06-10).
//
// Exercises the pure scorer and search over both a fixed fixture manifest (so
// expectations are stable) and the real generated manifest (so the live data
// behaves). The scoring is deterministic, no DOM and no network.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { findAnchors, scoreAnchor } from "../tools/find-ui-element";
import type { UiAnchor } from "../ui-anchors.generated";
import { UI_ANCHORS } from "../ui-anchors.generated";

const FIXTURE: UiAnchor[] = [
  { id: "gantt-new-task-button", label: "New task button (Gantt timeline)", page: "/gantt" },
  { id: "gantt-goals-button", label: "Goals button (Gantt timeline)", page: "/gantt" },
  { id: "methods-new-method-button", label: "New method button (Methods library)", page: "/methods" },
  { id: "purchases-new-button", label: "New button (Purchases)", page: "/purchases" },
  { id: "search-input", label: "Input (Search)", page: "/search" },
];

describe("scoreAnchor", () => {
  it("scores zero for an empty query", () => {
    expect(scoreAnchor(FIXTURE[0], [])).toBe(0);
  });

  it("scores an exact label word higher than a substring-only hit", () => {
    const exact = scoreAnchor(FIXTURE[0], ["task"]);
    const none = scoreAnchor(FIXTURE[1], ["task"]); // goals button, no "task"
    expect(exact).toBeGreaterThan(none);
    expect(none).toBe(0);
  });
});

describe("findAnchors", () => {
  it("finds the gantt new-task button for a make-a-task query", () => {
    const results = findAnchors("make a new task", FIXTURE);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("gantt-new-task-button");
    expect(results[0].page).toBe("/gantt");
  });

  it("uses synonyms so create maps to new", () => {
    const results = findAnchors("create a method", FIXTURE);
    expect(results[0].id).toBe("methods-new-method-button");
  });

  it("returns an empty list for a query with no overlap", () => {
    const results = findAnchors("sequence alignment viewer", FIXTURE);
    expect(results).toEqual([]);
  });

  it("respects the limit", () => {
    const results = findAnchors("new", FIXTURE, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("returns only id, label, and page in candidates", () => {
    const [first] = findAnchors("new task", FIXTURE);
    expect(Object.keys(first).sort()).toEqual(["id", "label", "page"]);
  });

  it("works against the real generated manifest", () => {
    const results = findAnchors("how do I make a new task", UI_ANCHORS);
    expect(results.length).toBeGreaterThan(0);
    // The gantt new-task button is the right answer in the live manifest.
    expect(results.some((r) => r.id === "gantt-new-task-button")).toBe(true);
  });
});
