// digest golden bot — GROUND-TRUTH restriction-digest suite.
//
// WHY THIS EXISTS
// ---------------
// A test that asserts "our digest equals what our digest produced" verifies
// nothing. Every expected cut position and fragment length below was produced
// INDEPENDENTLY by Biopython's Bio.Restriction (a widely-used reference
// implementation), then mapped into our digest's index convention. NONE of the
// expected values were copied from our own digest output. They are reproducible:
// run `frontend/scripts/gen-digest-golden.py` and confirm the printed numbers
// match the GOLDEN constants in this file.
//
// THE CUT-POSITION CONVENTION (reconciled in the gen script, re-stated here)
// -------------------------------------------------------------------------
// Our digest reports a top-strand cut as `fcut` = the 0-based count of bases to
// the LEFT of the cut bond (i.e. for a recognition site starting at 0-based
// index i, fcut = i + enzyme.fcut, taken mod seqLength). `digestEnzymes` surfaces
// this as `cut.position`.
//
// Biopython `Enzyme.search(seq, linear=...)` returns the 1-based index of the
// first base to the RIGHT of the top-strand cut. The reconciliation (verified on
// the EcoRI hand case `AAAGAATTCAAA` in the gen script, and applied uniformly to
// every fixture) is:
//
//     our cut.position  ==  biopython_search_position - 1
//
// So each GOLDEN `cuts` array below is Biopython's search output minus one, taken
// mod the sequence length (so an origin-spanning circular cut folds to 0).
//
// WHAT WE ASSERT, PER ENZYME PER SEQUENCE
// ---------------------------------------
//   1. the SET of distinct cut positions (sorted) equals Biopython's, AND
//   2. the sorted-descending fragment lengths equal Biopython's.
// Fragment lengths use our `fragmentSizes` (linear: N cuts -> N+1 fragments with
// open ends; circular: N cuts -> N fragments wrapping the origin; 0 cuts -> the
// whole molecule). The fragment EXPECTATIONS were independently recomputed in the
// gen script from Biopython's cut set, not from our fragmentSizes.
//
// DATASET CROSS-CHECK: the gen script also compares our vendored enzyme dataset
// (recognition sequence + top-strand cut offset) against Biopython for all 11
// enzymes used here; at the time of writing ALL agree (zero divergences).

import { describe, it, expect } from "vitest";
import { digestEnzymes, fragmentSizes } from "./enzyme-filters";

// ── GROUND-TRUTH FIXTURES (from gen-digest-golden.py / Bio.Restriction) ────────
//
// Each case: a sequence, whether it is circular, and per-enzyme the expected
// distinct cut positions (our convention) and sorted-desc fragment lengths.

interface EnzymeExpect {
  /** distinct cut positions, our convention, sorted ascending. */
  cuts: number[];
  /** fragment lengths, sorted descending (SnapGene convention). */
  fragments: number[];
}

interface DigestCase {
  name: string;
  seq: string;
  circular: boolean;
  /** lowercase enzyme key (the digest key) -> expected Biopython-derived values. */
  enzymes: Record<string, EnzymeExpect>;
}

const CASES: DigestCase[] = [
  {
    // Multi-cutter linear: EcoRI x3, BamHI x1, blunt EcoRV x1, HindIII absent.
    name: "MULTI (multi-cutter + noncutter, linear)",
    seq: "GGCCGAATTCGCGCGGATCCGCGCGAATTCGCGCGATATCGCGCGAATTCGGCC",
    circular: false,
    enzymes: {
      ecori: { cuts: [5, 25, 45], fragments: [20, 20, 9, 5] }, // 5' overhang, 3 sites
      bamhi: { cuts: [15], fragments: [39, 15] },
      ecorv: { cuts: [37], fragments: [37, 17] }, // blunt cutter
      hindiii: { cuts: [], fragments: [54] }, // NONCUTTER -> empty, whole molecule
    },
  },
  {
    // Sticky-overhang trio + blunt, one site each, linear.
    name: "STICKY (5' / 3' / 3' / blunt overhang cutters, linear)",
    seq: "GCGCGAATTCGCGCCTGCAGGCGCGGTACCGCGCCCCGGGGCGC",
    circular: false,
    enzymes: {
      ecori: { cuts: [5], fragments: [39, 5] }, // 5' overhang
      psti: { cuts: [19], fragments: [25, 19] }, // 3' overhang
      kpni: { cuts: [29], fragments: [29, 15] }, // 3' overhang
      smai: { cuts: [37], fragments: [37, 7] }, // blunt
    },
  },
  {
    // Degenerate recognition: HinfI G^ANTC, three sites with N = A, C, G.
    name: "DEGEN (IUPAC-degenerate HinfI G^ANTC, linear)",
    seq: "GCGCGAATCGCGCGACTCGCGCGAGTCGCGC",
    circular: false,
    enzymes: {
      hinfi: { cuts: [5, 14, 23], fragments: [9, 9, 8, 5] },
    },
  },
  {
    // Non-palindromic recognition with a site on the minus strand. HinfI GANTC;
    // "GAATC" forward + its reverse complement "GATTC" embedded downstream, so
    // the second site is only found by scanning the bottom strand.
    name: "MINUS (non-palindromic HinfI, fwd + minus-strand site, linear)",
    seq: "GCGCGAATCGCGCGCGATTCGCGC",
    circular: false,
    enzymes: {
      hinfi: { cuts: [5, 16], fragments: [11, 8, 5] },
    },
  },
  {
    // Circular plasmid: EcoRI site SPANS THE ORIGIN (folds to position 0) plus
    // one internal EcoRI site -> 2 cuts, 2 fragments wrapping the origin. BamHI
    // cuts once internally -> 1 circular cut, 1 fragment = whole molecule.
    // (Treated as linear the same string yields only ONE EcoRI cut; see gen
    // script's origin-span intent check.)
    name: "CIRCULAR (origin-spanning site + circular wrap)",
    seq: "AATTCGCGCGCGAATTCGCGCGGATCCGCGCG",
    circular: true,
    enzymes: {
      ecori: { cuts: [0, 12], fragments: [20, 12] }, // origin-spanning + internal
      bamhi: { cuts: [22], fragments: [32] }, // single circular cut
    },
  },
];

// ── HELPERS (OUR digest -> the two quantities we compare) ──────────────────────

/** Distinct cut positions our digest reports for one enzyme, sorted ascending. */
function ourCuts(seq: string, key: string): number[] {
  const [d] = digestEnzymes(seq, "dna", [key]);
  const positions = d ? d.cuts.map((c) => c.position) : [];
  return Array.from(new Set(positions)).sort((a, b) => a - b);
}

describe("restriction digest — Biopython-grounded golden suite", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      for (const [key, expected] of Object.entries(c.enzymes)) {
        it(`${key}: cut positions match Biopython`, () => {
          expect(ourCuts(c.seq, key)).toEqual(expected.cuts);
        });

        it(`${key}: fragment lengths match Biopython`, () => {
          const cuts = ourCuts(c.seq, key);
          const sizes = fragmentSizes(cuts, c.seq.length, c.circular);
          expect(sizes).toEqual(expected.fragments);
        });
      }
    });
  }

  // Linear-vs-circular fragment-count invariant, grounded in the canonical rule
  // (textbook): a linear molecule cut at N sites yields N+1 fragments; a circular
  // molecule cut at N sites yields N fragments. Asserted against the fixtures.
  it("fragment count obeys the linear N+1 / circular N rule", () => {
    for (const c of CASES) {
      for (const [key, expected] of Object.entries(c.enzymes)) {
        const n = expected.cuts.length;
        if (n === 0) continue; // noncutter: whole molecule, handled above
        const wantCount = c.circular ? n : n + 1;
        expect(
          expected.fragments.length,
          `${c.name} / ${key}: expected ${wantCount} fragments for ${n} cuts`,
        ).toBe(wantCount);
      }
    }
  });
});
