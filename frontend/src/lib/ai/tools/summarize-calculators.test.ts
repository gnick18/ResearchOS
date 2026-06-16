// Unit tests for the BeakerBot summarize_calculators tool (BeakerAI lane, 2026-06-16).

import { describe, it, expect } from "vitest";
import { aggregateCalculators } from "./summarize-calculators";
import { calculatorSummaryReport } from "@/lib/ai/summary-report";
import type { CustomCalculator } from "@/lib/types";

function calc(partial: Partial<CustomCalculator> & { id: number }): CustomCalculator {
  return {
    name: `calc-${partial.id}`,
    description: "",
    inputs: [],
    steps: [],
    conditionals: [],
    outputs: [],
    shared_with: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    owner: "me",
    // partial (which always carries the required id) overrides the defaults above.
    ...partial,
  };
}

const TODAY = "2026-06-16";

function sampleLibrary(): CustomCalculator[] {
  return [
    calc({ id: 1, name: "Molarity", field: "General", inputs: [{}, {}] as any, updated_at: "2026-06-10T00:00:00Z" }),
    calc({ id: 2, name: "Dilution", field: "General", inputs: [{}, {}, {}] as any, conditionals: [{}] as any, updated_at: "2026-06-14T00:00:00Z" }),
    calc({ id: 3, name: "OD600 growth", field: "Microbiology", inputs: [{}] as any, updated_at: "2026-06-12T00:00:00Z" }),
    // A shared-in calculator owned by alice, no field.
    calc({ id: 4, name: "Shared mix", owner: "alice", is_shared_with_me: true, inputs: [{}, {}, {}, {}] as any, updated_at: "2026-06-08T00:00:00Z" }),
  ];
}

describe("aggregateCalculators", () => {
  it("returns an empty summary for no calculators", () => {
    const s = aggregateCalculators([], {}, TODAY);
    expect(s.count).toBe(0);
    expect(s.avgInputs).toBeNull();
    expect(s.byField).toEqual([]);
  });

  it("counts, classifies, and averages deterministically", () => {
    const s = aggregateCalculators(sampleLibrary(), {}, TODAY);
    expect(s.count).toBe(4);
    expect(s.withConditionalsCount).toBe(1); // Dilution
    expect(s.sharedWithMeCount).toBe(1); // Shared mix
    expect(s.totalInputs).toBe(2 + 3 + 1 + 4);
    expect(s.avgInputs).toBe(Math.round(((2 + 3 + 1 + 4) / 4) * 10) / 10);
  });

  it("tallies by field (Ungrouped when no field) and by owner", () => {
    const s = aggregateCalculators(sampleLibrary(), {}, TODAY);
    expect(s.byField).toEqual([
      { field: "General", count: 2 },
      { field: "Microbiology", count: 1 },
      { field: "Ungrouped", count: 1 },
    ]);
    expect(s.byOwner).toEqual([
      { owner: "me", count: 3 },
      { owner: "alice", count: 1 },
    ]);
  });

  it("orders recentlyEdited by updated_at", () => {
    const s = aggregateCalculators(sampleLibrary(), {}, TODAY);
    expect(s.recentlyEdited.map((c) => c.name)).toEqual([
      "Dilution", // 06-14
      "OD600 growth", // 06-12
      "Molarity", // 06-10
      "Shared mix", // 06-08
    ]);
  });

  it("narrows by keyword and scopes to owners", () => {
    expect(aggregateCalculators(sampleLibrary(), { keywords: "growth" }, TODAY).count).toBe(1);
    expect(aggregateCalculators(sampleLibrary(), { owners: ["alice"] }, TODAY).count).toBe(1);
  });
});

describe("calculatorSummaryReport", () => {
  it("lifts the aggregate numbers verbatim into the report", () => {
    const s = aggregateCalculators(sampleLibrary(), {}, TODAY);
    const report = calculatorSummaryReport(s);
    expect(report.kind).toBe("summarize_calculators");
    expect(report.heading).toBe("Calculators");
    const stat = (label: string) => report.stats.find((t) => t.label === label)?.value;
    expect(stat("calculators")).toBe("4");
    expect(stat("with logic")).toBe("1");
    expect(stat("shared with you")).toBe("1");
    expect(report.barGroups.find((g) => g.title === "By field")).toBeTruthy();
  });
});
