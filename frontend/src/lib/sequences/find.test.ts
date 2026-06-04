import { describe, it, expect } from "vitest";
import {
  findExactDna,
  findCloseDna,
  findByName,
  findProtein,
  findCloseProtein,
  isDnaQuery,
  isProteinQuery,
} from "./find";
import type { EditFeature } from "./edit-model";

describe("findExactDna", () => {
  it("finds a forward-strand exact match", () => {
    const hits = findExactDna("GAATTC", "AAAGAATTCAAA");
    const fwd = hits.filter((h) => h.direction === 1);
    expect(fwd).toHaveLength(1);
    expect(fwd[0]).toMatchObject({ start: 3, end: 9, direction: 1 });
  });

  it("finds a match on the reverse strand", () => {
    // "TTTAAA" reverse-complements to "TTTAAA" (palindrome) so use a non-palindrome.
    // Query "AGGT"; its rev-comp "ACCT" appears at index 2.
    const hits = findExactDna("AGGT", "GGACCTGG");
    const rev = hits.filter((h) => h.direction === -1);
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ start: 2, end: 6, direction: -1 });
    // no forward hit of AGGT in this target
    expect(hits.filter((h) => h.direction === 1)).toHaveLength(0);
  });

  it("finds both strands and does not double-count a palindrome", () => {
    // GAATTC is a palindrome (its own reverse complement). One hit, not two.
    const hits = findExactDna("GAATTC", "AAAGAATTCAAA");
    expect(hits).toHaveLength(1);
  });

  it("is IUPAC-degeneracy aware (N matches anything)", () => {
    const hits = findExactDna("GANTC", "AAGATTCAA").filter((h) => h.direction === 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].start).toBe(2);
  });

  it("finds multiple forward occurrences", () => {
    const hits = findExactDna("AA", "AAXAA".replace("X", "C"));
    const fwd = hits.filter((h) => h.direction === 1).map((h) => h.start);
    expect(fwd).toEqual([0, 3]);
  });

  it("wraps the origin when circular", () => {
    // Sequence ATTCG, circular. Query "CGAT" wraps: CG at end + AT at start.
    const hits = findExactDna("CGAT", "ATTCG", true).filter((h) => h.direction === 1);
    expect(hits.length).toBe(1);
    expect(hits[0].start).toBe(3); // starts at index 3 (C), wraps to A,T
  });

  it("returns nothing for a query with no match (neither strand)", () => {
    // "GGGGGGGG" rev-comps to "CCCCCCCC"; neither appears in an all-A target.
    expect(findExactDna("GGGGGGGG", "AAAAAAAA")).toHaveLength(0);
  });
});

describe("findCloseDna", () => {
  it("returns the best approximate site with identity and mismatch count when no exact hit", () => {
    // target has GAATTC at 10..16 with a single 1-bp change to GAATTT.
    const target = "CCCCCCCCCCGAATTTCCCCCCCCCC";
    expect(findExactDna("GAATTC", target).filter((h) => h.direction === 1)).toHaveLength(0);
    const close = findCloseDna("GAATTC", target, { minIdentity: 0.5 });
    expect(close.length).toBeGreaterThan(0);
    const best = close[0];
    // 5/6 identical -> ~83%, 1 substitution.
    expect(best.identityPct).toBeGreaterThanOrEqual(80);
    expect(best.mismatches).toBe(1);
    expect(best.gaps).toBe(0);
    expect(best.label).toContain("closest match");
    expect(best.label).toContain("1 mismatch");
    // it should land on (or very near) the GAATTT site
    expect(best.start).toBeGreaterThanOrEqual(9);
    expect(best.start).toBeLessThanOrEqual(11);
  });

  it("respects the minIdentity floor", () => {
    const close = findCloseDna("GAATTC", "TTTTTTTTTTTTTTTTTTTT", { minIdentity: 0.9 });
    expect(close).toHaveLength(0);
  });

  it("finds an approximate site on the reverse strand", () => {
    // forward GAATTC rev-comp is GAATTC (palindrome); use AAAGGG -> revcomp CCCTTT.
    // Put a near-CCCTTT on the forward strand so the query AAAGGG matches reverse.
    const target = "TTTTTTTTTTCCCATTTTTTTTTT"; // CCCATT ~ CCCTTT with 1 change
    const close = findCloseDna("AAAGGG", target, { minIdentity: 0.5 });
    expect(close.length).toBeGreaterThan(0);
  });
});

describe("findByName", () => {
  const features: EditFeature[] = [
    { name: "GFP", start: 100, end: 820, strand: 1, type: "CDS" } as EditFeature,
    { name: "M13 fwd", start: 10, end: 30, strand: 1, type: "primer_bind" } as EditFeature,
    { name: "lac promoter", start: 0, end: 50, strand: 1, type: "promoter" } as EditFeature,
  ];

  it("matches feature names (case-insensitive substring) and tags primers", () => {
    const seq = "ACGT".repeat(250);
    const gfp = findByName("gfp", seq, features);
    expect(gfp).toHaveLength(1);
    expect(gfp[0]).toMatchObject({ kind: "feature", name: "GFP", start: 100, end: 820 });

    const primer = findByName("m13", seq, features);
    expect(primer.some((m) => m.kind === "primer" && m.name === "M13 fwd")).toBe(true);
  });

  it("matches restriction-enzyme names and locates their cut sites", () => {
    // EcoRI recognition site GAATTC placed once in the target.
    const seq = "AAAAGAATTCAAAA";
    const hits = findByName("EcoRI", seq, []);
    const enzymeHits = hits.filter((h) => h.kind === "enzyme");
    expect(enzymeHits.length).toBeGreaterThan(0);
    expect(enzymeHits[0].name.toLowerCase()).toContain("ecori");
    // the located site should overlap the GAATTC at index 4
    expect(enzymeHits.some((h) => h.start === 4)).toBe(true);
  });

  it("returns nothing for an unmatched name", () => {
    expect(findByName("zzznotreal", "ACGTACGT", features)).toHaveLength(0);
  });
});

describe("findProtein", () => {
  it("finds an AA query in a forward frame and maps to nucleotide coords", () => {
    // ATG AAA = M K, in frame 0. Query "MK".
    const seq = "ATGAAATAA";
    const hits = findProtein("MK", seq, { bothStrands: false });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ start: 0, end: 6, direction: 1 });
  });

  it("finds an AA query in a non-zero frame", () => {
    // shift by one base: query MK starts at nt index 1.
    const seq = "CATGAAATAA";
    const hits = findProtein("MK", seq, { bothStrands: false });
    expect(hits.some((h) => h.start === 1 && h.end === 7)).toBe(true);
  });

  it("finds an AA query on the reverse strand", () => {
    // reverse-complement of "ATGAAA" region. Build forward seq whose revcomp encodes MK.
    // revcomp("TTTCAT") = "ATGAAA" -> M K. Place TTTCAT in forward seq.
    const seq = "GGTTTCATGG";
    const hits = findProtein("MK", seq, { bothStrands: true });
    expect(hits.some((h) => h.direction === -1)).toBe(true);
  });
});

describe("findCloseProtein", () => {
  // Forward seq encoding peptide MKWL in frame 0:
  //   M=ATG K=AAA W=TGG L=CTG
  const MKWL = "ATGAAATGGCTG";

  it("finds a one-residue-off peptide as a close match with identity", () => {
    // Query MKWV differs from the encoded MKWL only at the last residue (L->V),
    // so an exact search misses but the close search reports 3/4 = 75% identity.
    expect(findProtein("MKWV", MKWL, { bothStrands: false })).toHaveLength(0);
    const close = findCloseProtein("MKWV", MKWL, { bothStrands: false });
    expect(close.length).toBeGreaterThan(0);
    const best = close[0];
    expect(best.identityPct).toBe(75);
    expect(best.mismatches).toBe(1);
    expect(best.gaps).toBe(0);
    expect(best.direction).toBe(1);
    // The hit spans the 4-codon (12 nt) ORF in forward coordinates.
    expect(best).toMatchObject({ start: 0, end: 12 });
    expect(best.label).toContain("75% identity");
  });

  it("reports a perfect close match (100% identity) for an exact peptide", () => {
    const close = findCloseProtein("MKWL", MKWL, { bothStrands: false });
    expect(close[0].identityPct).toBe(100);
    expect(close[0].mismatches).toBe(0);
  });

  it("suppresses hits below the identity floor", () => {
    // A peptide sharing little with MKWL stays under the default 0.6 floor.
    const close = findCloseProtein("DDDD", MKWL, { bothStrands: false });
    expect(close).toHaveLength(0);
  });

  it("finds a close peptide on the reverse strand", () => {
    // revcomp of MKWL-encoding DNA, padded, so the close hit lands on strand -1.
    const seq = "GG" + "CAGCCATTTCAT" + "GG"; // revcomp(ATGAAATGGCTG)=CAGCCATTTCAT
    const close = findCloseProtein("MKWV", seq, { bothStrands: true });
    expect(close.some((h) => h.direction === -1)).toBe(true);
  });
});

describe("query classifiers", () => {
  it("isDnaQuery accepts ACGT + IUPAC, rejects others", () => {
    expect(isDnaQuery("GAATTC")).toBe(true);
    expect(isDnaQuery("GANTC")).toBe(true);
    expect(isDnaQuery("")).toBe(false);
    expect(isDnaQuery("hello")).toBe(false);
  });

  it("isProteinQuery accepts AAs, rejects nonsense", () => {
    expect(isProteinQuery("MKVLA")).toBe(true);
    expect(isProteinQuery("MK*")).toBe(true);
    expect(isProteinQuery("123")).toBe(false);
    expect(isProteinQuery("")).toBe(false);
  });
});
