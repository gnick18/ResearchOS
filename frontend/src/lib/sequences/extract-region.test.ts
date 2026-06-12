// Unit tests for extract-region.ts (cloning coworker, BeakerAI).
//
// Covers the three target shapes the brief calls out.
//   1. a forward slice by coordinates (carries + rebases overlapping features),
//   2. a reverse-strand slice (revcomp bases + mirrored, flipped features),
//   3. a by-feature-name slice (resolves the window AND the strand),
// plus the error cases (unknown feature, bad coordinates).
//
// Pure helper, no folder, no network.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { extractRegion, extractedRegionToImported } from "./extract-region";
import { genbankToDetail } from "./parse";
import type { SequenceAnnotation, SequenceDetail } from "../types";

// A 21 bp linear DNA with two features. Annotation ends are INCLUSIVE (the app
// convention), so these spans are half-open [4,10) and [12,18) respectively:
//   "fwd-cds"  inclusive 4..9   (half-open [4, 10))  direction +1
//   "rev-tag"  inclusive 12..17 (half-open [12, 18)) direction -1
const SEQ = "AAAATTTGGGCCCAACCGGTT"; // 21 bp, index-friendly
function detail(over?: Partial<SequenceDetail>): SequenceDetail {
  const annotations: SequenceAnnotation[] = [
    { name: "fwd-cds", start: 4, end: 9, direction: 1, type: "CDS" },
    { name: "rev-tag", start: 12, end: 17, direction: -1, type: "misc_feature" },
  ];
  return {
    id: 1,
    display_name: "Source",
    project_ids: [],
    added_at: "2026-06-12T00:00:00.000Z",
    seq_type: "dna",
    length: SEQ.length,
    circular: false,
    feature_count: annotations.length,
    genbank: "",
    seq: SEQ,
    annotations,
    locus_name: "Source",
    ...over,
  };
}

describe("extractRegion - forward slice by coordinates", () => {
  it("slices the forward window and rebases overlapping features", () => {
    const r = extractRegion(detail(), { start: 4, end: 12 });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    // Bases [4, 12) of SEQ.
    expect(r.seq).toBe(SEQ.slice(4, 12));
    expect(r.strand).toBe(1);
    expect(r.sourceStart).toBe(4);
    expect(r.sourceEnd).toBe(12);
    // fwd-cds [4,10) overlaps fully and rebases to half-open [0,6) -> inclusive
    // 0..5; rev-tag [12,18) is out of the window.
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0].name).toBe("fwd-cds");
    expect(r.annotations[0].start).toBe(0);
    expect(r.annotations[0].end).toBe(5); // inclusive
    expect(r.annotations[0].direction).toBe(1);
  });

  it("clips a feature that hangs off the left edge of the window", () => {
    // Window [6, 12) cuts fwd-cds [4,10) -> overlap [6,10) -> rebased [0,4) ->
    // inclusive 0..3.
    const r = extractRegion(detail(), { start: 6, end: 12 });
    if ("error" in r) throw new Error(r.error);
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0].name).toBe("fwd-cds");
    expect(r.annotations[0].start).toBe(0);
    expect(r.annotations[0].end).toBe(3); // inclusive
  });
});

describe("extractRegion - reverse-strand slice", () => {
  it("reverse-complements the bases and mirrors + flips overlapping features", () => {
    // Window [4, 12) on the minus strand.
    const r = extractRegion(detail(), { start: 4, end: 12, strand: -1 });
    if ("error" in r) throw new Error(r.error);
    const forward = SEQ.slice(4, 12);
    // The expected revcomp of the forward window.
    const expected = forward
      .split("")
      .reverse()
      .map((b) => ({ A: "T", T: "A", G: "C", C: "G" }[b] as string))
      .join("");
    expect(r.seq).toBe(expected);
    expect(r.strand).toBe(-1);
    // fwd-cds [4,10) -> overlap [4,10) within window len 8 -> mirrored half-open:
    //   mirStart = 8 - (10-4) = 2, mirExEnd = 8 - (4-4) = 8 -> inclusive 2..7.
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0].name).toBe("fwd-cds");
    expect(r.annotations[0].start).toBe(2);
    expect(r.annotations[0].end).toBe(7); // inclusive
    // Source direction +1 flips to -1 on a reverse extraction.
    expect(r.annotations[0].direction).toBe(-1);
  });
});

describe("extractRegion - by feature name", () => {
  it("resolves the window and strand from a forward feature", () => {
    const r = extractRegion(detail(), { featureName: "fwd-cds" });
    if ("error" in r) throw new Error(r.error);
    expect(r.seq).toBe(SEQ.slice(4, 10));
    expect(r.strand).toBe(1);
    expect(r.featureName).toBe("fwd-cds");
    // The feature itself rebases to span the whole extracted molecule (6 bp,
    // inclusive 0..5).
    expect(r.annotations[0].start).toBe(0);
    expect(r.annotations[0].end).toBe(5);
  });

  it("extracts a minus-strand feature as its reverse complement", () => {
    const r = extractRegion(detail(), { featureName: "rev-tag" });
    if ("error" in r) throw new Error(r.error);
    expect(r.strand).toBe(-1);
    const forward = SEQ.slice(12, 18);
    const expected = forward
      .split("")
      .reverse()
      .map((b) => ({ A: "T", T: "A", G: "C", C: "G" }[b] as string))
      .join("");
    expect(r.seq).toBe(expected);
    // rev-tag direction -1 flips to +1 when read on its own (minus) strand.
    expect(r.annotations[0].direction).toBe(1);
  });

  it("matches a feature name case-insensitively", () => {
    const r = extractRegion(detail(), { featureName: "FWD-CDS" });
    if ("error" in r) throw new Error(r.error);
    expect(r.featureName).toBe("fwd-cds");
  });
});

describe("extractRegion - error cases", () => {
  it("errors on an unknown feature name", () => {
    const r = extractRegion(detail(), { featureName: "nope" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/No feature named/);
  });

  it("errors on out-of-range coordinates", () => {
    const r = extractRegion(detail(), { start: 10, end: 999 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/invalid/);
  });

  it("errors when start >= end", () => {
    const r = extractRegion(detail(), { start: 8, end: 4 });
    expect("error" in r).toBe(true);
  });
});

// sequences / extract-locus — the wrapping/naming helper. The slice math is
// covered above; here we only assert that an ExtractedRegion becomes an
// ImportedSequence with the chosen name, dna type, the new bases, and its
// rebased annotations carried through as GenBank features.
describe("extractedRegionToImported", () => {
  it("wraps a feature extraction into a named dna ImportedSequence", () => {
    const r = extractRegion(detail(), { featureName: "fwd-cds" });
    if ("error" in r) throw new Error(r.error);
    const imported = extractedRegionToImported(r, "fwd-cds (from Source)");
    expect(imported.display_name).toBe("fwd-cds (from Source)");
    expect(imported.seq_type).toBe("dna");
    expect(imported.length).toBe(r.seq.length);
    // The GenBank round-trips back to the same bases and carries the feature.
    const back = genbankToDetail(imported.genbank, {
      id: -1,
      display_name: imported.display_name,
      project_ids: [],
      added_at: new Date().toISOString(),
      seq_type: "dna",
    });
    expect(back).not.toBeNull();
    expect(back?.seq).toBe(r.seq);
    expect(back?.annotations.map((a) => a.name)).toContain("fwd-cds");
  });

  it("falls back to a calm name and carries no features for a bare slice", () => {
    const r = extractRegion(detail(), { start: 0, end: 4 });
    if ("error" in r) throw new Error(r.error);
    const imported = extractedRegionToImported(r, "   ");
    expect(imported.display_name).toBe("Extracted sequence");
    expect(imported.seq_type).toBe("dna");
    expect(imported.length).toBe(4);
  });
});
