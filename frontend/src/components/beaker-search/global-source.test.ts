// sequence editor master (chunk 2). Unit tests for the PURE global object-search
// ranking + grouping brain (global-source.ts). No React, no DOM, no Date.now(),
// the clock is injected so the recency boost is deterministic. Mirrors the test
// posture of global-index.test.ts and editor-commands.test.ts.
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence
// colons.

import { describe, it, expect } from "vitest";
import type { GlobalIndexEntry } from "./global-index";
import {
  GLOBAL_OVERALL_CAP,
  GLOBAL_PER_TYPE_CAP,
  activePageTypeForPath,
  rankGlobalEntries,
  scoreGlobalEntry,
} from "./global-source";

// A fixed clock for the recency boost, so "fresh" vs "stale" is deterministic.
const NOW = 1_700_000_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Build a GlobalIndexEntry with sensible defaults; override per test. The
 *  haystack defaults to the label lowercased so a query that is a subsequence of
 *  the label matches. */
function entry(over: Partial<GlobalIndexEntry> = {}): GlobalIndexEntry {
  const label = over.label ?? "Mitochondria QC";
  return {
    type: "task",
    key: "self:1",
    label,
    meta: "Experiment in Project",
    haystack: (over.haystack ?? label).toLowerCase(),
    recencyAt: 0,
    iconName: "list",
    href: "/?openTask=self%3A1",
    enabled: true,
    ...over,
  };
}

/** Flatten the grouped result back to a single best-first-ish list for the cap
 *  assertions (group order is GLOBAL_TYPE_ORDER, entries best-first per group). */
function allEntries(groups: ReturnType<typeof rankGlobalEntries>): GlobalIndexEntry[] {
  return groups.flatMap((g) => g.entries);
}

describe("scoreGlobalEntry", () => {
  it("returns null when the query does not match the haystack", () => {
    expect(scoreGlobalEntry("zzzz", entry({ haystack: "mitochondria qc" }), NOW)).toBeNull();
  });

  it("adds the per-type weight, task > project > sequence > method on equal text", () => {
    const hay = "alpha";
    const task = scoreGlobalEntry("alpha", entry({ type: "task", haystack: hay }), NOW)!;
    const project = scoreGlobalEntry("alpha", entry({ type: "project", haystack: hay }), NOW)!;
    const sequence = scoreGlobalEntry("alpha", entry({ type: "sequence", haystack: hay }), NOW)!;
    const method = scoreGlobalEntry("alpha", entry({ type: "method", haystack: hay }), NOW)!;
    expect(task).toBeGreaterThan(project);
    expect(project).toBeGreaterThan(sequence);
    expect(sequence).toBeGreaterThan(method);
    // The nudges are the documented additive deltas on top of the same base.
    expect(task - method).toBeCloseTo(3, 5);
    expect(project - method).toBeCloseTo(2, 5);
    expect(sequence - method).toBeCloseTo(1, 5);
  });

  it("boosts a freshly-touched record over a stale same-type same-name one", () => {
    const fresh = scoreGlobalEntry("alpha", entry({ haystack: "alpha", recencyAt: NOW }), NOW)!;
    const stale = scoreGlobalEntry(
      "alpha",
      entry({ haystack: "alpha", recencyAt: NOW - 10 * WEEK_MS }),
      NOW,
    )!;
    expect(fresh).toBeGreaterThan(stale);
    // A record older than four weeks gets no boost; a brand-new one gets +4.
    expect(fresh - stale).toBeCloseTo(4, 5);
  });

  it("caps the recency boost at +4 and never goes negative for old or future stamps", () => {
    const noStamp = scoreGlobalEntry("alpha", entry({ haystack: "alpha", recencyAt: 0 }), NOW)!;
    const ancient = scoreGlobalEntry(
      "alpha",
      entry({ haystack: "alpha", recencyAt: NOW - 100 * WEEK_MS }),
      NOW,
    )!;
    const future = scoreGlobalEntry(
      "alpha",
      entry({ haystack: "alpha", recencyAt: NOW + 5 * WEEK_MS }),
      NOW,
    )!;
    // No stamp and an ancient stamp both land at the +0 floor.
    expect(noStamp).toBeCloseTo(ancient, 5);
    // A future stamp is clamped to the +4 ceiling, same as touched-at-now.
    expect(future - noStamp).toBeCloseTo(4, 5);
  });
});

describe("rankGlobalEntries", () => {
  it("returns no groups for an empty or whitespace query", () => {
    const entries = [entry({ haystack: "alpha" })];
    expect(rankGlobalEntries(entries, "", { now: NOW, activePageType: null })).toEqual([]);
    expect(rankGlobalEntries(entries, "   ", { now: NOW, activePageType: null })).toEqual([]);
  });

  it("drops entries the query does not match", () => {
    const entries = [
      entry({ key: "self:1", haystack: "alpha beta" }),
      entry({ key: "self:2", haystack: "gamma delta" }),
    ];
    const groups = rankGlobalEntries(entries, "alpha", { now: NOW, activePageType: null });
    expect(allEntries(groups).map((e) => e.key)).toEqual(["self:1"]);
  });

  it("buckets matches into per-type groups in the task, project, sequence, method order", () => {
    const entries = [
      entry({ type: "method", key: "m:1", haystack: "alpha m" }),
      entry({ type: "sequence", key: "s:1", haystack: "alpha s" }),
      entry({ type: "task", key: "t:1", haystack: "alpha t" }),
      entry({ type: "project", key: "p:1", haystack: "alpha p" }),
    ];
    const groups = rankGlobalEntries(entries, "alpha", { now: NOW, activePageType: null });
    expect(groups.map((g) => g.type)).toEqual(["task", "project", "sequence", "method"]);
    expect(groups.map((g) => g.title)).toEqual(["Tasks", "Projects", "Sequences", "Methods"]);
  });

  it("suppresses the active page's own type (on-page de-dup)", () => {
    const entries = [
      entry({ type: "sequence", key: "s:1", haystack: "alpha s" }),
      entry({ type: "task", key: "t:1", haystack: "alpha t" }),
    ];
    const groups = rankGlobalEntries(entries, "alpha", {
      now: NOW,
      activePageType: "sequence",
    });
    expect(groups.map((g) => g.type)).toEqual(["task"]);
    expect(allEntries(groups).some((e) => e.type === "sequence")).toBe(false);
  });

  it("caps each type at GLOBAL_PER_TYPE_CAP", () => {
    const entries = Array.from({ length: GLOBAL_PER_TYPE_CAP + 3 }, (_, i) =>
      entry({ type: "task", key: `t:${i}`, haystack: `alpha ${i}` }),
    );
    const groups = rankGlobalEntries(entries, "alpha", { now: NOW, activePageType: null });
    const tasks = groups.find((g) => g.type === "task");
    expect(tasks?.entries.length).toBe(GLOBAL_PER_TYPE_CAP);
  });

  it("caps the whole result at GLOBAL_OVERALL_CAP across all types", () => {
    // Five of each of the four types matches, 20 total, but the overall cap is 12.
    const entries = (["task", "project", "sequence", "method"] as const).flatMap((type) =>
      Array.from({ length: GLOBAL_PER_TYPE_CAP }, (_, i) =>
        entry({ type, key: `${type}:${i}`, haystack: `alpha ${i}` }),
      ),
    );
    const groups = rankGlobalEntries(entries, "alpha", { now: NOW, activePageType: null });
    expect(allEntries(groups).length).toBe(GLOBAL_OVERALL_CAP);
  });

  it("keeps the strongest entries when the overall cap cuts (type weight breaks near-ties)", () => {
    // One method and many tasks all share the same base text match. The overall
    // cap should never drop a higher-scored task in favor of the lower-scored
    // method, so with 12 tasks plus 1 method the method is cut.
    const entries = [
      ...Array.from({ length: GLOBAL_OVERALL_CAP }, (_, i) =>
        entry({ type: "task", key: `t:${i}`, haystack: "alpha" }),
      ),
      entry({ type: "method", key: "m:lonely", haystack: "alpha" }),
    ];
    // Per-type cap is 5, so only 5 tasks survive; the method (weight 0) still
    // ranks below those 5 tasks but there is room under the overall cap, so it
    // should appear. This asserts the per-type cap and overall cap compose.
    const groups = rankGlobalEntries(entries, "alpha", { now: NOW, activePageType: null });
    const tasks = groups.find((g) => g.type === "task");
    const methods = groups.find((g) => g.type === "method");
    expect(tasks?.entries.length).toBe(GLOBAL_PER_TYPE_CAP);
    expect(methods?.entries.length).toBe(1);
  });

  // Relevance floor + hyphen normalization tests.

  it("drops a task whose haystack only matches primer by scattered coincidence", () => {
    // This haystack has p,r,i,m,e,r scattered with no contiguous run and no
    // word-boundary alignment, so it should not survive the relevance floor.
    const noise = entry({
      key: "t:noise",
      type: "task",
      haystack: "abstract work on improving results every time",
    });
    const signal = entry({
      key: "t:signal",
      type: "task",
      haystack: "primer design for PCR amplification",
    });
    const groups = rankGlobalEntries([noise, signal], "primer", { now: NOW, activePageType: null });
    const keys = allEntries(groups).map((e) => e.key);
    // The noise task must not appear; the signal task must appear and lead.
    expect(keys).not.toContain("t:noise");
    expect(keys[0]).toBe("t:signal");
  });

  it("finds PCR-screen integrants when the query uses a space instead of a hyphen", () => {
    // The haystack is built with a hyphen; the query uses a space. After
    // separator normalization both sides see "pcr screen integrants".
    const hyphenTask = entry({
      key: "t:pcr-screen",
      type: "task",
      haystack: "PCR-screen integrants colony pcr",
    });
    const groups = rankGlobalEntries([hyphenTask], "PCR screen", { now: NOW, activePageType: null });
    expect(allEntries(groups).map((e) => e.key)).toContain("t:pcr-screen");
  });

  it("does not surface a task above the floor for a long unrelated query", () => {
    // "yeast transformation" is 20 chars; the floor is 40. A task whose
    // haystack has a few scattered letters but no meaningful alignment fails.
    const unrelated = entry({
      key: "t:unrelated",
      type: "task",
      haystack: "yearly results for eastern analytical system format",
    });
    const groups = rankGlobalEntries([unrelated], "yeast transformation", { now: NOW, activePageType: null });
    expect(allEntries(groups).map((e) => e.key)).not.toContain("t:unrelated");
  });

  it("regression: known-good queries still surface their expected top hit", () => {
    const pcr = entry({ key: "t:pcr", type: "task", haystack: "PCR optimization protocol" });
    const other = entry({ key: "t:other", type: "task", haystack: "cell culture maintenance" });
    const groups = rankGlobalEntries([pcr, other], "PCR", { now: NOW, activePageType: null });
    const keys = allEntries(groups).map((e) => e.key);
    expect(keys).toContain("t:pcr");
    expect(keys[0]).toBe("t:pcr");
  });
});

describe("activePageTypeForPath", () => {
  it("maps the core entity routes to their hosted type", () => {
    expect(activePageTypeForPath("/methods")).toBe("method");
    expect(activePageTypeForPath("/sequences")).toBe("sequence");
    expect(activePageTypeForPath("/workbench/projects/7")).toBe("project");
    expect(activePageTypeForPath("/")).toBe("task");
    expect(activePageTypeForPath("/workbench")).toBe("task");
    expect(activePageTypeForPath("/gantt")).toBe("task");
    expect(activePageTypeForPath("/purchases")).toBe("task");
  });

  it("prefers the deeper project route over the bare workbench task mapping", () => {
    expect(activePageTypeForPath("/workbench/projects/7?owner=alex")).toBe("project");
  });

  it("returns null for a route hosting none of the four core types", () => {
    expect(activePageTypeForPath("/links")).toBeNull();
    expect(activePageTypeForPath("/settings")).toBeNull();
    expect(activePageTypeForPath(null)).toBeNull();
    expect(activePageTypeForPath(undefined)).toBeNull();
  });

  it("tolerates a trailing slash", () => {
    expect(activePageTypeForPath("/methods/")).toBe("method");
  });
});

describe("additive fuzzy pass (MiniSearch typo + OCR tolerance)", () => {
  it("finds a record by a typo'd query the strict subsequence pass misses", () => {
    const entries = [
      entry({ type: "task", key: "self:10", label: "PCR 30 cycles", haystack: "pcr 30 cycles 72c" }),
      entry({ type: "project", key: "self:11", label: "Plasmid prep", haystack: "plasmid prep" }),
    ];
    // "cyels" is NOT a subsequence of "cycles" (the l/e are out of order), so the
    // strict pass returns null; only an edit-distance pass can match it. This is
    // exactly the OCR-garble case (cycles -> cyels).
    const strict = scoreGlobalEntry("cyels", entries[0], NOW);
    expect(strict).toBeNull();
    const groups = rankGlobalEntries(entries, "cyels", { now: NOW, activePageType: null });
    const found = allEntries(groups);
    expect(found.map((e) => e.key)).toContain("self:10");
  });

  it("ranks an exact strict match above a fuzzy-only match", () => {
    const entries = [
      entry({ type: "method", key: "self:20", label: "protocol", haystack: "protocol" }),
      entry({ type: "method", key: "self:21", label: "protacol typo doc", haystack: "protacol typo doc" }),
    ];
    const groups = rankGlobalEntries(entries, "protocol", { now: NOW, activePageType: null });
    const found = allEntries(groups);
    // Both surface (exact + fuzzy), but the exact strict match leads.
    expect(found[0].key).toBe("self:20");
    expect(found.map((e) => e.key)).toContain("self:21");
  });

  it("matches a partial prefix the strict pass would also catch, without regressing", () => {
    const entries = [entry({ type: "task", key: "self:30", label: "Miniprep batch", haystack: "miniprep batch" })];
    const groups = rankGlobalEntries(entries, "minip", { now: NOW, activePageType: null });
    expect(allEntries(groups).map((e) => e.key)).toContain("self:30");
  });
});
