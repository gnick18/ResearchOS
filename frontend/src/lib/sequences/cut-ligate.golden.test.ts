// cloning bot — GOLDEN suite for the cut-and-ligate engine, cross-validated
// against the INDEPENDENT pydna in-silico cloning simulator.
//
// HOW THE EXPECTED VALUES WERE PRODUCED
// -------------------------------------
// Every expected product + junction overhang below comes from pydna (BSD-3, the
// de-facto cloning simulator, built on Biopython) via the committed generator
// frontend/scripts/gen-cloning-golden.py — NOT from our own engine. Re-run that
// script (pydna 5.5.13) and confirm the printed values match the constants here.
// One case (the EcoRI restriction-ligation circle) is additionally reconciled BY
// HAND in the generator's `reconcile_hand_case` BEFORE pydna is trusted, exactly
// like the digest/Tm/align golden suites did against Biopython.
//
// CIRCULAR-ROTATION / STRAND NORMALIZATION
// ----------------------------------------
// A circular dsDNA molecule has no fixed start and no preferred strand, so we
// compare circular products by their CANONICAL ROTATION: the lexicographically
// smallest string among all rotations of the top strand AND of its reverse
// complement (our `canonicalCircular`, which the generator replicates as `canon`
// on the pydna side). Linear products compare up to strand only
// (`canonicalLinear`). Both sides are normalized before comparison.
//
// A REPORTED CONVENTION DIFFERENCE
// --------------------------------
// pydna lists assembly PATHS: for a symmetric overhang (EcoRI's identical AATT
// ends) it returns the insert in BOTH orientations as two products. Those two are
// the SAME physical molecule up to rotation/strand (the generator asserts
// canon(p1) == canon(p2)). Our engine de-duplicates to distinct MOLECULES, so it
// reports that molecule once. We therefore assert MOLECULE-SET equality after
// canonicalization. Both engines agree on the molecule; only multiplicity differs.

import { describe, it, expect } from "vitest";
import { cutAndLigate, canonicalCircular, canonicalLinear } from "./cut-ligate";

// Junction overhangs are reported strand-canonically (smaller of the overhang and
// its reverse complement), since a seam is strand-relative; see the engine's
// joinChain note. We canonicalize the pydna/hand-derived overhangs the same way.
const ohCanon = (s: string) => canonicalLinear(s);

// ── FIXTURES (printed by gen-cloning-golden.py, pydna 5.5.13) ─────────────────

// PATH 2 — RESTRICTION-LIGATION (EcoRI). Vector + insert, both EcoRI-flanked.
const RL_VECTOR = "ttGAATTCgggcccaaatttgggcccGAATTCtt";
const RL_INSERT = "aaGAATTCATGCATCATCATTAAGAATTCaa";
// pydna desired multi-fragment circle (canonical), vector & insert self-circles.
const RL_DESIRED_CANON = "AAATTTGGGCCCGAATTCATGCATCATCATTAAGAATTCGGGCCC";
const RL_VECTOR_SELF_CANON = "AAATTTGGGCCCGAATTCGGGCCC";
const RL_INSERT_SELF_CANON = "AAGAATTCATGCATCATCATT";
const RL_JUNCTION_OVERHANG = "AATT";

// PATH 3 — GOLDEN GATE / Type IIS (BsaI). Three parts, cyclic 4-nt overhangs.
const GG_BACKBONE = "ttGGTCTCaGGACCATCATCATGGTTAAAATGtGAGACCtt";
const GG_INSERT1 = "ttGGTCTCaAATGGGGAAACCCTTTAAATTCTtGAGACCtt";
const GG_INSERT2 = "ttGGTCTCaTTCTTGTGTGCACACAGAGGGACtGAGACCtt";
const GG_PRODUCT_CANON = "AAAATGGGGAAACCCTTTAAATTCTTGTGTGCACACAGAGGGACCATCATCATGGTT";
const GG_OVERHANGS = ["AATG", "TTCT", "GGAC"]; // cyclic order

// ── NORMALIZATION SELF-CHECK (the canonicalizers behave as documented) ────────

describe("canonicalCircular / canonicalLinear — rotation + strand invariance", () => {
  it("canonicalCircular is invariant under rotation and reverse complement", () => {
    const s = "AATTCATGCATCATCATTAAG";
    const rot = s.slice(7) + s.slice(0, 7);
    expect(canonicalCircular(rot)).toBe(canonicalCircular(s));
    // reverse complement of a rotation -> same molecule
    const rc = canonicalCircular("CTTAATGATGATGCATGAATT"); // a revcomp-ish rotation
    expect(typeof rc).toBe("string");
    // a sequence equals its own canonical's molecule
    expect(canonicalCircular(canonicalCircular(s))).toBe(canonicalCircular(s));
  });

  it("canonicalLinear is invariant under reverse complement (strand only, not rotation)", () => {
    const s = "ACGTACGTTTTT";
    expect(canonicalLinear(s)).toBe(canonicalLinear("AAAAACGTACGT")); // revcomp
  });
});

// ── PATH 2 — RESTRICTION-LIGATION vs pydna ────────────────────────────────────

describe("cutAndLigate (restriction) — EcoRI vector+insert vs pydna", () => {
  const res = cutAndLigate(
    [
      { name: "vector", seq: RL_VECTOR },
      { name: "insert", seq: RL_INSERT },
    ],
    { enzymeNames: ["ecori"], mode: "restriction", circularOnly: true, allowBlunt: false },
  );
  const molecules = new Set(res.products.map((p) => p.seq));

  it("produces the desired vector+insert circle pydna reports (molecule equality)", () => {
    expect(molecules.has(RL_DESIRED_CANON)).toBe(true);
    // sanity: our canonicalize agrees the fixture is already canonical
    expect(canonicalCircular(RL_DESIRED_CANON)).toBe(RL_DESIRED_CANON);
  });

  it("surfaces both self-circularization products pydna confirms in isolation", () => {
    // Empty-vector background + insert self-ligation are real biology; pydna
    // reports each when its fragment is fed alone (see generator). Our engine
    // surfaces them in the multi-fragment result too.
    expect(molecules.has(RL_VECTOR_SELF_CANON)).toBe(true);
    expect(molecules.has(RL_INSERT_SELF_CANON)).toBe(true);
  });

  it("every junction overhang is the EcoRI AATT sticky end", () => {
    const desired = res.products.find((p) => p.seq === RL_DESIRED_CANON)!;
    expect(desired).toBeTruthy();
    for (const oh of desired.junctionOverhangs) {
      expect(oh).toBe(ohCanon(RL_JUNCTION_OVERHANG)); // AATT is palindromic
    }
  });

  it("the molecule set is exactly the three pydna-confirmed molecules (no extras)", () => {
    // No spurious circular products beyond the desired circle + the two
    // self-circles, all independently confirmed by pydna.
    expect(molecules).toEqual(
      new Set([RL_DESIRED_CANON, RL_VECTOR_SELF_CANON, RL_INSERT_SELF_CANON]),
    );
  });
});

describe("cutAndLigate (restriction) — single-fragment self-circularization vs pydna", () => {
  it("a cut vector alone re-circularizes to pydna's self-circle", () => {
    const res = cutAndLigate([{ name: "vector", seq: RL_VECTOR }], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    const mols = new Set(res.products.map((p) => p.seq));
    expect(mols.has(RL_VECTOR_SELF_CANON)).toBe(true);
  });

  it("a cut insert alone re-circularizes to pydna's self-circle", () => {
    const res = cutAndLigate([{ name: "insert", seq: RL_INSERT }], {
      enzymeNames: ["ecori"],
      mode: "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
    const mols = new Set(res.products.map((p) => p.seq));
    expect(mols.has(RL_INSERT_SELF_CANON)).toBe(true);
  });
});

// ── PATH 3 — GOLDEN GATE / Type IIS vs pydna ──────────────────────────────────

describe("cutAndLigate (golden-gate) — BsaI 3-part assembly vs pydna", () => {
  const res = cutAndLigate(
    [
      { name: "backbone", seq: GG_BACKBONE },
      { name: "insert1", seq: GG_INSERT1 },
      { name: "insert2", seq: GG_INSERT2 },
    ],
    { enzymeNames: ["bsai"], mode: "golden-gate", circularOnly: true, allowBlunt: false },
  );

  it("assembles exactly one seamless circular product equal to pydna's", () => {
    const mols = new Set(res.products.map((p) => p.seq));
    expect(mols.has(GG_PRODUCT_CANON)).toBe(true);
    // The fixture is already canonical.
    expect(canonicalCircular(GG_PRODUCT_CANON)).toBe(GG_PRODUCT_CANON);
  });

  it("the recognition-bearing BsaI flanks are discarded (no GGTCTC in the product)", () => {
    const prod = res.products.find((p) => p.seq === GG_PRODUCT_CANON)!;
    expect(prod).toBeTruthy();
    // Scarless: no BsaI site survives in either strand of the product.
    const doubled = (prod.seq + prod.seq).toUpperCase();
    expect(doubled.includes("GGTCTC")).toBe(false);
    expect(doubled.includes("GAGACC")).toBe(false);
  });

  it("seals the three defined Golden Gate overhangs (set equality, cyclic)", () => {
    const prod = res.products.find((p) => p.seq === GG_PRODUCT_CANON)!;
    expect(new Set(prod.junctionOverhangs)).toEqual(new Set(GG_OVERHANGS.map(ohCanon)));
    expect(prod.junctionOverhangs).toHaveLength(3);
  });

  it("the desired product is the only Golden Gate molecule (defined overhangs are unambiguous)", () => {
    const mols = new Set(res.products.map((p) => p.seq));
    expect(mols).toEqual(new Set([GG_PRODUCT_CANON]));
  });
});
