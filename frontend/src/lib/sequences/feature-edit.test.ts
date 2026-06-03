// sequence Phase 2c bot — pure feature CRUD + multi-segment preservation tests.

import { describe, it, expect } from "vitest";
import {
  addFeature,
  updateFeature,
  duplicateFeature,
  deleteFeature,
  setFeatureColor,
  setTypeColor,
  featureTypes,
  featureLength,
  type FeatureDraft,
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
