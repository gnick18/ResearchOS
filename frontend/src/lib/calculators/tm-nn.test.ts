import { describe, expect, it } from "vitest";

import { nearestNeighborTm, cleanDnaSeq } from "./tm-nn";

/**
 * The nearest-neighbor Tm is correctness-critical (people set PCR annealing
 * temps off it), so it is pinned against an authoritative oracle rather than
 * our own arithmetic: Biopython's Bio.SeqUtils.MeltingTemp.Tm_NN, using its
 * default DNA_NN3 table (Allawi & SantaLucia 1997), dnac1 = dnac2 = 25 nM
 * (50 nM total oligo), and saltcorr = 5 (SantaLucia 1998). The three documented
 * values below are copied verbatim from Biopython's module docstring for
 * myseq = "CGTTCCAAAGATGTGGGCATGAGCTTAC":
 *
 *   Tm_NN(myseq, Na=50)                 -> 60.79? No: with Tris.
 *   Tm_NN(myseq)              [Na=50]   -> 60.32
 *   Tm_NN(myseq, Na=50, Tris=10)        -> 60.79
 *   Tm_NN(myseq, Na=50, Tris=10, Mg=1.5)-> 67.39   (von Ahsen Mg2+ path)
 *
 * Our UI passes oligoNanomolar = 250 (IDT 0.25 uM default), but these fixtures
 * pass 50 to match Biopython's dnac defaults exactly.
 */

const MYSEQ = "CGTTCCAAAGATGTGGGCATGAGCTTAC";

describe("nearestNeighborTm — Biopython Tm_NN parity (DNA_NN3, 50 nM, saltcorr 5)", () => {
  it("Na=50 reproduces 60.32 C", () => {
    const r = nearestNeighborTm(MYSEQ, { na: 50, oligoNanomolar: 50 });
    expect(r).not.toBeNull();
    expect(r!.tm).toBeCloseTo(60.32, 2);
  });

  it("Na=50, Tris=10 reproduces 60.79 C (monovalent equivalent)", () => {
    const r = nearestNeighborTm(MYSEQ, { na: 50, tris: 10, oligoNanomolar: 50 });
    expect(r!.tm).toBeCloseTo(60.79, 2);
  });

  it("Na=50, Tris=10, Mg=1.5 reproduces 67.39 C (von Ahsen Mg2+ path)", () => {
    const r = nearestNeighborTm(MYSEQ, {
      na: 50,
      tris: 10,
      mg: 1.5,
      oligoNanomolar: 50,
    });
    expect(r!.tm).toBeCloseTo(67.39, 2);
  });
});

describe("nearestNeighborTm — behavior + guards", () => {
  it("Mg2+ raises Tm vs monovalent-only (more clicks buy real accuracy)", () => {
    const base = nearestNeighborTm(MYSEQ, { na: 50, oligoNanomolar: 250 })!.tm;
    const withMg = nearestNeighborTm(MYSEQ, {
      na: 50,
      mg: 2,
      oligoNanomolar: 250,
    })!.tm;
    expect(withMg).toBeGreaterThan(base);
  });

  it("higher oligo concentration raises Tm", () => {
    const lo = nearestNeighborTm(MYSEQ, { na: 50, oligoNanomolar: 50 })!.tm;
    const hi = nearestNeighborTm(MYSEQ, { na: 50, oligoNanomolar: 500 })!.tm;
    expect(hi).toBeGreaterThan(lo);
  });

  it("dNTPs >= Mg cancels the divalent contribution", () => {
    const mgOnly = nearestNeighborTm(MYSEQ, { na: 50, mg: 1.5 })!.tm;
    const chelated = nearestNeighborTm(MYSEQ, { na: 50, mg: 1.5, dntps: 1.5 })!.tm;
    // With dNTPs == Mg, free Mg2+ is ~0, so it collapses to the Na-only result.
    const naOnly = nearestNeighborTm(MYSEQ, { na: 50 })!.tm;
    expect(chelated).toBeCloseTo(naOnly, 6);
    expect(mgOnly).toBeGreaterThan(chelated);
  });

  it("folds RNA U into T and ignores non-ACGT characters", () => {
    expect(cleanDnaSeq("aug c-u 9n")).toBe("ATGCT");
    const withWhitespace = nearestNeighborTm("CGTTCC AAAGAT GTGGGC ATGAGC TTAC", {
      na: 50,
      oligoNanomolar: 50,
    });
    expect(withWhitespace!.tm).toBeCloseTo(60.32, 2);
  });

  it("returns null for sequences shorter than 2 bases", () => {
    expect(nearestNeighborTm("A")).toBeNull();
    expect(nearestNeighborTm("")).toBeNull();
  });

  it("returns null when there is no salt to take a log of", () => {
    expect(nearestNeighborTm(MYSEQ, { na: 0 })).toBeNull();
  });
});
