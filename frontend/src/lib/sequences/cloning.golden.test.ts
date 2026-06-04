// cloning bot — GOLDEN cross-validation for the PRE-EXISTING overlap (Gibson /
// NEBuilder HiFi) engine `assembleGibson`, against the INDEPENDENT pydna
// simulator. cloning.test.ts already covers self-consistency; THIS file adds the
// independent-oracle cross-check the other golden suites have, so all three
// cloning paths (overlap, restriction-ligation, Golden Gate) are pydna-grounded.
//
// HOW THE EXPECTED VALUE WAS PRODUCED
// -----------------------------------
// The expected circular product comes from pydna (5.5.13) via the committed
// generator frontend/scripts/gen-cloning-golden.py (gibson_golden), NOT from our
// engine. The generator hands pydna each fragment BODY plus a copy of the
// neighbouring overlap on each side (a circular slice of the intended product P),
// so pydna's overlap-merge reproduces P; it then asserts pydna's circular product
// equals P up to rotation/strand. Our `assembleGibson` builds P by concatenating
// the same bodies (the homology is added by the designed primers, so it appears
// once at each seam). We assert our product == pydna's product after canonical
// circular normalization (rotation + strand), the same normalization documented
// in cut-ligate.golden.test.ts.

import { describe, it, expect } from "vitest";
import { assembleGibson } from "./cloning";
import { canonicalCircular } from "./cut-ligate";

// ── FIXTURES (printed by gen-cloning-golden.py, pydna 5.5.13) ─────────────────
const GIBSON_BODIES = [
  "ATGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGC",
  "GACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGC",
  "AAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTC",
];
const GIBSON_OVERLAP = 20;
// pydna's circular product, canonicalized (rotation + strand). Equals the
// concatenation of the bodies as a circle.
const GIBSON_PRODUCT_CANON =
  "AAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCATGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGT";
// Junction overlaps our engine reports (last `overlap` bases of each body).
const GIBSON_JUNCTIONS = [
  "TCCTGGTCGAGCTGGACGGC",
  "AGGGCGATGCCACCTACGGC",
  "CCGTGCCCTGGCCCACCCTC",
];

describe("assembleGibson — circular overlap product vs pydna", () => {
  const res = assembleGibson(
    GIBSON_BODIES.map((seq, i) => ({ name: `f${i}`, seq })),
    { circular: true, overlap: { kind: "length", bp: GIBSON_OVERLAP } },
  );

  it("our concatenation product equals pydna's overlap-merge product (rotation + strand)", () => {
    expect(res.product.circular).toBe(true);
    expect(canonicalCircular(res.product.seq)).toBe(GIBSON_PRODUCT_CANON);
  });

  it("product length equals the sum of body lengths (homology counted once)", () => {
    const sum = GIBSON_BODIES.reduce((a, b) => a + b.length, 0);
    expect(res.product.seq.length).toBe(sum);
    // pydna's product is the same length.
    expect(GIBSON_PRODUCT_CANON.length).toBe(sum);
  });

  it("junction overlaps match the homology pydna merges on (each body's 3' end)", () => {
    expect(res.junctions).toHaveLength(3); // circular: 3 junctions incl. close
    expect(res.junctions.map((j) => j.overlapSeq)).toEqual(GIBSON_JUNCTIONS);
  });
});
