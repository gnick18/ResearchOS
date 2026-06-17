// sequence Phase 2c bot — pure feature CRUD + multi-segment preservation tests.

import { describe, it, expect } from "vitest";
import {
  addFeature,
  updateFeature,
  duplicateFeature,
  deleteFeature,
  setFeatureColor,
  renameFeature,
  setTypeColor,
  featureTypes,
  featureLength,
  segmentsOf,
  normalizeSegments,
  splitSegment,
  mergeSegment,
  deleteSegment,
  qualifiersFromNotes,
  notesFromQualifiers,
  readNoteFlag,
  withNoteFlag,
  validateSegmentCoords,
  validateAllSegments,
  TRANSLATE_NOTE_KEY,
  PRIORITIZE_NOTE_KEY,
  type FeatureDraft,
  type FeatureSegment,
} from "./feature-edit";
import {
  documentToGenbank,
  documentFromDetail,
  type SeqDocument,
  type EditFeature,
} from "./edit-model";
import { genbankToDetail } from "./parse";
import type { SequenceDetail, SequenceMeta } from "../types";

function doc(features: EditFeature[] = []): SeqDocument {
  return {
    name: "test",
    seq: "ATGC".repeat(25), // 100 bp
    seqType: "dna",
    circular: false,
    features,
  };
}

function feat(over: Partial<EditFeature> = {}): EditFeature {
  return {
    name: "f",
    type: "CDS",
    start: 0,
    end: 10,
    strand: 1,
    forward: true,
    ...over,
  };
}

const draft = (over: Partial<FeatureDraft> = {}): FeatureDraft => ({
  name: "newFeat",
  type: "promoter",
  strand: 1,
  start: 5,
  end: 20,
  ...over,
});

describe("addFeature", () => {
  it("adds a feature with a normalized range", () => {
    const d = addFeature(doc(), draft());
    expect(d.features).toHaveLength(1);
    expect(d.features[0]).toMatchObject({
      name: "newFeat",
      type: "promoter",
      start: 5,
      end: 20,
      strand: 1,
    });
  });
  it("clamps out-of-range coordinates and swaps inverted ranges", () => {
    const d = addFeature(doc(), draft({ start: 90, end: 200 }));
    expect(d.features[0].start).toBe(90);
    expect(d.features[0].end).toBe(100);
    const d2 = addFeature(doc(), draft({ start: 40, end: 10 }));
    expect(d2.features[0].start).toBe(10);
    expect(d2.features[0].end).toBe(40);
  });
  it("does not mutate the input document", () => {
    const base = doc();
    addFeature(base, draft());
    expect(base.features).toHaveLength(0);
  });
});

describe("updateFeature", () => {
  it("edits name/type/strand/range", () => {
    const d = updateFeature(doc([feat()]), 0, draft({ strand: -1 }));
    expect(d.features[0]).toMatchObject({
      name: "newFeat",
      type: "promoter",
      strand: -1,
      forward: false,
      start: 5,
      end: 20,
    });
  });
  it("preserves a multi-segment locations array when the range is unchanged", () => {
    const segs = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ];
    const f = feat({ start: 0, end: 30, locations: segs });
    const d = updateFeature(doc([f]), 0, draft({ start: 0, end: 30, name: "renamed" }));
    expect(d.features[0].name).toBe("renamed");
    expect(d.features[0].locations).toEqual(segs);
  });
  it("drops a now-stale locations array when the range changes", () => {
    const f = feat({ start: 0, end: 30, locations: [{ start: 0, end: 10 }, { start: 20, end: 30 }] });
    const d = updateFeature(doc([f]), 0, draft({ start: 0, end: 40 }));
    expect(d.features[0].locations).toBeUndefined();
  });
});

describe("setFeatureColor", () => {
  it("sets and clears a per-feature color", () => {
    const d = setFeatureColor(doc([feat()]), 0, "#ff0000");
    expect(d.features[0].color).toBe("#ff0000");
    const cleared = setFeatureColor(d, 0, "  ");
    expect(cleared.features[0].color).toBeUndefined();
  });
});

describe("renameFeature", () => {
  it("renames the target feature and leaves the others alone", () => {
    const d = renameFeature(
      doc([feat({ name: "a" }), feat({ name: "b" }), feat({ name: "c" })]),
      1,
      "renamed",
    );
    expect(d.features.map((f) => f.name)).toEqual(["a", "renamed", "c"]);
  });
  it("trims the new name", () => {
    const d = renameFeature(doc([feat({ name: "a" })]), 0, "  spaced  ");
    expect(d.features[0].name).toBe("spaced");
  });
  it("falls back to Untitled on a blank name", () => {
    const d = renameFeature(doc([feat({ name: "a" })]), 0, "   ");
    expect(d.features[0].name).toBe("Untitled");
  });
  it("touches nothing else on the feature", () => {
    const f = feat({ name: "a", type: "CDS", start: 3, end: 9, color: "#abcdef" });
    const d = renameFeature(doc([f]), 0, "b");
    expect(d.features[0]).toMatchObject({
      type: "CDS",
      start: 3,
      end: 9,
      color: "#abcdef",
      name: "b",
    });
  });
  it("is a no-op (same reference) on an out-of-range index", () => {
    const base = doc([feat({ name: "a" })]);
    expect(renameFeature(base, -1, "x")).toBe(base);
    expect(renameFeature(base, 5, "x")).toBe(base);
  });
  it("is a no-op (same reference) when the name is unchanged", () => {
    const base = doc([feat({ name: "keep" })]);
    expect(renameFeature(base, 0, "keep")).toBe(base);
    // also a no-op when the trimmed name matches
    expect(renameFeature(base, 0, "  keep  ")).toBe(base);
  });
});

describe("setTypeColor", () => {
  it("colors every feature of a type that lacks an explicit color", () => {
    const d = setTypeColor(
      doc([feat({ type: "CDS" }), feat({ type: "promoter" }), feat({ type: "cds" })]),
      "CDS",
      "#00ff00",
    );
    expect(d.features[0].color).toBe("#00ff00");
    expect(d.features[1].color).toBeUndefined(); // different type
    expect(d.features[2].color).toBe("#00ff00"); // case-insensitive
  });
  it("respects per-feature color overrides", () => {
    const d = setTypeColor(doc([feat({ type: "CDS", color: "#abcdef" })]), "CDS", "#00ff00");
    expect(d.features[0].color).toBe("#abcdef");
  });
  it("returns the same doc reference when nothing changes", () => {
    const base = doc([feat({ type: "CDS", color: "#abcdef" })]);
    expect(setTypeColor(base, "CDS", "#00ff00")).toBe(base);
  });
});

describe("duplicateFeature", () => {
  it("inserts a deep-copied feature right after the original", () => {
    const segs = [{ start: 0, end: 10 }, { start: 20, end: 30 }];
    const d = duplicateFeature(doc([feat({ name: "orig", locations: segs })]), 0);
    expect(d.features).toHaveLength(2);
    expect(d.features[1].name).toBe("orig copy");
    expect(d.features[1].locations).toEqual(segs);
    expect(d.features[1].locations).not.toBe(segs); // deep copy
  });
});

describe("deleteFeature", () => {
  it("removes the feature at the index", () => {
    const d = deleteFeature(doc([feat({ name: "a" }), feat({ name: "b" })]), 0);
    expect(d.features).toHaveLength(1);
    expect(d.features[0].name).toBe("b");
  });
});

describe("featureTypes / featureLength", () => {
  it("lists distinct lowercased sorted types", () => {
    expect(featureTypes(doc([feat({ type: "CDS" }), feat({ type: "promoter" }), feat({ type: "cds" })]))).toEqual([
      "cds",
      "promoter",
    ]);
  });
  it("sums multi-segment lengths", () => {
    expect(featureLength(feat({ start: 0, end: 30, locations: [{ start: 0, end: 10 }, { start: 20, end: 30 }] }))).toBe(20);
    expect(featureLength(feat({ start: 5, end: 20 }))).toBe(15);
  });
});

// ── multi-segment survives save+reload ──────────────────────────────────────
const MULTI_SEG_GB = `LOCUS       introntest             60 bp    DNA     linear   SYN 02-JUN-2026
FEATURES             Location/Qualifiers
     CDS             join(1..10,31..40)
                     /label="splicedGene"
                     /ApEinfo_fwdcolor="#34d399"
ORIGIN
        1 atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc
//`;

describe("multi-segment feature display + preservation", () => {
  it("parses a join() feature into multiple locations", () => {
    const detail = genbankToDetail(MULTI_SEG_GB, meta())!;
    const d = documentFromDetail({ ...detail, genbank: MULTI_SEG_GB } as SequenceDetail);
    const f = d.features[0];
    expect(f.locations && f.locations.length).toBeGreaterThan(1);
  });
  it("preserves multiple segments through a save round-trip", () => {
    const detail = genbankToDetail(MULTI_SEG_GB, meta())!;
    const d = documentFromDetail({ ...detail, genbank: MULTI_SEG_GB } as SequenceDetail);
    const gb = documentToGenbank(d)!;
    expect(gb).toContain("join(");
    const detail2 = genbankToDetail(gb, meta())!;
    const d2 = documentFromDetail({ ...detail2, genbank: gb } as SequenceDetail);
    expect(d2.features[0].locations && d2.features[0].locations.length).toBeGreaterThan(1);
  });
});

function meta(): SequenceMeta {
  return {
    id: 1,
    display_name: "test",
    project_ids: [],
    added_at: "2026-06-02T00:00:00Z",
    seq_type: "dna",
  };
}

// --- SEGMENT TABLE: split / merge / delete (Phase 2c2) ----------------------

describe("segment operations", () => {
  it("segmentsOf returns one row for a single-segment feature", () => {
    expect(segmentsOf({ start: 3, end: 30 })).toEqual([{ start: 3, end: 30 }]);
  });
  it("segmentsOf returns the locations for a multi-segment feature", () => {
    const locs = [
      { start: 3, end: 12 },
      { start: 20, end: 30 },
    ];
    expect(segmentsOf({ start: 3, end: 30, locations: locs })).toEqual(locs);
  });

  it("splitSegment splits one segment into a join() of two", () => {
    const out = splitSegment([{ start: 0, end: 30 }], 0);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ start: 0, end: 15 });
    expect(out[1]).toMatchObject({ start: 15, end: 30 });
  });
  it("splitSegment refuses to split a 1-bp segment", () => {
    const segs = [{ start: 5, end: 6 }];
    expect(splitSegment(segs, 0)).toEqual(segs);
  });

  it("mergeSegment combines a segment with the next one", () => {
    const out = mergeSegment(
      [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ],
      0,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 0, end: 30 });
  });

  it("deleteSegment removes a row but never the last one", () => {
    const two = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ];
    expect(deleteSegment(two, 0)).toEqual([{ start: 20, end: 30 }]);
    expect(deleteSegment([{ start: 0, end: 10 }], 0)).toEqual([{ start: 0, end: 10 }]);
  });

  it("normalizeSegments clamps, sorts, drops empties and computes the span", () => {
    const r = normalizeSegments(
      [
        { start: 40, end: 30 }, // inverted -> swapped to 30..40
        { start: 5, end: 5 }, // empty -> dropped
        { start: 0, end: 10 },
      ],
      100,
    );
    expect(r.segments).toEqual([
      { start: 0, end: 10, color: undefined },
      { start: 30, end: 40, color: undefined },
    ]);
    expect(r.start).toBe(0);
    expect(r.end).toBe(40);
  });

  it("editing a feature with a 2-segment draft writes a join()", () => {
    const f = feat({ start: 0, end: 30 });
    const d = updateFeature(doc([f]), 0, draft({
      start: 0,
      end: 30,
      segments: [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ],
    }));
    expect(d.features[0].locations).toHaveLength(2);
    expect(d.features[0].start).toBe(0);
    expect(d.features[0].end).toBe(30);
    const gb = documentToGenbank(d)!;
    expect(gb).toContain("join(");
  });

  it("collapsing a multi-segment draft to one segment drops locations", () => {
    const f = feat({ start: 0, end: 30, locations: [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ] });
    const d = updateFeature(doc([f]), 0, draft({
      start: 0,
      end: 30,
      segments: [{ start: 0, end: 30 }],
    }));
    expect(d.features[0].locations).toBeUndefined();
  });
});

// --- QUALIFIERS: notes <-> rows + .gb round-trip (Phase 2c2) -----------------

describe("qualifier editing", () => {
  it("qualifiersFromNotes flattens notes, hiding reserved keys", () => {
    const rows = qualifiersFromNotes({
      product: ["DNA polymerase"],
      note: ["two", "lines"],
      ApEinfo_fwdcolor: ["#ff0000"],
      [TRANSLATE_NOTE_KEY]: ["1"],
    });
    expect(rows).toEqual([
      { key: "product", value: "DNA polymerase" },
      { key: "note", value: "two" },
      { key: "note", value: "lines" },
    ]);
  });

  it("notesFromQualifiers groups repeated keys and preserves reserved keys", () => {
    const out = notesFromQualifiers(
      [
        { key: "note", value: "a" },
        { key: "note", value: "b" },
        { key: "gene", value: "abc1" },
        { key: "", value: "ignored" },
      ],
      { ApEinfo_fwdcolor: ["#00ff00"] },
    );
    expect(out).toMatchObject({
      note: ["a", "b"],
      gene: ["abc1"],
      ApEinfo_fwdcolor: ["#00ff00"],
    });
  });

  it("toggle flags read/write through notes", () => {
    const on = withNoteFlag(undefined, TRANSLATE_NOTE_KEY, true);
    expect(readNoteFlag(on, TRANSLATE_NOTE_KEY)).toBe(true);
    const off = withNoteFlag(on, TRANSLATE_NOTE_KEY, false);
    expect(readNoteFlag(off, TRANSLATE_NOTE_KEY)).toBe(false);
  });

  it("a qualifier survives jsonToGenbank -> genbankToJson round-trip", () => {
    const f = feat({ start: 0, end: 30 });
    const d = updateFeature(doc([f]), 0, draft({
      start: 0,
      end: 30,
      name: "polA",
      type: "CDS",
      qualifiers: [
        { key: "product", value: "DNA polymerase I" },
        { key: "note", value: "added in edit" },
        { key: "gene", value: "polA" },
      ],
    }));
    const gb = documentToGenbank(d)!;
    expect(gb).toContain("/product=");
    const detail2 = genbankToDetail(gb, meta())!;
    const d2 = documentFromDetail({ ...detail2, genbank: gb } as SequenceDetail);
    const notes = (d2.features[0].notes || {}) as Record<string, unknown>;
    const rows = qualifiersFromNotes(notes);
    expect(rows).toContainEqual({ key: "product", value: "DNA polymerase I" });
    expect(rows).toContainEqual({ key: "note", value: "added in edit" });
    expect(rows).toContainEqual({ key: "gene", value: "polA" });
  });

  it("the translate toggle survives a .gb round-trip", () => {
    const f = feat({ start: 0, end: 30, type: "CDS" });
    const d = updateFeature(doc([f]), 0, draft({
      start: 0,
      end: 30,
      type: "CDS",
      qualifiers: [],
      translate: true,
    }));
    const gb = documentToGenbank(d)!;
    const detail2 = genbankToDetail(gb, meta())!;
    const d2 = documentFromDetail({ ...detail2, genbank: gb } as SequenceDetail);
    expect(readNoteFlag(d2.features[0].notes, TRANSLATE_NOTE_KEY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSegmentCoords + validateAllSegments (P1 bounds validation)
// ---------------------------------------------------------------------------

describe("validateSegmentCoords", () => {
  const SEQ_LEN = 4733; // matches the stress-test scenario

  it("accepts a valid in-range segment", () => {
    const r = validateSegmentCoords(0, 100, SEQ_LEN);
    expect(r.ok).toBe(true);
    expect(r.start).toBe(0);
    expect(r.end).toBe(100);
    expect(r.message).toBeUndefined();
  });

  it("accepts a segment spanning exactly the full sequence", () => {
    const r = validateSegmentCoords(0, SEQ_LEN, SEQ_LEN);
    expect(r.ok).toBe(true);
    expect(r.start).toBe(0);
    expect(r.end).toBe(SEQ_LEN);
  });

  it("rejects end > seqLen (the stress-test scenario: end=99999 on 4733 bp)", () => {
    const r = validateSegmentCoords(0, 99999, SEQ_LEN);
    // end is clamped but start >= clamped end is NOT the case here; end clamps to seqLen
    expect(r.ok).toBe(true); // clamped end 4733 > start 0 => valid
    expect(r.end).toBe(SEQ_LEN);
    // A clamping note should be present
    expect(r.message).toBeTruthy();
    expect(r.message).toContain("clamped");
  });

  it("rejects start >= seqLen after clamping", () => {
    const r = validateSegmentCoords(99999, 99999, SEQ_LEN);
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });

  it("rejects start === end (zero-length segment)", () => {
    const r = validateSegmentCoords(100, 100, SEQ_LEN);
    expect(r.ok).toBe(false);
  });

  it("rejects start > end (inverted range) — both clamped independently, start >= clamped end", () => {
    // validateSegmentCoords clamps start and end independently; start=200 end=100 =>
    // clampedStart=200, clampedEnd=100, and 200 >= 100 so ok=false.
    const r = validateSegmentCoords(200, 100, SEQ_LEN);
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });

  it("rejects negative start by clamping to 0, stays valid when end > 0", () => {
    const r = validateSegmentCoords(-50, 100, SEQ_LEN);
    expect(r.ok).toBe(true);
    expect(r.start).toBe(0);
    expect(r.message).toBeTruthy();
    expect(r.message).toContain("clamped");
  });

  it("clamps both start and end independently (start < 0, end > seqLen)", () => {
    const r = validateSegmentCoords(-10, SEQ_LEN + 1000, SEQ_LEN);
    expect(r.ok).toBe(true);
    expect(r.start).toBe(0);
    expect(r.end).toBe(SEQ_LEN);
  });
});

describe("validateAllSegments", () => {
  const SEQ_LEN = 4733;

  it("returns allOk=true for a list of valid segments", () => {
    const segs: FeatureSegment[] = [
      { start: 0, end: 100 },
      { start: 200, end: 500 },
    ];
    const { allOk, results } = validateAllSegments(segs, SEQ_LEN);
    expect(allOk).toBe(true);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
  });

  it("returns allOk=false when any segment has start >= clamped end", () => {
    const segs: FeatureSegment[] = [
      { start: 0, end: 100 },
      { start: SEQ_LEN, end: SEQ_LEN }, // zero-length at the boundary
    ];
    const { allOk, results } = validateAllSegments(segs, SEQ_LEN);
    expect(allOk).toBe(false);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
  });

  it("returns allOk=true (with clamping note) for out-of-range end clamped to seqLen", () => {
    const segs: FeatureSegment[] = [{ start: 0, end: 99999 }];
    const { allOk, results } = validateAllSegments(segs, SEQ_LEN);
    // end clamped to 4733, which is > start 0 => ok
    expect(allOk).toBe(true);
    expect(results[0].ok).toBe(true);
    expect(results[0].end).toBe(SEQ_LEN);
    expect(results[0].message).toBeTruthy();
  });

  it("handles an empty segment list gracefully", () => {
    const { allOk, results } = validateAllSegments([], SEQ_LEN);
    expect(allOk).toBe(true);
    expect(results).toHaveLength(0);
  });
});
