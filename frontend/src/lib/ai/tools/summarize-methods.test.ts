// Unit tests for the BeakerBot summarize_methods tool (BeakerAI lane, 2026-06-16).
//
// Strategy: drive the pure aggregateMethods core with fixtures + a fixed today and
// assert the exact counts and buckets, then assert methodSummaryReport lifts those
// numbers verbatim. No real file system, no model.

import { describe, it, expect } from "vitest";
import { aggregateMethods } from "./summarize-methods";
import { methodSummaryReport } from "@/lib/ai/summary-report";
import type { Method } from "@/lib/types";

function method(partial: Partial<Method> & { id: number }): Method {
  return {
    name: `method-${partial.id}`,
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: "me",
    owner: "me",
    shared_with: [],
    // partial (which always carries the required id) overrides the defaults above.
    ...partial,
  };
}

const TODAY = "2026-06-16";

function sampleLibrary(): Method[] {
  return [
    method({ id: 1, name: "Miniprep", method_type: "markdown", owner: "me", tags: ["cloning"], last_edited_at: "2026-06-10T00:00:00Z" }),
    method({ id: 2, name: "Colony PCR", method_type: "pcr", owner: "me", tags: ["cloning", "pcr"], last_edited_at: "2026-06-14T00:00:00Z" }),
    method({ id: 3, name: "qPCR analysis", method_type: "qpcr_analysis", owner: "me", parent_method_id: 2, last_edited_at: "2026-06-12T00:00:00Z" }),
    method({ id: 4, name: "Cloning pipeline", method_type: "compound", owner: "me", tags: ["cloning"] }),
    // A method shared with me by alice, imported via a share.
    method({ id: 5, name: "Western blot", method_type: "plate", owner: "alice", is_shared_with_me: true, received_from: "alice@example.com", tags: ["protein"] }),
    // An untyped legacy record.
    method({ id: 6, name: "Old notes", method_type: null, owner: "me" }),
  ];
}

describe("aggregateMethods", () => {
  it("returns an empty summary for no methods", () => {
    const s = aggregateMethods([], {}, TODAY);
    expect(s.count).toBe(0);
    expect(s.structuredCount).toBe(0);
    expect(s.byType).toEqual([]);
    expect(s.recentlyEdited).toEqual([]);
  });

  it("counts and classifies deterministically", () => {
    const s = aggregateMethods(sampleLibrary(), {}, TODAY);
    expect(s.count).toBe(6);
    // structured = pcr, qpcr_analysis, compound, plate (not markdown / null)
    expect(s.structuredCount).toBe(4);
    expect(s.compoundCount).toBe(1);
    expect(s.forkedCount).toBe(1); // qPCR analysis (parent_method_id 2)
    expect(s.importedCount).toBe(1); // Western blot
    expect(s.sharedWithMeCount).toBe(1); // Western blot
  });

  it("tallies by type with readable labels", () => {
    const s = aggregateMethods(sampleLibrary(), {}, TODAY);
    const byType = Object.fromEntries(s.byType.map((b) => [b.type, b.count]));
    expect(byType).toEqual({
      markdown: 1,
      pcr: 1,
      qpcr_analysis: 1,
      compound: 1,
      plate: 1,
      untyped: 1,
    });
    expect(s.byType.find((b) => b.type === "qpcr_analysis")?.label).toBe("qPCR analysis");
    expect(s.byType.find((b) => b.type === "untyped")?.label).toBe("Untyped");
  });

  it("tallies by owner and by tag", () => {
    const s = aggregateMethods(sampleLibrary(), {}, TODAY);
    expect(s.byOwner).toEqual([
      { owner: "me", count: 5 },
      { owner: "alice", count: 1 },
    ]);
    expect(s.byTag).toEqual([
      { tag: "cloning", count: 3 },
      { tag: "pcr", count: 1 },
      { tag: "protein", count: 1 },
    ]);
  });

  it("orders recentlyEdited by last_edited_at, dropping records with no date", () => {
    const s = aggregateMethods(sampleLibrary(), {}, TODAY);
    expect(s.recentlyEdited.map((m) => m.name)).toEqual([
      "Colony PCR", // 06-14
      "qPCR analysis", // 06-12
      "Miniprep", // 06-10
    ]);
  });

  it("scopes to specific owners", () => {
    const s = aggregateMethods(sampleLibrary(), { owners: ["alice"] }, TODAY);
    expect(s.count).toBe(1);
    expect(s.byOwner).toEqual([{ owner: "alice", count: 1 }]);
  });

  it("narrows by keyword (name / type / tag)", () => {
    const s = aggregateMethods(sampleLibrary(), { keywords: "cloning" }, TODAY);
    // Miniprep, Colony PCR, Cloning pipeline (all tagged cloning) + "Cloning" in a name
    expect(s.count).toBe(3);
  });
});

describe("methodSummaryReport", () => {
  it("lifts the aggregate numbers verbatim into the report", () => {
    const s = aggregateMethods(sampleLibrary(), {}, TODAY);
    const report = methodSummaryReport(s);
    expect(report.kind).toBe("summarize_methods");
    expect(report.heading).toBe("Methods");
    expect(report.scope).toContain("whole lab");
    const stat = (label: string) => report.stats.find((t) => t.label === label)?.value;
    expect(stat("methods")).toBe("6");
    expect(stat("structured")).toBe("4");
    expect(stat("shared with you")).toBe("1");
    const groups = report.barGroups.map((g) => g.title);
    expect(groups).toContain("By type");
    expect(groups).toContain("By owner");
    expect(groups).toContain("By tag");
    expect(report.histogram).toBeNull();
  });
});
