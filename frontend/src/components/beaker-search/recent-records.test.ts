// sequence editor master (chunk 4). Unit tests for the PURE Recent-records MRU
// brain (recent-records.ts). No React, no localStorage, no DOM. Mirrors the test
// posture of global-source.test.ts and global-index.test.ts.
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence
// colons.

import { describe, it, expect } from "vitest";
import type { GlobalIndexEntry } from "./global-index";
import {
  RECENT_RECORDS_CAP,
  parseRecentRefs,
  pushRecentRef,
  resolveRecentRefs,
  type RecentRef,
} from "./recent-records";

/** A minimal live index entry for the resolve tests. */
function entry(over: Partial<GlobalIndexEntry> = {}): GlobalIndexEntry {
  return {
    type: "task",
    key: "self:1",
    label: "A task",
    meta: "Experiment in Project",
    haystack: "a task",
    recencyAt: 0,
    iconName: "list",
    href: "/?openTask=self%3A1",
    enabled: true,
    ...over,
  };
}

describe("pushRecentRef", () => {
  it("prepends the just-opened ref", () => {
    const out = pushRecentRef([{ type: "task", key: "self:1" }], {
      type: "project",
      key: "morgan:7",
    });
    expect(out[0]).toEqual({ type: "project", key: "morgan:7" });
    expect(out).toHaveLength(2);
  });

  it("promotes a re-opened ref to the front without duplicating it", () => {
    const list: RecentRef[] = [
      { type: "task", key: "self:2" },
      { type: "task", key: "self:1" },
    ];
    const out = pushRecentRef(list, { type: "task", key: "self:1" });
    expect(out).toEqual([
      { type: "task", key: "self:1" },
      { type: "task", key: "self:2" },
    ]);
  });

  it("distinguishes the same numeric key across types", () => {
    const out = pushRecentRef([{ type: "task", key: "self:1" }], {
      type: "sequence",
      key: "self:1",
    });
    expect(out).toHaveLength(2);
  });

  it("caps the list at the cap, dropping the oldest", () => {
    let list: RecentRef[] = [];
    for (let i = 0; i < RECENT_RECORDS_CAP + 3; i += 1) {
      list = pushRecentRef(list, { type: "task", key: `self:${i}` });
    }
    expect(list).toHaveLength(RECENT_RECORDS_CAP);
    // The most recent push leads; the three oldest fell off.
    expect(list[0].key).toBe(`self:${RECENT_RECORDS_CAP + 2}`);
  });

  it("does not mutate the input list", () => {
    const list: RecentRef[] = [{ type: "task", key: "self:1" }];
    pushRecentRef(list, { type: "task", key: "self:2" });
    expect(list).toEqual([{ type: "task", key: "self:1" }]);
  });
});

describe("resolveRecentRefs", () => {
  it("maps refs to live entries in MRU order", () => {
    const index = [
      entry({ type: "task", key: "self:1", label: "First" }),
      entry({ type: "project", key: "morgan:7", label: "Second" }),
    ];
    const refs: RecentRef[] = [
      { type: "project", key: "morgan:7" },
      { type: "task", key: "self:1" },
    ];
    expect(resolveRecentRefs(refs, index).map((e) => e.label)).toEqual([
      "Second",
      "First",
    ]);
  });

  it("drops a ref no longer in the index (deleted, unshared, or not yet loaded)", () => {
    const index = [entry({ type: "task", key: "self:1" })];
    const refs: RecentRef[] = [
      { type: "task", key: "self:1" },
      { type: "task", key: "self:999" },
    ];
    const out = resolveRecentRefs(refs, index);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("self:1");
  });

  it("returns an empty list when nothing resolves", () => {
    expect(resolveRecentRefs([{ type: "task", key: "self:1" }], [])).toEqual([]);
  });
});

describe("parseRecentRefs", () => {
  it("parses a well-formed blob", () => {
    const raw = JSON.stringify([
      { type: "task", key: "self:1" },
      { type: "method", key: "public:3" },
    ]);
    expect(parseRecentRefs(raw)).toEqual([
      { type: "task", key: "self:1" },
      { type: "method", key: "public:3" },
    ]);
  });

  it("returns an empty list for null, junk, or a non-array", () => {
    expect(parseRecentRefs(null)).toEqual([]);
    expect(parseRecentRefs("not json")).toEqual([]);
    expect(parseRecentRefs(JSON.stringify({ nope: true }))).toEqual([]);
  });

  it("filters out malformed or unknown-type entries", () => {
    const raw = JSON.stringify([
      { type: "task", key: "self:1" },
      { type: "bogus", key: "x:1" },
      { type: "project" },
      { key: "no-type" },
      42,
    ]);
    expect(parseRecentRefs(raw)).toEqual([{ type: "task", key: "self:1" }]);
  });
});
