// sequence editor master. PROTEIN PROJECTION tests for the domain bar.
//
// domainsForCds + inverseDomainAaRange project `domain`-type DNA features back
// into the protein's aa coordinates the CDD-style bar draws in. Two paths are
// covered: the fast path reading the stored `aa_range` note, and the fallback
// inverting the DNA->aa mapping. The inverse MUST exactly invert the forward
// transcriptSpanToDna (the same path domainHitToFeature writes), so a freshly
// annotated domain recovers its original residue span with or without the note.

import { describe, it, expect } from "vitest";
import type { EditFeature } from "./edit-model";
import type { DomainHit } from "./interproscan";
import {
  domainHitToFeature,
  domainsForCds,
  inverseDomainAaRange,
  familyColor,
  AA_RANGE_NOTE_PREFIX,
  DOMAIN_FEATURE_TYPE,
} from "./domain-features";
import { addFeature } from "./feature-edit";
import type { SeqDocument } from "./edit-model";

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

/** Commit a domain draft into a real EditFeature (qualifiers -> notes string[]),
 *  the same transform the editor applies when accepting a reviewed domain (via
 *  addFeature, which folds the draft's qualifier rows into `notes`). */
function domainFeatureFrom(h: DomainHit, cds: EditFeature, seqLength: number): EditFeature {
  const draft = domainHitToFeature(h, cds, seqLength)!;
  const blank: SeqDocument = {
    name: "t",
    seq: "N".repeat(seqLength),
    seqType: "dna",
    circular: false,
    features: [],
  };
  return addFeature(blank, draft).features[0];
}

describe("inverseDomainAaRange - exact inverse of the forward mapping", () => {
  it("recovers a forward single-segment residue span", () => {
    const cds: EditFeature = { name: "CDK2", type: "CDS", strand: 1, start: 100, end: 1000 };
    // forward maps residues 4..286 to DNA [109, 958).
    const dom = domainHitToFeature(hit(4, 286), cds, 5000)!;
    expect(inverseDomainAaRange(cds, dom)).toEqual({ aaStart: 4, aaEnd: 286 });
  });

  it("recovers a reverse single-segment residue span", () => {
    const cds: EditFeature = { name: "rev", type: "CDS", strand: -1, start: 100, end: 1000 };
    const dom = domainHitToFeature(hit(4, 286), cds, 5000)!;
    expect(inverseDomainAaRange(cds, dom)).toEqual({ aaStart: 4, aaEnd: 286 });
  });

  it("recovers an exon-joined (intron-crossing) residue span", () => {
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
    // residues 6..15 -> join [{15,30},{60,75}].
    const dom = domainHitToFeature(hit(6, 15), cds, 1000)!;
    expect(dom.segments).toBeDefined();
    expect(inverseDomainAaRange(cds, dom)).toEqual({ aaStart: 6, aaEnd: 15 });
  });

  it("recovers a reverse exon-joined span (single exon, no join)", () => {
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
    // residues 6..15 fall wholly inside one exon on the minus strand.
    const dom = domainHitToFeature(hit(6, 15), cds, 1000)!;
    expect(inverseDomainAaRange(cds, dom)).toEqual({ aaStart: 6, aaEnd: 15 });
  });

  it("returns null when the domain does not overlap the CDS exons", () => {
    const cds: EditFeature = { name: "c", type: "CDS", strand: 1, start: 100, end: 200 };
    const dom: EditFeature = { name: "d", type: "domain", strand: 1, start: 500, end: 560 };
    expect(inverseDomainAaRange(cds, dom)).toBeNull();
  });
});

describe("domainsForCds - reads the aa_range note (fast path)", () => {
  it("projects the stored residue range without inverse math", () => {
    const cds: EditFeature = { name: "CDK2", type: "CDS", strand: 1, start: 100, end: 1000 };
    const dom = domainFeatureFrom(hit(4, 286), cds, 5000);
    // The note must be present (the fast path), so the projection does not lean on
    // the inverse here.
    const notes = (dom.notes?.note as string[]) ?? [];
    expect(notes).toContain(`${AA_RANGE_NOTE_PREFIX}4..286`);

    const blocks = domainsForCds(cds, [cds, dom], 300);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      name: "Pkinase",
      accession: "PF00069",
      aaStart: 4,
      aaEnd: 286,
      featureIndex: 1,
    });
    expect(blocks[0].evalue).toBeCloseTo(3.8e-74);
    expect(blocks[0].score).toBeCloseTo(260.9);
  });

  it("falls back to the inverse map when the note is missing", () => {
    const cds: EditFeature = { name: "CDK2", type: "CDS", strand: 1, start: 100, end: 1000 };
    const dom = domainFeatureFrom(hit(4, 286), cds, 5000);
    // Strip the aa_range note to force the fallback; keep the rest.
    const stripped: EditFeature = {
      ...dom,
      notes: {
        ...dom.notes,
        note: ((dom.notes?.note as string[]) ?? []).filter(
          (n) => !n.startsWith(AA_RANGE_NOTE_PREFIX),
        ),
      },
    };
    const blocks = domainsForCds(cds, [cds, stripped], 300);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ aaStart: 4, aaEnd: 286, featureIndex: 1 });
  });

  it("clamps an out-of-range residue span into [1, aaLength]", () => {
    const cds: EditFeature = { name: "c", type: "CDS", strand: 1, start: 0, end: 900 };
    const dom: EditFeature = {
      name: "wide",
      type: "domain",
      strand: 1,
      start: 0,
      end: 900,
      notes: { note: [`${AA_RANGE_NOTE_PREFIX}0..9999`] },
    };
    const blocks = domainsForCds(cds, [cds, dom], 300);
    expect(blocks[0].aaStart).toBe(1);
    expect(blocks[0].aaEnd).toBe(300);
  });

  it("ignores non-domain features and CDS-disjoint domains", () => {
    const cds: EditFeature = { name: "c", type: "CDS", strand: 1, start: 100, end: 1000 };
    const gene: EditFeature = { name: "g", type: "gene", strand: 1, start: 100, end: 1000 };
    const inside = domainFeatureFrom(hit(4, 50), cds, 5000);
    const elsewhere: EditFeature = {
      name: "other",
      type: "domain",
      strand: 1,
      start: 2000,
      end: 2300,
    };
    const blocks = domainsForCds(cds, [cds, gene, inside, elsewhere], 300);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe("Pkinase");
  });

  it("orders multiple domains by aa start", () => {
    const cds: EditFeature = { name: "c", type: "CDS", strand: 1, start: 0, end: 1200 };
    const d1 = domainFeatureFrom(hit(200, 300, { accession: "PF00002", name: "B" }), cds, 5000);
    const d2 = domainFeatureFrom(hit(10, 100, { accession: "PF00001", name: "A" }), cds, 5000);
    const blocks = domainsForCds(cds, [cds, d1, d2], 400);
    expect(blocks.map((b) => b.name)).toEqual(["A", "B"]);
    expect(blocks[0].aaStart).toBe(10);
    expect(blocks[1].aaStart).toBe(200);
  });
});

describe("familyColor - deterministic per-family palette", () => {
  it("is stable for the same accession and distinct across families", () => {
    const a = familyColor("PF00069");
    expect(familyColor("PF00069")).toBe(a);
    expect(familyColor("PF00001")).not.toBe(a);
  });

  it("falls back to the name when the accession is blank", () => {
    expect(familyColor("", "Pkinase")).toBe(familyColor("", "Pkinase"));
    expect(familyColor("", "Pkinase")).not.toBe(familyColor("", "SH2"));
  });
});

describe("aa_range qualifier round-trips through the type constant", () => {
  it("is tagged as a domain feature", () => {
    expect(DOMAIN_FEATURE_TYPE).toBe("domain");
  });
});
