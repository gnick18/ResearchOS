// sequence editor master. DOMAIN -> DNA mapping tests.
//
// Asserts that a protein residue span lands on the right DNA coordinates on a
// CDS, for a forward single-segment CDS, a reverse single-segment CDS, and a
// multi-segment (exon-joined) CDS where the domain crosses an intron. The mapping
// must agree with how translateFeature read the protein (transcript order +
// strand), so it stays consistent with the drawer's translation.

import { describe, it, expect } from "vitest";
import type { EditFeature } from "./edit-model";
import type { DomainHit } from "./interproscan";
import {
  domainHitToFeature,
  transcriptSpanToDna,
  DOMAIN_FEATURE_TYPE,
} from "./domain-features";

function hit(start: number, end: number, extra: Partial<DomainHit> = {}): DomainHit {
  return {
    db: "Pfam",
    accession: "PF00069",
    name: "Pkinase",
    description: "Protein kinase domain",
    start,
    end,
    evalue: 3.8e-74,
    score: 260.9,
    ...extra,
  };
}

describe("domainHitToFeature - forward single-segment CDS", () => {
  it("maps residues 4..286 onto the forward DNA span", () => {
    const cds: EditFeature = { name: "CDK2", type: "CDS", strand: 1, start: 100, end: 1000 };
    const draft = domainHitToFeature(hit(4, 286), cds, 5000);
    expect(draft).not.toBeNull();
    // residue 4 (1-based) starts at transcript offset (4-1)*3 = 9 -> 100+9 = 109.
    // residue 286 ends at transcript offset 286*3 = 858 -> 100+858 = 958.
    expect(draft!.start).toBe(109);
    expect(draft!.end).toBe(958);
    expect(draft!.strand).toBe(1);
    expect(draft!.type).toBe(DOMAIN_FEATURE_TYPE);
    expect(draft!.segments).toBeUndefined();
  });

  it("carries the Pfam db_xref + description + score qualifiers", () => {
    const cds: EditFeature = { name: "CDK2", type: "CDS", strand: 1, start: 0, end: 900 };
    const draft = domainHitToFeature(hit(1, 10), cds, 5000)!;
    const quals = draft.qualifiers ?? [];
    expect(quals).toContainEqual({ key: "db_xref", value: "Pfam:PF00069" });
    expect(quals).toContainEqual({ key: "note", value: "Protein kinase domain" });
    expect(quals.some((q) => q.key === "note" && /E-value/.test(q.value))).toBe(true);
    expect(quals).toContainEqual({ key: "note", value: "Domain database Pfam" });
  });
});

describe("domainHitToFeature - reverse single-segment CDS", () => {
  it("maps the residue span onto the forward DNA span from the 3' end", () => {
    const cds: EditFeature = { name: "rev", type: "CDS", strand: -1, start: 100, end: 1000 };
    // total coding length 900. residues 4..286 -> transcript [9, 858).
    // reverse: flip into forward-exon offsets -> [900-858, 900-9) = [42, 891)
    // -> genomic [100+42, 100+891) = [142, 991).
    const draft = domainHitToFeature(hit(4, 286), cds, 5000)!;
    expect(draft.start).toBe(142);
    expect(draft.end).toBe(991);
    expect(draft.strand).toBe(-1);
    expect(draft.segments).toBeUndefined();
  });

  it("places an N-terminal domain at the high-coordinate (3') end on the minus strand", () => {
    const cds: EditFeature = { name: "rev", type: "CDS", strand: -1, start: 0, end: 90 };
    // residues 1..10 -> transcript [0, 30) -> reverse flip [60, 90) -> genomic [60, 90).
    const draft = domainHitToFeature(hit(1, 10), cds, 1000)!;
    expect(draft.start).toBe(60);
    expect(draft.end).toBe(90);
  });
});

describe("domainHitToFeature - multi-segment (exon-joined) CDS", () => {
  it("splits an intron-crossing domain into a join()", () => {
    // Exons [0,30) and [60,120): coding length 90 (30 aa). Intron is [30,60).
    const cds: EditFeature = {
      name: "spliced",
      type: "CDS",
      strand: 1,
      start: 0,
      end: 120,
      locations: [
        { start: 0, end: 30 },
        { start: 60, end: 120 },
      ],
    };
    // residues 6..15 -> transcript [15, 45). Exon1 transcript [0,30), exon2 [30,90).
    // overlap exon1 [15,30) -> genomic [15,30); overlap exon2 [30,45) -> genomic [60,75).
    const draft = domainHitToFeature(hit(6, 15), cds, 1000)!;
    expect(draft.segments).toEqual([
      { start: 15, end: 30 },
      { start: 60, end: 75 },
    ]);
    expect(draft.start).toBe(15);
    expect(draft.end).toBe(75);
  });

  it("keeps a domain wholly inside one exon as a single span (no join)", () => {
    const cds: EditFeature = {
      name: "spliced",
      type: "CDS",
      strand: 1,
      start: 0,
      end: 120,
      locations: [
        { start: 0, end: 30 },
        { start: 60, end: 120 },
      ],
    };
    // residues 1..5 -> transcript [0, 15) -> entirely inside exon1 -> genomic [0, 15).
    const draft = domainHitToFeature(hit(1, 5), cds, 1000)!;
    expect(draft.segments).toBeUndefined();
    expect(draft.start).toBe(0);
    expect(draft.end).toBe(15);
  });

  it("maps a reverse-strand exon-joined domain from the 3' end", () => {
    // Same exon geometry, minus strand. Coding length 90.
    const cds: EditFeature = {
      name: "spliced-rev",
      type: "CDS",
      strand: -1,
      start: 0,
      end: 120,
      locations: [
        { start: 0, end: 30 },
        { start: 60, end: 120 },
      ],
    };
    // residues 6..15 -> transcript [15, 45) -> reverse flip [90-45, 90-15) = [45, 75)
    // in forward-exon offsets. Exon1 covers exon-offsets [0,30), exon2 [30,90).
    // [45,75) is inside exon2 -> genomic [60 + (45-30), 60 + (75-30)) = [75, 105).
    const draft = domainHitToFeature(hit(6, 15), cds, 1000)!;
    expect(draft.segments).toBeUndefined();
    expect(draft.start).toBe(75);
    expect(draft.end).toBe(105);
  });
});

describe("transcriptSpanToDna - direct unit checks", () => {
  it("returns an empty list for a zero-length or out-of-range span", () => {
    const exons = [{ start: 0, end: 30 }];
    expect(transcriptSpanToDna(exons, 1, 10, 10)).toEqual([]);
    expect(transcriptSpanToDna(exons, 1, 100, 200)).toEqual([]);
  });
});
