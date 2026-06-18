// sequence Phase 2b bot — unit tests for the annotated-clipboard core. Covers
// the cases the Phase 2b gate calls out: copy a selection partially overlapping
// a feature (the feature is CLIPPED + rebased), paste into an empty region,
// paste splicing INSIDE an existing feature (downstream features shift, pasted
// features land at the right offset), and raw-text paste (no features). Plus the
// delete/cut "affected features" classification and raw-text sanitization.

import { describe, expect, it } from "vitest";
import {
  clipSelection,
  pasteClip,
  affectedFeatures,
  sanitizeRawSequence,
  type MolecularClip,
} from "./clipboard";
import type { Interval } from "./coordinate-shift";
import type { SeqDocument } from "./edit-model";

//            0         1
//            0123456789012345 6789
const SEQ = "AAAACCCCGGGGTTTTACGT"; // length 20
function doc(features: Interval[] = []): SeqDocument {
  return {
    name: "src",
    seq: SEQ,
    seqType: "dna",
    circular: false,
    features: features.map((f) => ({ name: "f", strand: 1, ...f })) as SeqDocument["features"],
  };
}

describe("clipSelection (copy clip + rebase)", () => {
  it("copies the bare bases of a selection rebased to 0", () => {
    const clip = clipSelection(doc(), 4, 8);
    expect(clip.seq).toBe("CCCC");
    expect(clip.features).toEqual([]);
    expect(clip.seqType).toBe("dna");
    expect(clip.sourceName).toBe("src");
  });

  it("clips a feature that only PARTIALLY overlaps the selection and rebases it", () => {
    // feature [2,10) over the document; select [4,12).
    // overlap is [4,10) -> rebased to [0,6).
    const clip = clipSelection(doc([{ name: "gene", start: 2, end: 10 }]), 4, 12);
    expect(clip.seq).toBe("CCCCGGGG");
    expect(clip.features).toHaveLength(1);
    expect(clip.features[0]).toMatchObject({ name: "gene", start: 0, end: 6 });
  });

  it("keeps a fully-contained feature and rebases it inside the clip", () => {
    // feature [6,9) inside selection [4,12) -> rebased [2,5).
    const clip = clipSelection(doc([{ name: "g", start: 6, end: 9 }]), 4, 12);
    expect(clip.features[0]).toMatchObject({ start: 2, end: 5 });
  });

  it("drops a feature entirely outside the selection", () => {
    const clip = clipSelection(doc([{ name: "out", start: 14, end: 18 }]), 4, 8);
    expect(clip.features).toEqual([]);
  });

  it("clips multi-segment (locations) features to the selection", () => {
    // two exons [2,5) and [8,11); select [4,10) -> clipped to [4,5)&[8,10)
    // -> rebased [0,1)&[4,6); feature span [4,11)->[4,10)->rebased[0,6).
    const f: Interval = {
      name: "spliced",
      start: 2,
      end: 11,
      locations: [
        { start: 2, end: 5 },
        { start: 8, end: 11 },
      ],
    };
    const clip = clipSelection(doc([f]), 4, 10);
    expect(clip.features[0].locations).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 6 },
    ]);
  });

  it("normalizes a reversed selection (lo>hi) and clamps to bounds", () => {
    const clip = clipSelection(doc(), 8, 4); // reversed
    expect(clip.seq).toBe("CCCC");
    const clamped = clipSelection(doc(), 18, 999);
    expect(clamped.seq).toBe("GT"); // bases 18,19 of the 20-mer
  });
});

describe("pasteClip (merge + shift)", () => {
  const clip: MolecularClip = {
    seq: "NNN",
    features: [{ name: "ins", start: 0, end: 3, strand: 1 } as SeqDocument["features"][number]],
    seqType: "dna",
    sourceName: "src",
  };

  it("pastes into an empty region (no existing features)", () => {
    const out = pasteClip(doc(), 8, clip);
    expect(out.seq).toBe("AAAACCCCNNNGGGGTTTTACGT");
    expect(out.features).toHaveLength(1);
    expect(out.features[0]).toMatchObject({ name: "ins", start: 8, end: 11 });
  });

  it("pastes splicing INSIDE an existing feature: downstream shifts, pasted feature lands at offset", () => {
    // existing feature [4,12); paste 3bp at index 8 (inside it).
    const base = doc([{ name: "host", start: 4, end: 12 }]);
    const out = pasteClip(base, 8, clip);
    expect(out.seq).toBe("AAAACCCCNNNGGGGTTTTACGT");
    // host feature end shifts by +3 (insert inside it grows it): [4,15).
    const host = out.features.find((f) => f.name === "host")!;
    expect(host).toMatchObject({ start: 4, end: 15 });
    // pasted feature lands at the insertion point.
    const ins = out.features.find((f) => f.name === "ins")!;
    expect(ins).toMatchObject({ start: 8, end: 11 });
  });

  it("shifts a downstream feature fully past the insertion point", () => {
    const base = doc([{ name: "down", start: 12, end: 16 }]);
    const out = pasteClip(base, 8, clip);
    expect(out.features.find((f) => f.name === "down")).toMatchObject({ start: 15, end: 19 });
  });

  it("offsets multi-segment carried features back from rebased 0", () => {
    const multiClip: MolecularClip = {
      seq: "NNNNNN",
      features: [
        {
          name: "m",
          start: 0,
          end: 6,
          strand: 1,
          locations: [
            { start: 0, end: 2 },
            { start: 4, end: 6 },
          ],
        } as SeqDocument["features"][number],
      ],
      seqType: "dna",
      sourceName: "src",
    };
    const out = pasteClip(doc(), 8, multiClip);
    const m = out.features.find((f) => f.name === "m")!;
    expect(m).toMatchObject({ start: 8, end: 14 });
    expect(m.locations).toEqual([
      { start: 8, end: 10 },
      { start: 12, end: 14 },
    ]);
  });

  it("is a no-op for an empty clip", () => {
    const base = doc();
    expect(pasteClip(base, 4, { ...clip, seq: "" })).toBe(base);
  });

  it("round-trips a copy then paste at a new position carrying the feature", () => {
    const src = doc([{ name: "promoter", start: 4, end: 8 }]);
    const c = clipSelection(src, 4, 8); // -> seq CCCC, feature [0,4)
    const out = pasteClip(doc(), 0, c); // paste at start of a clean doc
    expect(out.seq.startsWith("CCCC")).toBe(true);
    expect(out.features[0]).toMatchObject({ name: "promoter", start: 0, end: 4 });
  });
});

describe("affectedFeatures (delete/cut confirmation)", () => {
  const d = doc([
    { name: "removed-me", start: 5, end: 8 },
    { name: "trimmed-me", start: 6, end: 14 },
    { name: "untouched", start: 16, end: 20 },
  ]);

  it("classifies fully-contained as removed, partial as trimmed, ignores outside", () => {
    const aff = affectedFeatures(d, 4, 10);
    expect(aff).toContainEqual({ name: "removed-me", effect: "removed" });
    expect(aff).toContainEqual({ name: "trimmed-me", effect: "trimmed" });
    expect(aff.find((a) => a.name === "untouched")).toBeUndefined();
  });

  it("returns empty when the cut touches no features", () => {
    expect(affectedFeatures(d, 0, 4)).toEqual([]);
  });
});

describe("sanitizeRawSequence (raw OS-clipboard paste)", () => {
  it("keeps valid DNA bases, drops non-base chars, ignores whitespace", () => {
    const { bases, dropped } = sanitizeRawSequence("acgt 123\nACGT!", "dna");
    expect(bases).toBe("ACGTACGT");
    expect(dropped).toBe(4); // "1","2","3","!"
  });

  it("keeps IUPAC ambiguity codes and U for RNA", () => {
    expect(sanitizeRawSequence("ACGUN", "rna").bases).toBe("ACGUN");
  });

  it("keeps amino-acid letters incl. B/Z/X/U/O and the stop for protein", () => {
    const { bases } = sanitizeRawSequence("MKV*Zz", "protein");
    expect(bases).toBe("MKV*ZZ"); // Z (Glx) is a valid IUPAC ambiguity code; z->Z
  });

  it("keeps the gap and IUPAC ambiguity codes for DNA, drops X", () => {
    const { bases, dropped } = sanitizeRawSequence("AC-GTNxq", "dna");
    expect(bases).toBe("AC-GTN");
    expect(dropped).toBe(2); // "X","Q"
  });

  it("reports zero dropped for a clean nucleotide string", () => {
    expect(sanitizeRawSequence("ACGTACGT", "dna").dropped).toBe(0);
  });
});
