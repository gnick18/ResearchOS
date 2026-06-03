// sequence Phase 2a bot — unit tests for the coordinate-shift correctness core.
// Covers the cases the Phase 2a gate calls out explicitly: insert before/inside/
// after a feature, delete spanning a feature boundary, delete fully containing a
// feature, and edits at position 0 and at the end. Also covers multi-segment
// (locations) features and the higher-level insert/delete/replace on the model.

import { describe, expect, it } from "vitest";
import {
  mapPositionOnInsert,
  mapPositionOnDelete,
  shiftFeaturesOnInsert,
  shiftFeaturesOnDelete,
  type Interval,
} from "./coordinate-shift";
import {
  insertBases,
  deleteBases,
  replaceBases,
  gcPercent,
  type SeqDocument,
} from "./edit-model";

// A 20-base sequence with one feature covering bases [5, 10) (half-open).
//            0123456789...
const SEQ = "ACGTACGTACGTACGTACGT"; // length 20
function doc(features: Interval[] = []): SeqDocument {
  return {
    name: "test",
    seq: SEQ,
    seqType: "dna",
    circular: false,
    features: features.map((f) => ({ name: "f", strand: 1, ...f })) as SeqDocument["features"],
  };
}

describe("mapPositionOnInsert", () => {
  it("leaves positions before the insert point untouched", () => {
    expect(mapPositionOnInsert(3, 5, 2)).toBe(3);
  });
  it("shifts positions after the insert point by len", () => {
    expect(mapPositionOnInsert(8, 5, 2)).toBe(10);
  });
  it("treats a right-boundary coord at the insert point as shifting", () => {
    expect(mapPositionOnInsert(5, 5, 2, "right")).toBe(7);
  });
  it("treats a left-boundary coord at the insert point as pinned", () => {
    expect(mapPositionOnInsert(5, 5, 2, "left")).toBe(5);
  });
});

describe("mapPositionOnDelete", () => {
  it("leaves positions at/before the cut untouched", () => {
    expect(mapPositionOnDelete(5, 5, 3)).toBe(5);
    expect(mapPositionOnDelete(2, 5, 3)).toBe(2);
  });
  it("shifts positions after the deleted span back by len", () => {
    expect(mapPositionOnDelete(10, 5, 3)).toBe(7);
  });
  it("collapses a position inside the deleted span to the cut point", () => {
    expect(mapPositionOnDelete(6, 5, 3)).toBe(5);
    expect(mapPositionOnDelete(7, 5, 3)).toBe(5);
  });
});

describe("shiftFeaturesOnInsert", () => {
  const feat: Interval = { start: 5, end: 10 };

  it("insert BEFORE a feature shifts both edges right", () => {
    const [out] = shiftFeaturesOnInsert([feat], 2, 3);
    expect(out).toMatchObject({ start: 8, end: 13 });
  });

  it("insert INSIDE a feature grows it (start fixed, end pushed)", () => {
    const [out] = shiftFeaturesOnInsert([feat], 7, 3);
    expect(out).toMatchObject({ start: 5, end: 13 });
  });

  it("insert AFTER a feature leaves it untouched", () => {
    const [out] = shiftFeaturesOnInsert([feat], 12, 3);
    expect(out).toMatchObject({ start: 5, end: 10 });
  });

  it("insert exactly at the feature start pushes the whole feature (start is a right edge)", () => {
    const [out] = shiftFeaturesOnInsert([feat], 5, 3);
    expect(out).toMatchObject({ start: 8, end: 13 });
  });

  it("insert exactly at the feature end does NOT grow it (end is a left edge)", () => {
    const [out] = shiftFeaturesOnInsert([feat], 10, 3);
    expect(out).toMatchObject({ start: 5, end: 10 });
  });

  it("insert at position 0 shifts every downstream feature", () => {
    const [out] = shiftFeaturesOnInsert([feat], 0, 4);
    expect(out).toMatchObject({ start: 9, end: 14 });
  });

  it("shifts multi-segment locations independently", () => {
    const multi: Interval = {
      start: 2,
      end: 18,
      locations: [
        { start: 2, end: 6 },
        { start: 12, end: 18 },
      ],
    };
    const [out] = shiftFeaturesOnInsert([multi], 8, 5);
    expect(out.locations).toEqual([
      { start: 2, end: 6 }, // before the cut: untouched
      { start: 17, end: 23 }, // after the cut: +5
    ]);
  });
});

describe("shiftFeaturesOnDelete", () => {
  const feat: Interval = { start: 5, end: 10 };

  it("delete BEFORE a feature shifts both edges left", () => {
    const [out] = shiftFeaturesOnDelete([feat], 0, 3);
    expect(out).toMatchObject({ start: 2, end: 7 });
  });

  it("delete AFTER a feature leaves it untouched", () => {
    const [out] = shiftFeaturesOnDelete([feat], 12, 3);
    expect(out).toMatchObject({ start: 5, end: 10 });
  });

  it("delete SPANNING the feature's start boundary clamps the start to the cut", () => {
    // delete [3, 7): removes bases 3,4,5,6. Feature start 5 is inside → clamps to 3.
    const [out] = shiftFeaturesOnDelete([feat], 3, 4);
    expect(out).toMatchObject({ start: 3, end: 6 });
  });

  it("delete SPANNING the feature's end boundary clamps the end to the cut", () => {
    // delete [8, 14): removes 8..13. Feature end 10 inside → clamps to 8; start 5 untouched.
    const [out] = shiftFeaturesOnDelete([feat], 8, 6);
    expect(out).toMatchObject({ start: 5, end: 8 });
  });

  it("delete FULLY CONTAINING a feature collapses it (and drops it when asked)", () => {
    // delete [4, 12): contains [5,10) entirely.
    const [kept] = shiftFeaturesOnDelete([feat], 4, 8);
    expect(kept).toMatchObject({ start: 4, end: 4 }); // zero-length collapse at cut
    const dropped = shiftFeaturesOnDelete([feat], 4, 8, { dropCollapsed: true });
    expect(dropped).toHaveLength(0);
  });

  it("delete at the very end of the sequence leaves an upstream feature untouched", () => {
    const [out] = shiftFeaturesOnDelete([feat], 17, 3);
    expect(out).toMatchObject({ start: 5, end: 10 });
  });
});

describe("insertBases (model)", () => {
  it("inserts text and grows length", () => {
    const out = insertBases(doc(), 4, "TTT");
    expect(out.seq).toBe("ACGTTTTACGTACGTACGTACGT");
    expect(out.seq.length).toBe(23);
  });

  it("uppercases inserted bases", () => {
    const out = insertBases(doc(), 0, "ggg");
    expect(out.seq.startsWith("GGG")).toBe(true);
  });

  it("insert at position 0 shifts a downstream feature", () => {
    const out = insertBases(doc([{ start: 5, end: 10 }]), 0, "AA");
    expect(out.features[0]).toMatchObject({ start: 7, end: 12 });
    expect(out.seq.length).toBe(22);
  });

  it("insert at the end appends and leaves features untouched", () => {
    const out = insertBases(doc([{ start: 5, end: 10 }]), SEQ.length, "CC");
    expect(out.seq.length).toBe(22);
    expect(out.features[0]).toMatchObject({ start: 5, end: 10 });
  });

  it("does not mutate the input document", () => {
    const d = doc([{ start: 5, end: 10 }]);
    insertBases(d, 0, "AAA");
    expect(d.seq).toBe(SEQ);
    expect(d.features[0]).toMatchObject({ start: 5, end: 10 });
  });
});

describe("deleteBases (model)", () => {
  it("deletes a single base at position 0", () => {
    const out = deleteBases(doc(), 0, 1);
    expect(out.seq).toBe(SEQ.slice(1));
    expect(out.seq.length).toBe(19);
  });

  it("deletes a single base at the end", () => {
    const out = deleteBases(doc(), SEQ.length - 1, 1);
    expect(out.seq).toBe(SEQ.slice(0, -1));
  });

  it("clamps a count that runs past the end", () => {
    const out = deleteBases(doc(), 18, 999);
    expect(out.seq.length).toBe(18);
  });

  it("drops a fully-contained feature", () => {
    const out = deleteBases(doc([{ start: 5, end: 10 }]), 4, 8);
    expect(out.features).toHaveLength(0);
  });
});

describe("replaceBases (model)", () => {
  it("replaces a selected range with new text", () => {
    const out = replaceBases(doc(), 4, 8, "X"); // remove [4,8) "ACGT", insert "X"
    expect(out.seq).toBe("ACGTXACGTACGTACGT");
    expect(out.seq.length).toBe(SEQ.length - 4 + 1);
  });

  it("handles a reversed selection (to < from)", () => {
    const a = replaceBases(doc(), 8, 4, "GG");
    const b = replaceBases(doc(), 4, 8, "GG");
    expect(a.seq).toBe(b.seq);
  });

  it("replacing a region that contains a feature drops it then shifts the rest", () => {
    const out = replaceBases(
      doc([
        { start: 5, end: 10 }, // contained → dropped
        { start: 12, end: 16 }, // downstream → shifts
      ]),
      4,
      11,
      "AA",
    );
    // removed 7 bases [4,11), inserted 2 → net -5
    expect(out.features).toHaveLength(1);
    expect(out.features[0]).toMatchObject({ start: 7, end: 11 });
  });
});

describe("gcPercent", () => {
  it("computes GC over the whole sequence", () => {
    // ACGTACGT... → 50% GC
    expect(gcPercent(SEQ)).toBeCloseTo(50, 5);
  });
  it("computes GC over a sub-range", () => {
    expect(gcPercent("GGGGAAAA", 0, 4)).toBeCloseTo(100, 5);
    expect(gcPercent("GGGGAAAA", 4, 8)).toBeCloseTo(0, 5);
  });
  it("returns 0 for an empty range", () => {
    expect(gcPercent("ACGT", 2, 2)).toBe(0);
  });
});
