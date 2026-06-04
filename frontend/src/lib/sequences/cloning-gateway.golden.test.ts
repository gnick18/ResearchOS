// cloning bot — GOLDEN suite for the Gateway recombinational-cloning engine.
//
// WHY NO pydna HERE (ORACLE CHECK)
// --------------------------------
// pydna (the in-silico cloning simulator we use to golden-validate the Gibson
// overlap engine and the cut-and-ligate engine) simulates ASSEMBLY by homology
// and restriction/ligation. It does NOT model lambda att site-specific
// recombination (BP/LR Clonase). There is no pydna API for "recombine attL x
// attR -> attB"; forcing it would mean hand-feeding it the answer, which proves
// nothing. We therefore DO NOT use pydna for Gateway (and there is no
// gen-gateway-golden.py, by design — see the report).
//
// THE TRUST ANCHOR (hand-derived reconciliation gate)
// ---------------------------------------------------
// Instead, the expected values below are HAND-DERIVED from the VERIFIED,
// published att-site sequences (Thermo Fisher Gateway manual; Kwan Tol2kit att
// list; Hartley 2000; Landy 1989 — full citations in cloning-gateway.ts). The
// recombination is traced base-by-base in the comments. Crucially, the crossover
// rule is independently CHECKED against the published product sites: an LR
// reaction's product attB1/attB2 must equal the published 24/25 bp attB sites to
// the base, and a BP reaction's product attL1 must end with the published
// gene-proximal attL1. Those published sequences are the external authority; no
// expected value comes from our own engine.
//
// CIRCULAR-ROTATION / STRAND NORMALIZATION
// ----------------------------------------
// Gateway products are circular plasmids with no fixed origin and no preferred
// strand, so we compare by `canonicalCircular` (the lexicographically smallest
// rotation of the top strand AND its reverse complement), reused verbatim from
// cut-ligate.ts. Both the engine output and the hand-derived expectation are
// canonicalized before comparison.

import { describe, it, expect } from "vitest";
import { canonicalCircular } from "./cut-ligate";
import {
  runGateway,
  crossoverAtt,
  splitAroundCore,
  ATTB1,
  ATTB2,
  ATTL1,
  ATTP1,
  ATTP2,
  ATTL2,
  ATTR1,
  ATTR2,
  ATT_CORE,
  type GatewaySubstrate,
} from "./cloning-gateway";

// ── A MINIMAL TRACED CONSTRUCT (verified att sites + toy gene/cassette) ───────
// The att sites are the VERIFIED published constants (see cloning-gateway.ts).
// The gene and cassette are short, deliberately distinct, ACGT-only toys so the
// product can be traced by eye. Backbones are short GC/AT spacers.
const GENE = "ATGAAACATTACGGTTAA"; // 18 bp, in-frame ATG ... TAA
const CCDB = "CCCTGCAGGGGGGGCCC"; // 17 bp toy negative-selection cassette
const ENTRY_BB = "AAAAACGTACGTAAAAA";
const DEST_BB = "GGGGGCATGCATGGGGG";

// Entry clone: backbone + attL1 + GENE + attL2 + tail (circular).
const ENTRY_SEQ = ENTRY_BB + ATTL1 + GENE + ATTL2 + "TTTTT";
// Destination vector: backbone + attR1 + ccdB + attR2 + tail (circular).
const DEST_SEQ = DEST_BB + ATTR1 + CCDB + ATTR2 + "CCCCC";

// attB-PCR product (LINEAR): GG + attB1 + GENE + attB2 + GG.
const PCR_SEQ = "GG" + ATTB1 + GENE + ATTB2 + "GG";
// Donor vector (pDONR-like, circular): backbone + attP1 + ccdB + attP2 + tail.
const DONOR_SEQ = ENTRY_BB + ATTP1 + CCDB + ATTP2 + "TTTTT";

// ── SOURCE-LEVEL SELF-CHECK: the published sites contain the shared core ──────
describe("verified att-site constants vs the published shared cores", () => {
  it("site-1 core TTTGTACAAAAAAG is present in attB1/attP1/attL1/attR1", () => {
    expect(ATT_CORE[1]).toBe("TTTGTACAAAAAAG");
    for (const s of [ATTB1, ATTP1, ATTL1, ATTR1]) expect(s.includes(ATT_CORE[1])).toBe(true);
  });
  it("site-2 core CTTTCTTGTACAAAGT is present in attB2/attL2/attR2", () => {
    expect(ATT_CORE[2]).toBe("CTTTCTTGTACAAAGT");
    for (const s of [ATTB2, ATTL2, ATTR2]) expect(s.includes(ATT_CORE[2])).toBe(true);
  });
  it("splitAroundCore decomposes attB1 into 5'arm + core + 3'arm", () => {
    const p = splitAroundCore(ATTB1, 1)!;
    expect(p).toBeTruthy();
    expect(p.fivePrime + p.core + p.threePrime).toBe(ATTB1);
    expect(p.core).toBe(ATT_CORE[1]);
    // attB1 = CAAG | TTTGTACAAAAAAG | CAGGCT
    expect(p.fivePrime).toBe("CAAG");
    expect(p.threePrime).toBe("CAGGCT");
  });
});

// ── THE CROSSOVER, RECONCILED AGAINST PUBLISHED PRODUCT SITES ─────────────────
// HAND TRACE (LR, site 1):  attL1 x attR1 -> attB1 (+ attP1 byproduct).
//   attR1 = CAAG | TTTGTACAAAAAAG | TTGAACG...CCTGTA   (5'arm "CAAG", 3'arm long)
//   attL1 = TGATGAGCAATGC...CCAAC | TTTGTACAAAAAAG | CAGGCT
//   product attB1 = attR1.5'arm + core + attL1.3'arm
//                 = "CAAG" + "TTTGTACAAAAAAG" + "CAGGCT"
//                 = "CAAGTTTGTACAAAAAAGCAGGCT"  == the published 24 bp attB1.  ✓
describe("crossoverAtt reproduces the PUBLISHED product att sites (external authority)", () => {
  it("LR site-1 attL1 x attR1 -> exactly the published attB1", () => {
    const attB1Product = crossoverAtt(ATTR1, ATTL1, 1, "attB1", "B")!;
    expect(attB1Product.seq).toBe(ATTB1);
  });
  it("LR site-2 attL2 x attR2 -> exactly the published attB2", () => {
    const attB2Product = crossoverAtt(ATTL2, ATTR2, 2, "attB2", "B")!;
    expect(attB2Product.seq).toBe(ATTB2);
  });
  it("BP site-1 attB1 x attP1 -> attL1 ending in the published gene-proximal attL1", () => {
    // attL is 100 bp in vendor numbering; the published 50 bp attL1 is its
    // gene-proximal half. The crossover product must END WITH it exactly.
    const attL1Product = crossoverAtt(ATTP1, ATTB1, 1, "attL1", "L")!;
    expect(attL1Product.seq.endsWith(ATTL1)).toBe(true);
  });
});

// ── BP REACTION (attB-PCR x pDONR -> entry clone + byproduct) ─────────────────
describe("runGateway BP — attB-PCR product x donor -> entry clone", () => {
  const insert: GatewaySubstrate = { name: "attB-PCR", seq: PCR_SEQ, circular: false };
  const donor: GatewaySubstrate = { name: "pDONR", seq: DONOR_SEQ, circular: true };
  const res = runGateway(insert, donor, "BP");

  it("produces a clone and a byproduct", () => {
    expect(res.reaction).toBe("BP");
    expect(res.products).toHaveLength(2);
    expect(res.products[0].role).toBe("clone");
    expect(res.products[1].role).toBe("byproduct");
  });

  it("the entry clone carries the gene in a single defined orientation", () => {
    const clone = res.products[0];
    const doubled = clone.seq + clone.seq; // circular: allow wrap
    expect(doubled.includes(GENE)).toBe(true); // forward orientation present
  });

  it("the entry clone's flanking sites are attL (BP -> attL), site 1 and site 2", () => {
    const clone = res.products[0];
    expect(clone.attSites.map((a) => a.family)).toEqual(["L", "L"]);
    expect(clone.attSites.map((a) => a.specificity).sort()).toEqual([1, 2]);
    // The clone-side attL1 ends in the published gene-proximal attL1.
    const l1 = clone.attSites.find((a) => a.specificity === 1)!;
    expect(l1.seq.endsWith(ATTL1)).toBe(true);
  });

  it("the ccdB cassette is removed from the entry clone (transferred to byproduct)", () => {
    const clone = res.products[0];
    const byproduct = res.products[1];
    const cloneDoubled = clone.seq + clone.seq;
    expect(cloneDoubled.includes(CCDB)).toBe(false);
    expect((byproduct.seq + byproduct.seq).includes(CCDB)).toBe(true);
  });
});

// ── LR REACTION (entry x destination -> expression clone + byproduct) ─────────
describe("runGateway LR — entry clone x destination -> expression clone", () => {
  const entry: GatewaySubstrate = { name: "pENTR-GENE", seq: ENTRY_SEQ, circular: true };
  const dest: GatewaySubstrate = { name: "pDEST", seq: DEST_SEQ, circular: true };
  const res = runGateway(entry, dest, "LR");

  // HAND-DERIVED expected expression clone (canonicalized). Layout pre-canonical:
  //   cloneAtt1(=attB1) + GENE + cloneAtt2(=attB2) + destBackboneOutside
  // destBackboneOutside = DEST[after attR2] + DEST[before attR1]
  //                     = "CCCCC" + "GGGGGCATGCATGGGGG"
  const DEST_OUTSIDE = "CCCCC" + DEST_BB;
  const EXPR_PRECANON = ATTB1 + GENE + ATTB2 + DEST_OUTSIDE;
  const EXPR_EXPECTED = canonicalCircular(EXPR_PRECANON);

  it("assembles the hand-derived expression clone EXACTLY (canonical circle)", () => {
    expect(res.products[0].role).toBe("clone");
    expect(res.products[0].seq).toBe(EXPR_EXPECTED);
  });

  it("the expression clone's flanking sites are the published attB1 and attB2", () => {
    const clone = res.products[0];
    const b1 = clone.attSites.find((a) => a.specificity === 1)!;
    const b2 = clone.attSites.find((a) => a.specificity === 2)!;
    expect(b1.family).toBe("B");
    expect(b2.family).toBe("B");
    expect(b1.seq).toBe(ATTB1);
    expect(b2.seq).toBe(ATTB2);
  });

  it("the byproduct carries attP sites and the ccdB cassette", () => {
    const byproduct = res.products[1];
    expect(byproduct.attSites.map((a) => a.family)).toEqual(["P", "P"]);
    expect((byproduct.seq + byproduct.seq).includes(CCDB)).toBe(true);
  });

  it("the expression clone keeps the gene and drops the cassette", () => {
    const clone = res.products[0];
    const doubled = clone.seq + clone.seq;
    expect(doubled.includes(GENE)).toBe(true);
    expect(doubled.includes(CCDB)).toBe(false);
  });
});
