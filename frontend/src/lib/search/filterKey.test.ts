import { describe, it, expect } from "vitest";
import {
  encodeFilterKey,
  parseFilterKey,
  matchesProjectFilter,
  matchesMethodFilter,
  matchesAnyProjectFilter,
} from "./filterKey";

describe("filterKey: encode / parse round-trip", () => {
  it("encodes owner:id and parses back", () => {
    expect(encodeFilterKey({ owner: "alex", id: 1 })).toBe("alex:1");
    expect(parseFilterKey("alex:1")).toEqual({ owner: "alex", id: 1 });
  });

  it("returns null for empty / malformed keys", () => {
    expect(parseFilterKey(null)).toBeNull();
    expect(parseFilterKey(undefined)).toBeNull();
    expect(parseFilterKey("")).toBeNull();
    expect(parseFilterKey("alex")).toBeNull();
    expect(parseFilterKey(":1")).toBeNull();
    expect(parseFilterKey("alex:")).toBeNull();
    expect(parseFilterKey("alex:abc")).toBeNull();
  });

  it("treats only the LAST colon as the separator", () => {
    // Defensive: usernames shouldn't contain colons but the parser
    // shouldn't choke if they ever do.
    expect(parseFilterKey("weird:owner:42")).toEqual({ owner: "weird:owner", id: 42 });
  });
});

describe("matchesProjectFilter: per-owner disambiguation", () => {
  const alexProj1Task = { owner: "alex", project_id: 1 };
  const morganProj1Task = { owner: "morgan", project_id: 1 };
  const alexProj2Task = { owner: "alex", project_id: 2 };

  it("no filter passes everything", () => {
    expect(matchesProjectFilter(alexProj1Task, null)).toBe(true);
    expect(matchesProjectFilter(morganProj1Task, "")).toBe(true);
  });

  it("two projects with the same numeric id but different owners are independently filterable", () => {
    // Persona 18 regression: filtering on alex:1 must NOT match morgan's
    // project 1, even though they share project_id === 1.
    const alexKey = encodeFilterKey({ owner: "alex", id: 1 });
    expect(matchesProjectFilter(alexProj1Task, alexKey)).toBe(true);
    expect(matchesProjectFilter(morganProj1Task, alexKey)).toBe(false);

    const morganKey = encodeFilterKey({ owner: "morgan", id: 1 });
    expect(matchesProjectFilter(alexProj1Task, morganKey)).toBe(false);
    expect(matchesProjectFilter(morganProj1Task, morganKey)).toBe(true);
  });

  it("rejects same-owner mismatched id", () => {
    expect(matchesProjectFilter(alexProj2Task, "alex:1")).toBe(false);
  });
});

describe("matchesMethodFilter: per-owner disambiguation via attachments", () => {
  it("matches when attachment owner is explicit", () => {
    const task = {
      owner: "alex",
      method_ids: [2],
      method_attachments: [{ method_id: 2, owner: "public" }],
    };
    expect(matchesMethodFilter(task, "public:2")).toBe(true);
    // alex's own private method id 2 (a different record) must NOT match.
    expect(matchesMethodFilter(task, "alex:2")).toBe(false);
  });

  it("falls back to task owner when attachment owner is null", () => {
    const task = {
      owner: "alex",
      method_ids: [2],
      method_attachments: [{ method_id: 2, owner: null }],
    };
    expect(matchesMethodFilter(task, "alex:2")).toBe(true);
    expect(matchesMethodFilter(task, "public:2")).toBe(false);
  });

  it("falls back to task owner when no attachment row exists", () => {
    // Newly-created tasks before attachment backfill — bare method_ids only.
    const task = {
      owner: "alex",
      method_ids: [2],
      method_attachments: [],
    };
    expect(matchesMethodFilter(task, "alex:2")).toBe(true);
  });

  it("rejects when primary method id mismatches", () => {
    const task = {
      owner: "alex",
      method_ids: [3],
      method_attachments: [{ method_id: 3, owner: null }],
    };
    expect(matchesMethodFilter(task, "alex:2")).toBe(false);
  });

  it("rejects when task has no methods at all", () => {
    const task = { owner: "alex", method_ids: [], method_attachments: [] };
    expect(matchesMethodFilter(task, "alex:2")).toBe(false);
  });

  it("no filter passes everything", () => {
    const task = {
      owner: "alex",
      method_ids: [2],
      method_attachments: [{ method_id: 2, owner: null }],
    };
    expect(matchesMethodFilter(task, null)).toBe(true);
    expect(matchesMethodFilter(task, "")).toBe(true);
  });
});

describe("matchesAnyProjectFilter: multi-key OR for global pill bar", () => {
  const alexProj1Task = { owner: "alex", project_id: 1 };
  const morganProj1Task = { owner: "morgan", project_id: 1 };
  const alexProj2Task = { owner: "alex", project_id: 2 };

  it("empty key array passes everything (matches the `.length === 0` short-circuit)", () => {
    expect(matchesAnyProjectFilter(alexProj1Task, [])).toBe(true);
    expect(matchesAnyProjectFilter(morganProj1Task, [])).toBe(true);
  });

  it("alex:1 vs morgan:1 do NOT collide through the OR helper (persona 18)", () => {
    // Pre-fix code: `selectedProjectIds.includes(task.project_id)` against
    // `[1]` matched both alex's and morgan's project 1. With composite
    // keys ["alex:1"] should NOT match morgan, and ["morgan:1"] should
    // NOT match alex.
    expect(matchesAnyProjectFilter(alexProj1Task, ["alex:1"])).toBe(true);
    expect(matchesAnyProjectFilter(morganProj1Task, ["alex:1"])).toBe(false);
    expect(matchesAnyProjectFilter(alexProj1Task, ["morgan:1"])).toBe(false);
    expect(matchesAnyProjectFilter(morganProj1Task, ["morgan:1"])).toBe(true);
  });

  it("OR semantics: any matching key passes", () => {
    const keys = ["alex:1", "morgan:1"];
    expect(matchesAnyProjectFilter(alexProj1Task, keys)).toBe(true);
    expect(matchesAnyProjectFilter(morganProj1Task, keys)).toBe(true);
    expect(matchesAnyProjectFilter(alexProj2Task, keys)).toBe(false);
  });

  it("rejects when no key matches the task", () => {
    expect(matchesAnyProjectFilter(alexProj2Task, ["alex:1", "morgan:1"])).toBe(
      false,
    );
  });
});
