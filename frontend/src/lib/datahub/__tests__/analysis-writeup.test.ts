import { describe, expect, it } from "vitest";

import type { NormalizedTTest } from "@/lib/datahub/run-analysis";
import {
  methodsParagraph,
  resultsParagraph,
  collectReferences,
  referencesText,
} from "@/lib/datahub/analysis-writeup";

// The writeup is a pure function of a normalized result. These tests build
// minimal typed result literals (mirroring worked-example.test.ts) and assert the
// Methods text names the right test + cites the right canonical paper, that the
// Results text reuses the validated verdict, and that the reference list dedupes
// methods + always carries the software citation.

function baseGroup(name: string) {
  return { columnId: name.toLowerCase(), name, values: [] as number[] };
}

function ttest(overrides: Partial<NormalizedTTest> = {}): NormalizedTTest {
  return {
    kind: "ttest",
    type: "unpairedTTest",
    test: "Welch's t-test",
    nonparametric: false,
    tail: "two-sided",
    variance: "welch",
    groups: [baseGroup("Control"), baseGroup("Drug")] as NormalizedTTest["groups"],
    statistic: 4.2,
    df: 8,
    pValue: 0.001,
    effectSize: 1.2,
    effectSizeLabel: "Cohen's d",
    hedgesG: 1.1,
    effectSizeCI95: [0.5, 1.9],
    ci95: [1, 3],
    bootstrapCI95: null,
    normalityShaky: false,
    meanA: 100,
    meanB: 80,
    meanDiff: 20,
    ...overrides,
  };
}

describe("analysis-writeup: Methods paragraph", () => {
  it("names Welch's t-test and cites Welch 1947 + the software", () => {
    const m = methodsParagraph(ttest());
    expect(m).toContain("Welch's unpaired t-test");
    expect(m).toContain("Welch 1947");
    expect(m).toContain("Cohen 1988");
    expect(m).toContain("ResearchOS Data Hub");
    // The citation sentence ends with a period so the software sentence does not
    // run on (regression: "1981) Statistical" with no period).
    expect(m).toContain("1981). Statistical analyses");
    expect(m).not.toMatch(/\d\) Statistical/);
  });

  it("switches to Student's t-test when equal variance is assumed", () => {
    const m = methodsParagraph(ttest({ variance: "student", test: "Student's t-test" }));
    expect(m).toContain("Student's unpaired t-test");
    expect(m).not.toContain("Welch's unpaired t-test");
  });

  it("names the rank-based test and cites Mann-Whitney 1947", () => {
    const m = methodsParagraph(
      ttest({ type: "mannWhitneyU", nonparametric: true, hedgesG: null, test: "Mann-Whitney U" }),
    );
    expect(m).toContain("Mann-Whitney U");
    expect(m).toContain("Mann and Whitney 1947");
  });
});

describe("analysis-writeup: Results paragraph + references", () => {
  it("Results text reuses the validated plain-language verdict (non-empty)", () => {
    const r = resultsParagraph(ttest());
    expect(typeof r).toBe("string");
    expect(r.length).toBeGreaterThan(0);
  });

  it("collects the method references plus the software, deduped", () => {
    const refs = collectReferences(ttest());
    const ids = refs.map((r) => r.id);
    expect(ids).toContain("welchT");
    expect(ids).toContain("cohensD");
    expect(ids).toContain("researchosDataHub");
    // No duplicate ids.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("formats the reference list as a numbered, paste-ready block", () => {
    const text = referencesText(ttest());
    expect(text.startsWith("1. ")).toBe(true);
    expect(text).toContain("Welch BL (1947)");
    expect(text).toContain("Biometrika");
    // No double period when a title already ends in one ("2nd ed.").
    expect(text).not.toContain("..");
    expect(text).toContain("2nd ed. Lawrence Erlbaum");
  });
});
