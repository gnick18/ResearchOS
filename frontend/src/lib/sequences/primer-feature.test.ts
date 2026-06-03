// primer dialog bot — tests for the pure primer-metadata helpers.

import { describe, it, expect } from "vitest";
import type { EditFeature } from "./edit-model";
import {
  readPrimerSeq,
  readPrimerDescription,
  readPrimerPhosphorylated,
  derivePrimerSite,
  buildPrimerQualifiers,
} from "./primer-feature";

function feature(notes: Record<string, unknown>): EditFeature {
  return { name: "p", start: 0, end: 10, strand: 1, type: "primer_bind", notes };
}

describe("readPrimerSeq", () => {
  it("reads the oligo from a /note 'primer <SEQ>' line", () => {
    expect(readPrimerSeq(feature({ note: ["primer ATGCATGC"] }))).toBe("ATGCATGC");
  });
  it("uppercases and finds the line among many notes", () => {
    expect(
      readPrimerSeq(feature({ note: ["some comment", "primer atgcatgc", "description hi"] })),
    ).toBe("ATGCATGC");
  });
  it("handles a single-string note", () => {
    expect(readPrimerSeq(feature({ note: "primer GGGCCC" }))).toBe("GGGCCC");
  });
  it("returns empty when no primer line is present", () => {
    expect(readPrimerSeq(feature({ note: ["just a comment"] }))).toBe("");
    expect(readPrimerSeq(feature({}))).toBe("");
  });
});

describe("readPrimerDescription", () => {
  it("reads the description line", () => {
    expect(readPrimerDescription(feature({ note: ["description M13 forward primer"] }))).toBe(
      "M13 forward primer",
    );
  });
  it("returns empty when absent", () => {
    expect(readPrimerDescription(feature({ note: ["primer ATGC"] }))).toBe("");
  });
});

describe("readPrimerPhosphorylated", () => {
  it("is true when the marker note is present", () => {
    expect(readPrimerPhosphorylated(feature({ note: ["primer ATGC", "5' phosphorylated"] }))).toBe(
      true,
    );
  });
  it("is false otherwise", () => {
    expect(readPrimerPhosphorylated(feature({ note: ["primer ATGC"] }))).toBe(false);
  });
});

describe("derivePrimerSite", () => {
  // template:           0         1
  //                     0123456789012345678901234567
  const template = "AAAACCCGGGTTTACGTACGTAAATTT";

  it("finds a forward full-match site", () => {
    const oligo = "CCCGGG"; // matches template[4..10)
    const site = derivePrimerSite(oligo, template);
    expect(site).not.toBeNull();
    expect(site!.start).toBe(4);
    expect(site!.end).toBe(10);
    expect(site!.direction).toBe(1);
    expect(site!.fullMatch).toBe(true);
    expect(site!.annealedLength).toBe(6);
  });

  it("finds a reverse-strand site (oligo = revcomp of a forward span)", () => {
    // forward span template[10..16) = "TTTACG"; revcomp = "CGTAAA"
    const oligo = "CGTAAA";
    const site = derivePrimerSite(oligo, template);
    expect(site).not.toBeNull();
    expect(site!.direction).toBe(-1);
    expect(site!.start).toBe(10);
    expect(site!.end).toBe(16);
  });

  it("returns null for an oligo that does not anneal", () => {
    expect(derivePrimerSite("CACACACACACA", "GTGTGT")).toBeNull();
  });

  it("returns null for an empty oligo", () => {
    expect(derivePrimerSite("", template)).toBeNull();
  });

  it("re-derives a NEW site after the oligo is edited (the Save path)", () => {
    // Editing CCCGGG -> a different region's oligo moves the binding site.
    const before = derivePrimerSite("CCCGGG", template)!;
    const after = derivePrimerSite("AAAACCC", template)!; // template[0..7)
    expect(before.start).toBe(4);
    expect(after.start).toBe(0);
    expect(after.end).toBe(7);
  });
});

describe("buildPrimerQualifiers", () => {
  it("writes the three primer-owned note lines from the fields", () => {
    const rows = buildPrimerQualifiers(feature({}), {
      oligo: "atgcatgc",
      description: "forward primer",
      phosphorylated: true,
    });
    const notes = rows.filter((r) => r.key === "note").map((r) => r.value);
    expect(notes).toContain("primer ATGCATGC");
    expect(notes).toContain("description forward primer");
    expect(notes).toContain("5' phosphorylated");
  });

  it("omits description / phosphorylation when empty / false", () => {
    const rows = buildPrimerQualifiers(feature({}), {
      oligo: "ATGC",
      description: "",
      phosphorylated: false,
    });
    const notes = rows.filter((r) => r.key === "note").map((r) => r.value);
    expect(notes).toEqual(["primer ATGC"]);
  });

  it("preserves non-note qualifiers (e.g. /label) verbatim", () => {
    const rows = buildPrimerQualifiers(feature({ label: ["GFP-seq-F"], note: ["primer AAAA"] }), {
      oligo: "TTTT",
      description: "",
      phosphorylated: false,
    });
    expect(rows).toContainEqual({ key: "label", value: "GFP-seq-F" });
  });

  it("preserves unrelated /note lines but rewrites the primer-owned ones", () => {
    const rows = buildPrimerQualifiers(
      feature({ note: ["bind site for cloning", "primer AAAA", "5' phosphorylated"] }),
      { oligo: "GGGG", description: "new desc", phosphorylated: false },
    );
    const notes = rows.filter((r) => r.key === "note").map((r) => r.value);
    expect(notes).toContain("bind site for cloning"); // unrelated note kept
    expect(notes).toContain("primer GGGG"); // oligo rewritten
    expect(notes).toContain("description new desc"); // description added
    expect(notes).not.toContain("primer AAAA"); // old oligo gone
    expect(notes).not.toContain("5' phosphorylated"); // phospho cleared
  });
});
