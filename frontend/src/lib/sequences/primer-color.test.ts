// primer colors bot — a primer's color is persisted on the primer_bind feature
// (via the shared ApEinfo color mechanism) and survives a full serialize +
// reparse, the same way a feature color does. This guards the "set a color per
// primer" persistence path end to end (addFeature -> documentToGenbank ->
// documentFromDetail).

import { describe, it, expect } from "vitest";
import { addFeature } from "./feature-edit";
import {
  documentFromDetail,
  documentToGenbank,
} from "./edit-model";
import { genbankToDetail } from "./parse";
import type { SequenceDetail, SequenceMeta } from "../types";

const PLAIN_GB = `LOCUS       test                   30 bp    DNA     linear   SYN 02-JUN-2026
FEATURES             Location/Qualifiers
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

function plainDoc() {
  const detail = genbankToDetail(PLAIN_GB, metaFor())!;
  return documentFromDetail({ ...detail, genbank: PLAIN_GB } as SequenceDetail);
}

describe("primer color persistence", () => {
  it("a forward primer's color round-trips through the primer_bind feature", () => {
    const doc = addFeature(plainDoc(), {
      name: "M13_fwd",
      type: "primer_bind",
      strand: 1,
      start: 0,
      end: 10,
      color: "#f472b6",
      qualifiers: [{ key: "note", value: "primer ATGCATGCAT" }],
    });
    const added = doc.features.find((f) => f.type === "primer_bind");
    expect(added?.color).toBe("#f472b6");

    // Serialize -> the ApEinfo color qualifier is written.
    const gb = documentToGenbank(doc)!;
    expect(gb).toContain("ApEinfo_fwdcolor");
    expect(gb).toContain("#f472b6");

    // Reparse -> the primer_bind feature comes back colored.
    const detail2 = genbankToDetail(gb, metaFor())!;
    const doc2 = documentFromDetail({ ...detail2, genbank: gb } as SequenceDetail);
    const primer = doc2.features.find((f) => (f.type || "").toLowerCase() === "primer_bind");
    expect(primer).toBeTruthy();
    expect(primer?.color?.toLowerCase()).toBe("#f472b6");
  });

  it("a reverse primer's color round-trips via ApEinfo_revcolor", () => {
    const doc = addFeature(plainDoc(), {
      name: "M13_rev",
      type: "primer_bind",
      strand: -1,
      start: 5,
      end: 15,
      color: "#22d3ee",
      qualifiers: [{ key: "note", value: "primer GCATGCATGC" }],
    });
    const gb = documentToGenbank(doc)!;
    expect(gb).toContain("ApEinfo_revcolor");

    const detail2 = genbankToDetail(gb, metaFor())!;
    const doc2 = documentFromDetail({ ...detail2, genbank: gb } as SequenceDetail);
    const primer = doc2.features.find(
      (f) => (f.type || "").toLowerCase() === "primer_bind" && f.strand === -1,
    );
    expect(primer?.color?.toLowerCase()).toBe("#22d3ee");
  });

  it("an uncolored primer carries no explicit color (renders with the default)", () => {
    const doc = addFeature(plainDoc(), {
      name: "plain",
      type: "primer_bind",
      strand: 1,
      start: 0,
      end: 10,
      qualifiers: [{ key: "note", value: "primer ATGCATGCAT" }],
    });
    const added = doc.features.find((f) => f.type === "primer_bind");
    expect(added?.color).toBeFalsy();
  });
});
