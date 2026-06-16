// Unit tests for the BeakerBot summarize_sequences tool (BeakerAI lane, 2026-06-16).
//
// Strategy: drive the pure aggregateSequences core with owner-tagged fixtures + a
// frozen project-name map + a fixed today, and assert the exact counts, totals,
// and buckets. Then assert sequenceSummaryReport lifts those numbers verbatim. No
// real file system, no model.

import { describe, it, expect } from "vitest";
import {
  aggregateSequences,
  type OwnedSequence,
} from "./summarize-sequences";
import { sequenceSummaryReport } from "@/lib/ai/summary-report";

function seq(partial: Partial<OwnedSequence> & { id: number }): OwnedSequence {
  return {
    display_name: `seq-${partial.id}`,
    project_ids: [],
    added_at: "2026-06-01T00:00:00Z",
    seq_type: "dna",
    length: 1000,
    circular: false,
    feature_count: 0,
    owner: "me",
    // partial (which always carries the required id) overrides the defaults above.
    ...partial,
  };
}

const PROJECT_NAMES = new Map<string, string>([
  ["10", "Cloning"],
  ["20", "Expression"],
]);

const TODAY = "2026-06-16";

function sampleLibrary(): OwnedSequence[] {
  return [
    // Two plasmids (circular dna) in the Cloning project.
    seq({ id: 1, display_name: "pUC19", seq_type: "dna", circular: true, length: 2686, feature_count: 4, project_ids: ["10"], added_at: "2026-06-10T00:00:00Z" }),
    seq({ id: 2, display_name: "pET28a", seq_type: "dna", circular: true, length: 5369, feature_count: 7, project_ids: ["10", "20"], added_at: "2026-06-12T00:00:00Z" }),
    // A linear genomic dna, NCBI-sourced, unfiled.
    seq({ id: 3, display_name: "genome-frag", seq_type: "dna", circular: false, length: 14200, feature_count: 30, project_ids: [], added_at: "2026-06-14T00:00:00Z", source: "ncbi-datasets", organism: "Escherichia coli" }),
    // A short primer (linear dna), imported via a share.
    seq({ id: 4, display_name: "M13-fwd", seq_type: "dna", circular: false, length: 18, feature_count: 0, project_ids: ["20"], added_at: "2026-06-05T00:00:00Z", received_from: "alice@example.com" }),
    // A protein record.
    seq({ id: 5, display_name: "GFP", seq_type: "protein", circular: false, length: 238, feature_count: 1, project_ids: [], added_at: "2026-06-08T00:00:00Z", organism: "Aequorea victoria", source: "ncbi-efetch" }),
  ];
}

describe("aggregateSequences", () => {
  it("returns an empty summary for no records", () => {
    const s = aggregateSequences([], {}, PROJECT_NAMES, TODAY);
    expect(s.count).toBe(0);
    expect(s.totalBases).toBe(0);
    expect(s.totalFeatures).toBe(0);
    expect(s.plasmidCount).toBe(0);
    expect(s.byType).toEqual([]);
    expect(s.longest).toEqual([]);
    expect(s.recentlyAdded).toEqual([]);
  });

  it("counts, totals, and buckets deterministically", () => {
    const s = aggregateSequences(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    expect(s.count).toBe(5);
    expect(s.totalBases).toBe(2686 + 5369 + 14200 + 18 + 238);
    expect(s.totalFeatures).toBe(4 + 7 + 30 + 0 + 1);
    expect(s.plasmidCount).toBe(2); // pUC19 + pET28a (circular dna)
    expect(s.unfiledCount).toBe(2); // genome-frag + GFP
    expect(s.importedCount).toBe(1); // M13-fwd
    expect(s.ncbiCount).toBe(2); // genome-frag + GFP
  });

  it("tallies by type and topology", () => {
    const s = aggregateSequences(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    expect(s.byType).toEqual([
      { type: "dna", count: 4 },
      { type: "protein", count: 1 },
    ]);
    expect(s.byTopology).toEqual([
      { topology: "linear", count: 3 },
      { topology: "circular", count: 2 },
    ]);
  });

  it("resolves project names and flags unfiled separately", () => {
    const s = aggregateSequences(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    // pUC19 -> [10], pET28a -> [10,20], M13-fwd -> [20]
    expect(s.byProject).toEqual([
      { projectId: "10", projectName: "Cloning", count: 2 },
      { projectId: "20", projectName: "Expression", count: 2 },
    ]);
  });

  it("tallies NCBI organisms", () => {
    const s = aggregateSequences(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    expect(s.byOrganism).toEqual([
      { organism: "Aequorea victoria", count: 1 },
      { organism: "Escherichia coli", count: 1 },
    ]);
  });

  it("bins lengths into the fixed buckets", () => {
    const s = aggregateSequences(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    const bin = (label: string) => s.lengthBins.find((b) => b.label === label)?.count;
    expect(bin("< 1 kb")).toBe(2); // M13-fwd (18), GFP (238)
    expect(bin("1 to 3 kb")).toBe(1); // pUC19 (2686)
    expect(bin("3 to 6 kb")).toBe(1); // pET28a (5369)
    expect(bin("6 to 10 kb")).toBe(0);
    expect(bin("> 10 kb")).toBe(1); // genome-frag (14200)
  });

  it("orders longest by length and recentlyAdded by date", () => {
    const s = aggregateSequences(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    expect(s.longest.map((r) => r.name)).toEqual([
      "genome-frag", // 14200
      "pET28a", // 5369
      "pUC19", // 2686
      "GFP", // 238
      "M13-fwd", // 18
    ]);
    expect(s.recentlyAdded.map((r) => r.name)).toEqual([
      "genome-frag", // 06-14
      "pET28a", // 06-12
      "pUC19", // 06-10
      "GFP", // 06-08
      "M13-fwd", // 06-05
    ]);
  });

  it("narrows by keyword (name / organism / accession / type)", () => {
    const s = aggregateSequences(sampleLibrary(), { keywords: "coli" }, PROJECT_NAMES, TODAY);
    expect(s.count).toBe(1);
    expect(s.byOrganism).toEqual([{ organism: "Escherichia coli", count: 1 }]);
  });

  it("narrows by project name", () => {
    const s = aggregateSequences(sampleLibrary(), { project: "Cloning" }, PROJECT_NAMES, TODAY);
    expect(s.count).toBe(2); // pUC19 + pET28a
    expect(s.byType).toEqual([{ type: "dna", count: 2 }]);
  });

  it("reports byOwner only when more than one owner is scoped", () => {
    const single = aggregateSequences(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    expect(single.byOwner).toEqual([]);

    const mixed = aggregateSequences(
      [seq({ id: 1, owner: "me" }), seq({ id: 2, owner: "alice" }), seq({ id: 3, owner: "alice" })],
      {},
      PROJECT_NAMES,
      TODAY,
    );
    expect(mixed.byOwner).toEqual([
      { owner: "alice", count: 2 },
      { owner: "me", count: 1 },
    ]);
  });
});

describe("sequenceSummaryReport", () => {
  it("lifts the aggregate numbers verbatim into the report", () => {
    const s = aggregateSequences(sampleLibrary(), {}, PROJECT_NAMES, TODAY);
    const report = sequenceSummaryReport(s);
    expect(report.kind).toBe("summarize_sequences");
    expect(report.heading).toBe("Sequences");
    expect(report.scope).toContain("your library");
    const stat = (label: string) => report.stats.find((t) => t.label === label)?.value;
    expect(stat("sequences")).toBe("5");
    expect(stat("plasmids")).toBe("2");
    expect(stat("features")).toBe(String(4 + 7 + 30 + 0 + 1));
    const groups = report.barGroups.map((g) => g.title);
    expect(groups).toContain("By type");
    expect(groups).toContain("By topology");
    expect(groups).toContain("By project");
    expect(report.histogram?.title).toBe("By length");
  });

  it("omits the histogram for a single sequence", () => {
    const s = aggregateSequences([seq({ id: 1 })], {}, PROJECT_NAMES, TODAY);
    const report = sequenceSummaryReport(s);
    expect(report.histogram).toBeNull();
  });
});
