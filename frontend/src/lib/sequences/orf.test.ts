// sequence Phase 2c bot — ORF finder tests.

import { describe, it, expect } from "vitest";
import { findOrfs } from "./orf";

describe("findOrfs", () => {
  it("finds a simple forward ORF (ATG ... stop)", () => {
    // ATG + 30 codons + TAA = comfortably above minAa=30 with the stop.
    const codons = "AAA".repeat(31);
    const seq = "ATG" + codons + "TAA";
    const orfs = findOrfs(seq, 30);
    const fwd = orfs.filter((o) => o.strand === 1);
    expect(fwd.length).toBeGreaterThanOrEqual(1);
    expect(fwd[0].start).toBe(0);
    expect(fwd[0].end).toBe(seq.length);
  });

  it("ignores short ORFs below minAa", () => {
    const seq = "ATG" + "AAA".repeat(3) + "TAA"; // only ~3 aa
    expect(findOrfs(seq, 30)).toHaveLength(0);
  });

  it("finds a reverse-strand ORF mapped to forward coordinates", () => {
    // Build a forward sequence whose reverse complement contains an ORF.
    const codons = "AAA".repeat(31);
    const fwdLikeOrf = "ATG" + codons + "TAA";
    // Reverse-complement it so the ORF lives on the reverse strand of `seq`.
    const rc = fwdLikeOrf
      .split("")
      .reverse()
      .map((c) => ({ A: "T", T: "A", G: "C", C: "G" } as Record<string, string>)[c] ?? "N")
      .join("");
    const orfs = findOrfs(rc, 30);
    const rev = orfs.filter((o) => o.strand === -1);
    expect(rev.length).toBeGreaterThanOrEqual(1);
    expect(rev[0].start).toBe(0);
    expect(rev[0].end).toBe(rc.length);
  });
});
