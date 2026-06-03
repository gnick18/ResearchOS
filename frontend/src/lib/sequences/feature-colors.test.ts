// sequence Phase 2c bot — color model + ApEinfo round-trip verification.

import { describe, it, expect } from "vitest";
import {
  colorForType,
  resolveFeatureColor,
  readApEinfoColor,
  apEinfoColorNotes,
  FEATURE_TYPE_COLORS,
  DEFAULT_FEATURE_COLOR,
} from "./feature-colors";
import {
  documentFromDetail,
  documentToGenbank,
  type EditFeature,
} from "./edit-model";
import { genbankToDetail } from "./parse";
import { genbankToJson } from "@/vendor/bio-parsers";
import type { SequenceDetail, SequenceMeta } from "../types";

describe("type -> color palette", () => {
  it("maps known types to their palette color (case-insensitive)", () => {
    expect(colorForType("CDS")).toBe(FEATURE_TYPE_COLORS.cds);
    expect(colorForType("promoter")).toBe(FEATURE_TYPE_COLORS.promoter);
    expect(colorForType("  Promoter ")).toBe(FEATURE_TYPE_COLORS.promoter);
  });
  it("falls back to the default color for unknown/blank types", () => {
    expect(colorForType("totally_made_up")).toBe(DEFAULT_FEATURE_COLOR);
    expect(colorForType(undefined)).toBe(DEFAULT_FEATURE_COLOR);
  });
  it("resolveFeatureColor prefers an explicit color, else the type default", () => {
    expect(resolveFeatureColor({ color: "#123456", type: "CDS" })).toBe("#123456");
    expect(resolveFeatureColor({ type: "promoter" })).toBe(FEATURE_TYPE_COLORS.promoter);
    expect(resolveFeatureColor({ type: "  " })).toBe(DEFAULT_FEATURE_COLOR);
  });
});

describe("readApEinfoColor", () => {
  it("reads the strand-appropriate ApEinfo color", () => {
    const notes = {
      ApEinfo_fwdcolor: ["#aabbcc"],
      ApEinfo_revcolor: ["#112233"],
    };
    expect(readApEinfoColor(notes, 1)).toBe("#aabbcc");
    expect(readApEinfoColor(notes, -1)).toBe("#112233");
  });
  it("falls back to the other strand color when one is missing", () => {
    expect(readApEinfoColor({ ApEinfo_fwdcolor: ["#aabbcc"] }, -1)).toBe("#aabbcc");
    expect(readApEinfoColor({ ApEinfo_revcolor: ["#112233"] }, 1)).toBe("#112233");
  });
  it("returns undefined when neither qualifier is present", () => {
    expect(readApEinfoColor({}, 1)).toBeUndefined();
    expect(readApEinfoColor(undefined, 1)).toBeUndefined();
  });
});

// A tiny GenBank with one forward feature, no color qualifier at all.
const PLAIN_GB = `LOCUS       test                   30 bp    DNA     linear   SYN 02-JUN-2026
FEATURES             Location/Qualifiers
     CDS             1..15
                     /label="myGene"
ORIGIN
        1 atgcatgcat gcatgcatgc atgcatgcat
//`;

// A GenBank whose feature color is carried via ApEinfo qualifiers (SnapGene/ApE
// + our own on-disk + demo-fixture style).
const APEINFO_GB = `LOCUS       test                   30 bp    DNA     linear   SYN 02-JUN-2026
FEATURES             Location/Qualifiers
     CDS             1..15
                     /label="myGene"
                     /ApEinfo_fwdcolor="#34d399"
ORIGIN
        1 atgcatgcat gcatgcatgc atgcatgcat
//`;

function metaFor(): SequenceMeta {
  return {
    id: 1,
    display_name: "test",
    project_ids: [],
    added_at: "2026-06-02T00:00:00Z",
    seq_type: "dna",
  };
}

describe("ApEinfo color is read on parse", () => {
  it("genbankToDetail promotes /ApEinfo_fwdcolor to the annotation color", () => {
    const detail = genbankToDetail(APEINFO_GB, metaFor());
    expect(detail).not.toBeNull();
    expect(detail!.annotations[0].color).toBe("#34d399");
  });

  it("documentFromDetail promotes /ApEinfo_fwdcolor to the feature color", () => {
    const detail = genbankToDetail(APEINFO_GB, metaFor())!;
    const doc = documentFromDetail({ ...detail, genbank: APEINFO_GB } as SequenceDetail);
    expect(doc.features[0].color).toBe("#34d399");
  });
});

describe("color round-trip: set color -> jsonToGenbank -> genbankToJson -> preserved", () => {
  it("a recolor survives a full serialize + reparse via ApEinfo", () => {
    // Start from a plain GenBank with no color, build the doc.
    const detail = genbankToDetail(PLAIN_GB, metaFor())!;
    const doc = documentFromDetail({ ...detail, genbank: PLAIN_GB } as SequenceDetail);
    expect(doc.features[0].color).toBeFalsy();

    // Recolor the feature.
    const recolored = {
      ...doc,
      features: doc.features.map(
        (f): EditFeature => ({ ...f, color: "#f472b6" }),
      ),
    };

    // Serialize to GenBank.
    const gb = documentToGenbank(recolored);
    expect(gb).toBeTruthy();
    // The ApEinfo qualifier must be present in the written text.
    expect(gb).toContain("ApEinfo_fwdcolor");
    expect(gb).toContain("#f472b6");

    // Reparse the written GenBank: the color must come back.
    const detail2 = genbankToDetail(gb!, metaFor())!;
    expect(detail2.annotations[0].color?.toLowerCase()).toBe("#f472b6");

    // And the doc model rebuilt from it carries the color too.
    const doc2 = documentFromDetail({ ...detail2, genbank: gb! } as SequenceDetail);
    expect(doc2.features[0].color?.toLowerCase()).toBe("#f472b6");
  });

  it("a reverse-strand feature's color round-trips via ApEinfo_revcolor", () => {
    const REV_GB = `LOCUS       test                   30 bp    DNA     linear   SYN 02-JUN-2026
FEATURES             Location/Qualifiers
     CDS             complement(1..15)
                     /label="revGene"
ORIGIN
        1 atgcatgcat gcatgcatgc atgcatgcat
//`;
    const detail = genbankToDetail(REV_GB, metaFor())!;
    const doc = documentFromDetail({ ...detail, genbank: REV_GB } as SequenceDetail);
    expect(doc.features[0].strand).toBe(-1);

    const recolored = {
      ...doc,
      features: doc.features.map(
        (f): EditFeature => ({ ...f, color: "#22d3ee" }),
      ),
    };
    const gb = documentToGenbank(recolored)!;
    expect(gb).toContain("ApEinfo_revcolor");

    const detail2 = genbankToDetail(gb, metaFor())!;
    expect(detail2.annotations[0].color?.toLowerCase()).toBe("#22d3ee");
  });
});

describe("apEinfoColorNotes", () => {
  it("emits both fwd and rev color note arrays", () => {
    const notes = apEinfoColorNotes("#abcdef");
    expect(notes.ApEinfo_fwdcolor).toEqual(["#abcdef"]);
    expect(notes.ApEinfo_revcolor).toEqual(["#abcdef"]);
  });
});

describe("vendored bio-parsers baseline (documents the gap this module fills)", () => {
  it("bio-parsers itself does NOT promote ApEinfo color to feature.color", () => {
    const parsed = genbankToJson(APEINFO_GB, {}).find(
      (r) => r.success && r.parsedSequence,
    );
    const feat = parsed!.parsedSequence!.features[0];
    // The raw parser leaves ApEinfo as notes and does not set .color — which is
    // exactly why readApEinfoColor exists.
    expect(feat.color).toBeFalsy();
  });
});
