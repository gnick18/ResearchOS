import { describe, it, expect } from "vitest";
import {
  encodeFilterKey,
  parseFilterKey,
  matchesProjectFilter,
  matchesMethodFilter,
  matchesAnyProjectFilter,
  narrowLabSearchByCompositeKeys,
  STANDALONE_FILTER_KEY,
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

describe("matchesAnyProjectFilter: standalone sentinel (orphan tasks)", () => {
  // Background: tasks created in the Miscellaneous / standalone slot
  // persist with project_id null (wire shape) or 0 (on-disk normalized
  // shape; see local-api.ts). A user with any specific project pill
  // selected can't see their orphan experiments because real composite
  // keys ("alex:1") never match `null`/`0`. The STANDALONE_FILTER_KEY
  // sentinel scopes the filter to the orphan bucket.
  const orphanWireTask = { owner: "alex", project_id: null };
  const orphanDiskTask = { owner: "alex", project_id: 0 };
  const realProjectTask = { owner: "alex", project_id: 1 };

  it("exposes the sentinel constant for callers (no magic strings sprinkled)", () => {
    expect(STANDALONE_FILTER_KEY).toBe("__standalone__");
  });

  it("matches orphan tasks (project_id null) when sentinel is the only key", () => {
    expect(matchesAnyProjectFilter(orphanWireTask, [STANDALONE_FILTER_KEY])).toBe(true);
  });

  it("matches orphan tasks (project_id 0, normalized on-disk shape) too", () => {
    expect(matchesAnyProjectFilter(orphanDiskTask, [STANDALONE_FILTER_KEY])).toBe(true);
  });

  it("rejects real-project tasks when sentinel is the only key", () => {
    expect(matchesAnyProjectFilter(realProjectTask, [STANDALONE_FILTER_KEY])).toBe(false);
  });

  it("composes with real-project keys via OR (the workbench multi-pill case)", () => {
    const keys = ["alex:1", STANDALONE_FILTER_KEY];
    // The orphan passes via the sentinel branch.
    expect(matchesAnyProjectFilter(orphanWireTask, keys)).toBe(true);
    // The real-project task passes via the composite key.
    expect(matchesAnyProjectFilter(realProjectTask, keys)).toBe(true);
    // A different-owner real project (morgan:1) collides with neither.
    expect(matchesAnyProjectFilter({ owner: "morgan", project_id: 2 }, keys)).toBe(false);
  });

  it("sentinel does not collide with a real owner named '__standalone__:42'", () => {
    // Defensive: composite parsing keys on the last colon, so an owner
    // literally named "__standalone__" would still produce a valid
    // "<owner>:<id>" key. The sentinel itself contains no colon, so it
    // can never be mistaken for a composite key.
    expect(parseFilterKey(STANDALONE_FILTER_KEY)).toBeNull();
  });
});

describe("narrowLabSearchByCompositeKeys: lab-mode payload disambiguation", () => {
  const baseline = ["alex", "morgan"];

  it("no composite keys -> baseline CSV passes through, ids null", () => {
    expect(
      narrowLabSearchByCompositeKeys({
        baselineUsernames: baseline,
        projectKey: null,
        methodKey: null,
      }),
    ).toEqual({ usernames: "alex,morgan", projectId: null, methodId: null });
  });

  it("empty baseline + no keys -> undefined (search all users)", () => {
    expect(
      narrowLabSearchByCompositeKeys({
        baselineUsernames: [],
        projectKey: null,
        methodKey: null,
      }),
    ).toEqual({ usernames: undefined, projectId: null, methodId: null });
  });

  it("project key narrows usernames to the owner half", () => {
    // The collision the helper exists to prevent: a bare project_id=1
    // would match alex's AND morgan's project 1. Narrowing usernames to
    // "alex" restricts the per-user iteration to the right namespace.
    const out = narrowLabSearchByCompositeKeys({
      baselineUsernames: baseline,
      projectKey: "alex:1",
      methodKey: null,
    });
    expect(out).toEqual({ usernames: "alex", projectId: 1, methodId: null });
  });

  it("method key narrows usernames to the owner half", () => {
    const out = narrowLabSearchByCompositeKeys({
      baselineUsernames: baseline,
      projectKey: null,
      methodKey: "morgan:2",
    });
    expect(out).toEqual({ usernames: "morgan", projectId: null, methodId: 2 });
  });

  it("public-marker method does NOT narrow", () => {
    // Public marketplace methods live across every user's task
    // method_ids, so the "public" username is a marker, not a real user.
    // Narrowing to it would yield an empty target list.
    const out = narrowLabSearchByCompositeKeys({
      baselineUsernames: baseline,
      projectKey: null,
      methodKey: "public:5",
    });
    expect(out).toEqual({
      usernames: "alex,morgan",
      projectId: null,
      methodId: 5,
    });
  });

  it("project key wins over method key when both are set", () => {
    // Cross-owner combos are pathological; project is the broader,
    // more-anchored filter so it wins the narrowing race.
    const out = narrowLabSearchByCompositeKeys({
      baselineUsernames: baseline,
      projectKey: "alex:1",
      methodKey: "morgan:2",
    });
    expect(out).toEqual({ usernames: "alex", projectId: 1, methodId: 2 });
  });

  it("respects a custom publicMarker", () => {
    const out = narrowLabSearchByCompositeKeys({
      baselineUsernames: baseline,
      projectKey: null,
      methodKey: "shared:9",
      publicMarker: "shared",
    });
    expect(out.usernames).toBe("alex,morgan");
    expect(out.methodId).toBe(9);
  });

  it("malformed keys fall through to baseline (no narrowing, no ids)", () => {
    const out = narrowLabSearchByCompositeKeys({
      baselineUsernames: baseline,
      projectKey: "garbage",
      methodKey: "",
    });
    expect(out).toEqual({
      usernames: "alex,morgan",
      projectId: null,
      methodId: null,
    });
  });
});
