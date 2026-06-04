import { describe, it, expect } from "vitest";
import { reverseComplement } from "../align";
import {
  annotateFromReference,
  DEFAULT_IDENTITY_THRESHOLD,
  type ReferenceFeature,
} from "./annotate-from-reference";

// A reference with a clearly-segmentable layout so feature spans are easy to
// reason about. 60 bp, distinct 20-bp thirds.
const REF =
  "AAAAACCCCCGGGGGTTTTT" + // 0..20  block A
  "ACGTACGTACGTACGTACGT" + // 20..40 block B
  "GGGGGAAAAATTTTTCCCCC"; //  40..60 block C

function feat(
  name: string,
  start: number,
  end: number,
  strand: 1 | -1 = 1,
  extra: Partial<ReferenceFeature> = {},
): ReferenceFeature {
  return { name, start, end, strand, type: "misc_feature", ...extra };
}

describe("annotateFromReference — exact containment", () => {
  it("maps a reference feature to the correct open-sequence coords when the open seq contains the region", () => {
    // Open sequence = a 10-bp prefix pad + the reference's block A + a pad. Use
    // block A (not the near-palindromic block B) so the forward strand wins
    // unambiguously.
    const pad = "TATATATATA";
    const openA = pad + REF.slice(0, 20) + "CACACACACA";
    const f = feat("blockA", 0, 20, 1);
    const res = annotateFromReference(openA, REF, [f]);
    expect(res.referenceOrientation).toBe("forward");
    const p = res.proposals[0];
    expect(p.unmapped).toBe(false);
    expect(p.partial).toBe(false);
    expect(p.strand).toBe(1);
    // block A sits right after the 10-bp pad.
    expect(p.start).toBe(pad.length);
    expect(p.end).toBe(pad.length + 20);
    expect(p.identity).toBeCloseTo(1, 5);
    expect(p.coverage).toBeCloseTo(1, 5);
  });

  it("maps a feature exactly when the open seq IS the reference", () => {
    const f = feat("blockA", 0, 20, 1);
    const res = annotateFromReference(REF, REF, [f]);
    const p = res.proposals[0];
    expect(p.start).toBe(0);
    expect(p.end).toBe(20);
    expect(p.identity).toBeCloseTo(1, 5);
    expect(p.unmapped).toBe(false);
  });
});

describe("annotateFromReference — mismatch tolerance", () => {
  it("maps through a 1-2 mismatch region (still above the identity threshold)", () => {
    // Take block B, introduce 2 point mutations inside it, embed in the open seq.
    const blockB = REF.slice(20, 40); // ACGTACGTACGTACGTACGT (20 bp)
    const mutated =
      blockB.slice(0, 5) + "T" + blockB.slice(6, 12) + "A" + blockB.slice(13);
    expect(mutated.length).toBe(20);
    const pad = "GTGTGTGTGT";
    const open = pad + mutated + "ATATATATAT";
    const f = feat("blockB", 20, 40, 1);
    const res = annotateFromReference(open, REF, [f]);
    const p = res.proposals[0];
    expect(p.unmapped).toBe(false);
    // 18/20 identical => 0.9, above the 0.7 default.
    expect(p.identity).toBeGreaterThanOrEqual(DEFAULT_IDENTITY_THRESHOLD);
    expect(p.identity).toBeLessThan(1);
    expect(p.start).toBe(pad.length);
    expect(p.end).toBe(pad.length + 20);
  });
});

describe("annotateFromReference — reverse strand / revcomp", () => {
  it("maps a feature with flipped strand and correct coords when the open seq is the reference's reverse complement", () => {
    const rc = reverseComplement(REF); // 60 bp
    // A + feature on block A of the reference. On the revcomp, block A (ref
    // [0,20)) lands at the END: rc positions [40, 60).
    const f = feat("blockA", 0, 20, 1);
    const res = annotateFromReference(rc, REF, [f]);
    expect(res.referenceOrientation).toBe("reverse");
    const p = res.proposals[0];
    expect(p.unmapped).toBe(false);
    expect(p.strand).toBe(-1); // flipped
    expect(p.start).toBe(40);
    expect(p.end).toBe(60);
    expect(p.identity).toBeCloseTo(1, 5);
  });

  it("flips a - strand reference feature to + on the revcomp branch", () => {
    const rc = reverseComplement(REF);
    const f = feat("blockC-rev", 40, 60, -1);
    const res = annotateFromReference(rc, REF, [f]);
    const p = res.proposals[0];
    expect(res.referenceOrientation).toBe("reverse");
    expect(p.strand).toBe(1); // -1 flipped to +1
    // ref block C [40,60) lands at rc [0,20).
    expect(p.start).toBe(0);
    expect(p.end).toBe(20);
  });
});

describe("annotateFromReference — absent / partial", () => {
  it("reports a reference feature absent from the open seq as unmapped (not transferred)", () => {
    // Open seq contains block A only; block C feature has nowhere to land.
    const open = "TTTTTTTTTT" + REF.slice(0, 20) + "GAGAGAGAGA";
    const present = feat("blockA", 0, 20, 1);
    const absent = feat("blockC", 40, 60, 1);
    const res = annotateFromReference(open, REF, [present, absent]);
    const [pA, pC] = res.proposals;
    expect(pA.unmapped).toBe(false);
    expect(pC.unmapped).toBe(true);
    expect(pC.coverage).toBeLessThan(0.5);
  });

  it("flags a partially-overlapping feature as partial", () => {
    // Open seq contains the FIRST HALF of block B (10 of its 20 bp). A feature
    // spanning all of block B should map partially.
    const blockBHalf = REF.slice(20, 30); // first 10 bp of block B
    const open = "CTCTCTCTCT" + blockBHalf + "CTCTCTCTCT";
    const f = feat("blockB-full", 20, 40, 1);
    const res = annotateFromReference(open, REF, [f]);
    const p = res.proposals[0];
    // 10/20 covered = 0.5 coverage, at the floor, so offered but partial.
    expect(p.unmapped).toBe(false);
    expect(p.partial).toBe(true);
    expect(p.coverage).toBeLessThan(1);
    expect(p.coverage).toBeGreaterThanOrEqual(0.5);
  });
});

describe("annotateFromReference — multi-segment", () => {
  it("maps a multi-segment (join) feature, carrying both segments onto open coords", () => {
    // Feature joins block A [0,20) and block C [40,60), skipping block B.
    const open = "AAAA" + REF + "TTTT"; // open = pad + full ref + pad
    const f = feat("spliced", 0, 60, 1, {
      segments: [
        { start: 0, end: 20 },
        { start: 40, end: 60 },
      ],
    });
    const res = annotateFromReference(open, REF, [f]);
    const p = res.proposals[0];
    expect(p.unmapped).toBe(false);
    expect(p.segments).toBeDefined();
    expect(p.segments).toHaveLength(2);
    expect(p.segments![0]).toEqual({ start: 4, end: 24 });
    expect(p.segments![1]).toEqual({ start: 44, end: 64 });
  });
});

describe("annotateFromReference — edge cases", () => {
  it("handles empty open or reference by reporting all features unmapped", () => {
    const f = feat("x", 0, 20, 1);
    expect(annotateFromReference("", REF, [f]).proposals[0].unmapped).toBe(true);
    expect(annotateFromReference(REF, "", [f]).proposals[0].unmapped).toBe(true);
  });

  it("honors a custom identity threshold", () => {
    // ~85% identical block (3 mismatches in 20). Strict 0.95 threshold rejects.
    const blockB = REF.slice(20, 40);
    const mutated =
      "T" + blockB.slice(1, 6) + "A" + blockB.slice(7, 12) + "C" + blockB.slice(13);
    const open = "GGGGGGGGGG" + mutated + "GGGGGGGGGG";
    const f = feat("blockB", 20, 40, 1);
    const loose = annotateFromReference(open, REF, [f], { identityThreshold: 0.7 });
    const strict = annotateFromReference(open, REF, [f], { identityThreshold: 0.95 });
    expect(loose.proposals[0].unmapped).toBe(false);
    expect(strict.proposals[0].unmapped).toBe(true);
  });

  it("is deterministic across repeated runs", () => {
    const open = "AAAA" + REF + "TTTT";
    const f = feat("blockB", 20, 40, 1);
    const a = annotateFromReference(open, REF, [f]);
    const b = annotateFromReference(open, REF, [f]);
    expect(a).toEqual(b);
  });
});
