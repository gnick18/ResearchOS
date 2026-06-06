// sequence editor master. Tests for the PURE pinned-lineage helpers, the trail
// the explorer glows when it is opened from an open sequence. pinnedNodeMark
// decides whether a drawn node is the sequence's organism (the strongest mark),
// an ancestor on the trail toward it, or off-trail; lineageIdsFrom derives the
// root-to-organism tax-id set the highlight reads. No DOM, no d3.

import { describe, it, expect } from "vitest";
import {
  pinnedNodeMark,
  lineageIdsFrom,
  type PinnedLineage,
} from "./taxonomy-radial-layout";

describe("pinnedNodeMark", () => {
  const pinned: PinnedLineage = {
    organismTaxId: "7227",
    organismName: "Drosophila melanogaster",
    lineageIds: ["2759", "7215", "7227"],
  };

  it("marks the organism the strongest", () => {
    expect(pinnedNodeMark(pinned, "7227")).toBe("organism");
  });

  it("marks any other lineage tax id as a path node", () => {
    expect(pinnedNodeMark(pinned, "2759")).toBe("path");
    expect(pinnedNodeMark(pinned, "7215")).toBe("path");
  });

  it("marks a node off the trail as none", () => {
    expect(pinnedNodeMark(pinned, "9606")).toBe("none");
  });

  it("returns none when nothing is pinned", () => {
    expect(pinnedNodeMark(undefined, "7227")).toBe("none");
    expect(pinnedNodeMark(null, "7227")).toBe("none");
  });

  it("returns none for a blank tax id", () => {
    expect(pinnedNodeMark(pinned, "")).toBe("none");
  });

  it("prefers organism over path when the organism is also in lineageIds", () => {
    // The organism tax id is in lineageIds (the trail ends at it), so it must
    // still read as the organism, not a plain path node.
    expect(pinned.lineageIds).toContain(pinned.organismTaxId);
    expect(pinnedNodeMark(pinned, "7227")).toBe("organism");
  });
});

describe("lineageIdsFrom", () => {
  it("builds the root-to-organism tax-id trail and appends the organism", () => {
    const lineage = [
      { taxId: "2759", name: "Eukaryota", rank: "domain" },
      { taxId: "7215", name: "Drosophilidae", rank: "family" },
    ];
    expect(lineageIdsFrom(lineage, "7227")).toEqual(["2759", "7215", "7227"]);
  });

  it("does not duplicate the organism when it is already the last node", () => {
    const lineage = [
      { taxId: "2759", name: "Eukaryota", rank: "domain" },
      { taxId: "7227", name: "Drosophila melanogaster", rank: "species" },
    ];
    expect(lineageIdsFrom(lineage, "7227")).toEqual(["2759", "7227"]);
  });

  it("drops blank ids and de-duplicates, preserving order", () => {
    const lineage = [
      { taxId: " 2759 " },
      { taxId: "" },
      { taxId: "2759" },
      { taxId: "7215" },
    ];
    expect(lineageIdsFrom(lineage, "")).toEqual(["2759", "7215"]);
  });

  it("returns just the organism when the lineage is empty", () => {
    expect(lineageIdsFrom([], "7227")).toEqual(["7227"]);
    expect(lineageIdsFrom(undefined, "7227")).toEqual(["7227"]);
  });

  it("returns an empty array when nothing carries an id", () => {
    expect(lineageIdsFrom([], undefined)).toEqual([]);
    expect(lineageIdsFrom(undefined, undefined)).toEqual([]);
  });
});
