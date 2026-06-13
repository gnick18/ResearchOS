// page-routing hint test (ai perception bot, 2026-06-11).
//
// The manifest is demoted to a page-level routing hint. This pins that the hint
// resolves common requests to the right page, aggregating anchor scores by page so
// a page with several relevant controls wins, and returns nothing for an unmatched
// query. Pure, no DOM and no network. Runs against both a fixture manifest and the
// real generated one.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { resolvePageHints } from "../page-routing";
import type { UiAnchor } from "../ui-anchors.generated";

const FIXTURE: UiAnchor[] = [
  { id: "methods-new-method-button", label: "New method button (Methods library)", page: "/methods" },
  { id: "methods-template-library-button", label: "Template library button (Methods library)", page: "/methods" },
  { id: "purchases-new-button", label: "New button (Purchases)", page: "/purchases" },
  { id: "gantt-new-task-button", label: "New task button (Gantt timeline)", page: "/gantt" },
];

describe("resolvePageHints", () => {
  it("routes a method request to /methods", () => {
    const hints = resolvePageHints("add a method", FIXTURE);
    expect(hints[0].page).toBe("/methods");
  });

  it("routes a buy request to /purchases", () => {
    const hints = resolvePageHints("buy a reagent", FIXTURE);
    expect(hints[0].page).toBe("/purchases");
  });

  it("routes a task request to /gantt", () => {
    const hints = resolvePageHints("make a new task", FIXTURE);
    expect(hints[0].page).toBe("/gantt");
  });

  it("returns an empty list for an unmatched query", () => {
    const hints = resolvePageHints("sequence alignment viewer", FIXTURE);
    expect(hints).toEqual([]);
  });

  it("works against the real generated manifest", () => {
    const hints = resolvePageHints("where do I add a new method");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].page).toBe("/methods");
  });

  it("routes a phylogenetic tree request to /phylo via the supplemental hint", () => {
    // The phylo page has no generated tour anchors yet, so SUPPLEMENTAL_ANCHORS
    // (merged into the default set) carries the routing.
    expect(resolvePageHints("build a phylogenetic tree")[0]?.page).toBe("/phylo");
    expect(resolvePageHints("open the phylogenetics page")[0]?.page).toBe("/phylo");
    expect(resolvePageHints("phylogeny tree studio")[0]?.page).toBe("/phylo");
  });
});
