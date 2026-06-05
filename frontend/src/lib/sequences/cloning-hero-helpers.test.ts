import { describe, it, expect } from "vitest";
import {
  gradeOverlapTm,
  checkFusionUniqueness,
  internalSiteFlags,
  stickyEndSeam,
} from "./cloning-hero-helpers";

describe("gradeOverlapTm", () => {
  it("grades at/above the anneal temp as strong", () => {
    expect(gradeOverlapTm(60, 50)).toBe("strong");
    expect(gradeOverlapTm(50, 50)).toBe("strong");
  });
  it("grades within 5 C below as marginal", () => {
    expect(gradeOverlapTm(49, 50)).toBe("marginal");
    expect(gradeOverlapTm(45, 50)).toBe("marginal");
  });
  it("grades more than 5 C below as weak", () => {
    expect(gradeOverlapTm(44, 50)).toBe("weak");
    expect(gradeOverlapTm(30, 50)).toBe("weak");
  });
  it("treats NaN (no overlap) as weak", () => {
    expect(gradeOverlapTm(NaN, 50)).toBe("weak");
  });
});

describe("checkFusionUniqueness", () => {
  it("reports unique when all overhangs differ", () => {
    const r = checkFusionUniqueness(["AATG", "GGTT", "CACC"]);
    expect(r.unique).toBe(true);
    expect(r.clashes).toEqual([]);
  });
  it("flags an exact duplicate pair", () => {
    const r = checkFusionUniqueness(["AATG", "GGTT", "AATG"]);
    expect(r.unique).toBe(false);
    expect(r.clashes).toEqual([{ a: 0, b: 2, overhang: "AATG" }]);
  });
  it("treats reverse-complement overhangs as the same fusion site", () => {
    // AATG revcomp = CATT, so these clash.
    const r = checkFusionUniqueness(["AATG", "CATT"]);
    expect(r.unique).toBe(false);
    expect(r.clashes).toHaveLength(1);
  });
  it("ignores blunt seams (empty string) entirely", () => {
    const r = checkFusionUniqueness(["", "", "AATG"]);
    expect(r.unique).toBe(true);
  });
  it("reports every clashing pair", () => {
    const r = checkFusionUniqueness(["AATG", "AATG", "AATG"]);
    expect(r.clashes).toHaveLength(3); // (0,1),(0,2),(1,2)
  });
});

describe("internalSiteFlags", () => {
  it("flags a fragment that yielded more than one piece", () => {
    const flags = internalSiteFlags([
      { sourceName: "insert" },
      { sourceName: "insert" },
      { sourceName: "vector" },
    ]);
    expect(flags).toEqual([{ sourceName: "insert", pieces: 2 }]);
  });
  it("flags nothing when every fragment yielded one piece", () => {
    const flags = internalSiteFlags([
      { sourceName: "insert" },
      { sourceName: "vector" },
    ]);
    expect(flags).toEqual([]);
  });
});

describe("stickyEndSeam", () => {
  it("renders a blunt seam flush with equal-length strands", () => {
    const s = stickyEndSeam("blunt", "", 2);
    expect(s.kind).toBe("blunt");
    expect(s.top.length).toBe(s.bottom.length);
    expect(s.top).not.toContain(" ");
  });
  it("puts the 5' overhang bases on the top strand and a gap on the bottom", () => {
    const s = stickyEndSeam("5'", "AATT", 2);
    expect(s.top).toBe("==AATT==");
    expect(s.bottom).toBe("==    ==");
    expect(s.top.length).toBe(s.bottom.length);
  });
  it("puts the 3' overhang complement on the bottom strand and a gap on top", () => {
    const s = stickyEndSeam("3'", "TGCA", 2);
    // bottom carries complement of TGCA = ACGT
    expect(s.top).toBe("==    ==");
    expect(s.bottom).toBe("==ACGT==");
    expect(s.top.length).toBe(s.bottom.length);
  });
});
