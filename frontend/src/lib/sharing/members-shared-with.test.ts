// Notebooks generalization (notebooks-gen Phase 1, 2026-06-06). Pure-function
// coverage for `membersSharedWith` (the 1..N generalization of
// `pairingSharedWith`) and for `normalizeNotebookRecord` (the lazy on-read
// coercion of the legacy `[string, string]` tuple to `string[]`). No file
// system: this asserts the SHAPE the helpers produce.

import { describe, expect, it } from "vitest";
import {
  membersSharedWith,
  pairingSharedWith,
  canRead,
  canWrite,
  NEVER_UNLOCKED,
  type Viewer,
} from "./unified";
import { normalizeNotebookRecord } from "../shared-notebooks/store";
import type { Notebook } from "../types";

const member = (username: string): Viewer => ({
  username,
  account_type: "lab",
});

describe("membersSharedWith", () => {
  it("a single-member (private) notebook yields an owner-only list", () => {
    expect(membersSharedWith(["owner"])).toEqual([
      { username: "owner", level: "edit" },
    ]);
  });

  it("three members all land at level edit", () => {
    expect(membersSharedWith(["a", "b", "c"])).toEqual([
      { username: "a", level: "edit" },
      { username: "b", level: "edit" },
      { username: "c", level: "edit" },
    ]);
  });

  it("deduplicates repeated usernames to a single entry", () => {
    expect(membersSharedWith(["a", "b", "a"])).toEqual([
      { username: "a", level: "edit" },
      { username: "b", level: "edit" },
    ]);
  });

  it("skips empty / non-string usernames defensively", () => {
    expect(
      membersSharedWith(["a", "", undefined as unknown as string, "b"]),
    ).toEqual([
      { username: "a", level: "edit" },
      { username: "b", level: "edit" },
    ]);
  });

  it("pairingSharedWith is a thin two-member wrapper", () => {
    expect(pairingSharedWith("pi", "student")).toEqual(
      membersSharedWith(["pi", "student"]),
    );
  });
});

describe("membersSharedWith feeds the unified read/write gates", () => {
  it("a private notebook is readable/writable only by its owner", () => {
    const record = {
      owner: "owner",
      shared_with: membersSharedWith(["owner"]),
    };
    expect(canRead(record, member("owner"))).toBe(true);
    expect(canWrite(record, member("owner"), NEVER_UNLOCKED)).toBe(true);
    expect(canRead(record, member("other"))).toBe(false);
    expect(canWrite(record, member("other"), NEVER_UNLOCKED)).toBe(false);
  });

  it("every member of an N-member notebook can read and write", () => {
    const record = {
      owner: "a",
      shared_with: membersSharedWith(["a", "b", "c"]),
    };
    for (const u of ["a", "b", "c"]) {
      expect(canRead(record, member(u))).toBe(true);
      expect(canWrite(record, member(u), NEVER_UNLOCKED)).toBe(true);
    }
    expect(canRead(record, member("d"))).toBe(false);
  });
});

describe("normalizeNotebookRecord", () => {
  const base = {
    id: "nb-1",
    created_by: "a",
    created_at: "2026-06-06T00:00:00.000Z",
    owner: "a",
    shared_with: [],
  };

  it("coerces a legacy [string, string] tuple to string[]", () => {
    const legacy = {
      ...base,
      members: ["a", "b"] as [string, string],
    } as unknown as Notebook;
    const out = normalizeNotebookRecord(legacy);
    expect(out.members).toEqual(["a", "b"]);
    expect(Array.isArray(out.members)).toBe(true);
  });

  it("passes a single-member array through unchanged", () => {
    const rec = { ...base, members: ["a"] } as Notebook;
    expect(normalizeNotebookRecord(rec).members).toEqual(["a"]);
  });

  it("passes an N-member array through", () => {
    const rec = { ...base, members: ["a", "b", "c"] } as Notebook;
    expect(normalizeNotebookRecord(rec).members).toEqual(["a", "b", "c"]);
  });

  it("drops empty / non-string members and dedupes", () => {
    const rec = {
      ...base,
      members: ["a", "", "a", "b"],
    } as unknown as Notebook;
    expect(normalizeNotebookRecord(rec).members).toEqual(["a", "b"]);
  });

  it("tolerates a missing members field (defensive)", () => {
    const rec = { ...base } as unknown as Notebook;
    expect(normalizeNotebookRecord(rec).members).toEqual([]);
  });
});
