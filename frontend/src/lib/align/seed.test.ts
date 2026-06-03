import { describe, expect, it } from "vitest";
import { buildKmerIndex, seedAndExtend } from "./seed";
import { reverseComplement } from "./scoring";

const QUERY = "ATGGCATTACCGGTAA"; // 16 bp, not its own reverse complement
const FLANK = "GGGGG";

describe("buildKmerIndex", () => {
  it("indexes every k-mer start position", () => {
    const idx = buildKmerIndex("ACGTACGT", 4);
    expect(idx.get("ACGT")).toEqual([0, 4]);
    expect(idx.get("CGTA")).toEqual([1]);
    // Distinct 4-mers of ACGTACGT: ACGT, CGTA, GTAC, TACG (ACGT repeats).
    expect(idx.size).toBe(4);
  });

  it("returns an empty index when target is shorter than k", () => {
    expect(buildKmerIndex("AC", 4).size).toBe(0);
    expect(buildKmerIndex("ACGT", 0).size).toBe(0);
  });
});

describe("seedAndExtend forward strand", () => {
  it("places a query into a small flanked target on the + strand", () => {
    const target = FLANK + QUERY + FLANK;
    const hits = seedAndExtend(QUERY, target, { directIfTargetUnder: 1000 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const best = hits[0];
    expect(best.strand).toBe(1);
    expect(best.score).toBe(QUERY.length * 2); // exact match, +2 each
    expect(best.targetStart).toBe(FLANK.length);
    expect(best.targetEnd).toBe(FLANK.length + QUERY.length);
    expect(best.alignment.cigar).toBe(`${QUERY.length}M`);
    expect(best.alignment.identity).toBe(1);
  });
});

describe("seedAndExtend reverse strand", () => {
  it("detects a query bound as its reverse complement and reports strand -1", () => {
    // Plant the REVERSE COMPLEMENT of the query into a forward target. The query
    // therefore binds the - strand; coordinates map back to forward-target space.
    const target = FLANK + reverseComplement(QUERY) + FLANK;
    const hits = seedAndExtend(QUERY, target, { directIfTargetUnder: 1000 });
    const best = hits[0];
    expect(best.strand).toBe(-1);
    expect(best.score).toBe(QUERY.length * 2);
    expect(best.targetStart).toBe(FLANK.length);
    expect(best.targetEnd).toBe(FLANK.length + QUERY.length);
    expect(best.alignment.cigar).toBe(`${QUERY.length}M`);
  });

  it("does not report a reverse hit when bothStrands is false", () => {
    const target = FLANK + reverseComplement(QUERY) + FLANK;
    const hits = seedAndExtend(QUERY, target, {
      directIfTargetUnder: 1000,
      bothStrands: false,
    });
    // No forward exact site exists; the only site is on the - strand, which is
    // now excluded. The forward windowed align may still produce a weak hit, so
    // assert no STRONG (full-length, full-score) hit is returned.
    const strong = hits.find((h) => h.score === QUERY.length * 2);
    expect(strong).toBeUndefined();
  });
});

describe("seedAndExtend on a larger synthetic target", () => {
  // Deterministic pseudo-random target so the test is reproducible.
  function makeTarget(len: number, seed: number): string {
    const bases = "ACGT";
    let s = seed;
    const rnd = (): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    let out = "";
    for (let i = 0; i < len; i++) out += bases[Math.floor(rnd() * 4)];
    return out;
  }

  it("finds a planted near-exact site (2 mismatches near the ends), ranked best", () => {
    const site = "TTAGGCATCGGATCAACGTTACGT"; // 24 bp
    // Two end mismatches; the long clean interior still yields k-mer seeds.
    const mutated = "A" + site.slice(1, 23) + "A";
    let diffs = 0;
    for (let i = 0; i < site.length; i++) if (site[i] !== mutated[i]) diffs++;
    expect(diffs).toBe(2);

    const big = makeTarget(4000, 99);
    const planted = big.slice(0, 2000) + mutated + big.slice(2000);

    const hits = seedAndExtend(site, planted, { k: 10, maxHits: 5 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const best = hits[0];
    expect(best.strand).toBe(1);
    expect(best.targetStart).toBe(2000);
    expect(best.targetEnd).toBe(2024);
    // 22 matches * 2 - 2 mismatches * 1 = 42.
    expect(best.score).toBe(42);
    expect(best.alignment.cigar).toBe("1X22M1X");
    expect(best.alignment.identity).toBeCloseTo(22 / 24, 10);
  });

  it("uses the seeded path (not direct) for large targets and stays fast", () => {
    const big = makeTarget(50000, 7);
    const site = "GATTACAGATTACAGATTACA";
    const planted = big.slice(0, 25000) + site + big.slice(25000);
    const start = Date.now();
    const hits = seedAndExtend(site, planted, { k: 11 });
    const elapsed = Date.now() - start;
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].targetStart).toBe(25000);
    expect(hits[0].score).toBe(site.length * 2);
    // Seed-and-extend should be far below a naive full DP; generous ceiling.
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("seedAndExtend edge cases", () => {
  it("returns no hits when there is no seed and no positive alignment", () => {
    const hits = seedAndExtend("AAAAAAAAAAAA", "CCCCCCCCCCCCCCCCCCCC", {
      directIfTargetUnder: 0,
      k: 8,
    });
    expect(hits).toEqual([]);
  });

  it("is deterministic across repeated runs", () => {
    const target = FLANK + QUERY + FLANK + reverseComplement(QUERY) + FLANK;
    const a = JSON.stringify(seedAndExtend(QUERY, target, { directIfTargetUnder: 1000 }));
    const b = JSON.stringify(seedAndExtend(QUERY, target, { directIfTargetUnder: 1000 }));
    expect(a).toBe(b);
  });
});
