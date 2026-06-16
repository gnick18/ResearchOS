// Unit tests for the BeakerBot summarize_chemistry tool (BeakerAI lane, 2026-06-16).
//
// Strategy: drive the pure aggregateChemistry core with fixtures + a frozen
// project-name map + a fixed today and assert the exact counts, totals, and
// buckets, then assert chemistrySummaryReport lifts those numbers verbatim.

import { describe, it, expect } from "vitest";
import { aggregateChemistry } from "./summarize-chemistry";
import { chemistrySummaryReport } from "@/lib/ai/summary-report";
import type { Molecule } from "@/lib/chemistry/api";

function mol(partial: Partial<Molecule> & { id: string }): Molecule {
  return {
    name: `mol-${partial.id}`,
    project_ids: [],
    added_at: "2026-06-01T00:00:00Z",
    // partial (which always carries the required id) overrides the defaults above.
    ...partial,
  };
}

const PROJECT_NAMES = new Map<string, string>([["10", "Inhibitors"]]);
const TODAY = "2026-06-16";

function sampleLibrary(): Molecule[] {
  return [
    mol({ id: "1", name: "Caffeine", source: "pubchem", formula: "C8H10N4O2", smiles: "CN1C=NC2=C1C(=O)N(C)C(=O)N2C", mol_weight: 194.19, project_ids: ["10"], added_at: "2026-06-10T00:00:00Z", pubchem_cid: 2519, starred_papers: [{ title: "p1", year: "2020", type: "research", starred_at: "x" }] }),
    mol({ id: "2", name: "Aspirin", source: "drawn", formula: "C9H8O4", smiles: "CC(=O)OC1=CC=CC=C1C(=O)O", mol_weight: 180.16, project_ids: ["10"], added_at: "2026-06-12T00:00:00Z" }),
    mol({ id: "3", name: "Big ligand", source: "imported", formula: "C40H60N8O10", smiles: "C...", mol_weight: 820.9, project_ids: [], added_at: "2026-06-14T00:00:00Z" }),
    // A sketch with no structure / weight, unfiled.
    mol({ id: "4", name: "sketch", source: "drawn", project_ids: [], added_at: "2026-06-08T00:00:00Z" }),
  ];
}

describe("aggregateChemistry", () => {
  it("returns an empty summary for no molecules", () => {
    const s = aggregateChemistry([], {}, PROJECT_NAMES, TODAY);
    expect(s.count).toBe(0);
    expect(s.avgWeight).toBeNull();
    expect(s.bySource).toEqual([]);
    expect(s.heaviest).toEqual([]);
  });

  it("counts, totals, and averages deterministically", () => {
    const s = aggregateChemistry(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    expect(s.count).toBe(4);
    expect(s.withStructureCount).toBe(3); // 1, 2, 3 have smiles
    expect(s.withFormulaCount).toBe(3);
    expect(s.unfiledCount).toBe(2); // Big ligand + sketch
    expect(s.weightedCount).toBe(3); // 1, 2, 3 carry mol_weight
    expect(s.totalWeight).toBe(Math.round((194.19 + 180.16 + 820.9) * 100) / 100);
    expect(s.avgWeight).toBe(Math.round(((194.19 + 180.16 + 820.9) / 3) * 100) / 100);
    expect(s.starredLiteratureCount).toBe(1);
  });

  it("tallies by source", () => {
    const s = aggregateChemistry(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    expect(s.bySource).toEqual([
      { source: "drawn", count: 2 },
      { source: "imported", count: 1 },
      { source: "pubchem", count: 1 },
    ]);
  });

  it("resolves project names", () => {
    const s = aggregateChemistry(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    expect(s.byProject).toEqual([{ projectId: "10", projectName: "Inhibitors", count: 2 }]);
  });

  it("bins molecular weights", () => {
    const s = aggregateChemistry(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    const bin = (label: string) => s.weightBins.find((b) => b.label === label)?.count;
    expect(bin("150 to 300")).toBe(2); // caffeine 194, aspirin 180
    expect(bin("> 800")).toBe(1); // big ligand 820
    expect(bin("< 150")).toBe(0);
  });

  it("orders heaviest by weight and recentlyAdded by date", () => {
    const s = aggregateChemistry(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    expect(s.heaviest.map((m) => m.name)).toEqual(["Big ligand", "Caffeine", "Aspirin"]);
    expect(s.recentlyAdded.map((m) => m.name)).toEqual(["Big ligand", "Aspirin", "Caffeine", "sketch"]);
  });

  it("narrows by keyword and by project", () => {
    expect(aggregateChemistry(sampleLibrary(), { keywords: "caffeine" }, PROJECT_NAMES, TODAY).count).toBe(1);
    expect(aggregateChemistry(sampleLibrary(), { project: "Inhibitors" }, PROJECT_NAMES, TODAY).count).toBe(2);
  });
});

describe("chemistrySummaryReport", () => {
  it("lifts the aggregate numbers verbatim into the report", () => {
    const s = aggregateChemistry(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    const report = chemistrySummaryReport(s);
    expect(report.kind).toBe("summarize_chemistry");
    expect(report.heading).toBe("Chemistry");
    const stat = (label: string) => report.stats.find((t) => t.label === label)?.value;
    expect(stat("molecules")).toBe("4");
    expect(stat("with a structure")).toBe("3");
    expect(stat("avg MW")).toBe(String(s.avgWeight));
    const groups = report.barGroups.map((g) => g.title);
    expect(groups).toContain("By source");
    expect(groups).toContain("By project");
    expect(report.histogram?.title).toContain("molecular weight");
  });
});
