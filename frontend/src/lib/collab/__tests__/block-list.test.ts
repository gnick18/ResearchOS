// External-collab chunk 5 unit tests: the recipient's local sender block list.
//
// Asserts that blocking a sender filters their items, that the filter is
// case/format-insensitive (canonical email), that unblock reverses it, and that
// "report" maps to block. Runs in the node env (no localStorage); the module
// falls back to its in-memory cache there, which is exactly what the filter
// behavior depends on within a session.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, beforeEach } from "vitest";

import {
  blockSender,
  unblockSender,
  reportSender,
  isBlocked,
  listBlocked,
  filterBlocked,
  _resetBlockListCache,
} from "../client/block-list";

interface Item {
  id: string;
  fromEmail: string | null;
}

const items: Item[] = [
  { id: "a", fromEmail: "Alice@Lab.EDU" },
  { id: "b", fromEmail: "bob@other.org" },
  { id: "c", fromEmail: null },
];

describe("block-list", () => {
  beforeEach(() => {
    _resetBlockListCache();
  });

  it("an empty block list filters nothing", () => {
    expect(filterBlocked(items, (i) => i.fromEmail)).toHaveLength(3);
  });

  it("blocking a sender hides their items (canonical, case-insensitive)", () => {
    // Block with a different casing than the stored item to prove canonicalization.
    blockSender("alice@lab.edu");
    expect(isBlocked("ALICE@LAB.EDU")).toBe(true);
    const visible = filterBlocked(items, (i) => i.fromEmail);
    expect(visible.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("a null sender email is never blocked (cannot be identified)", () => {
    blockSender("alice@lab.edu");
    expect(isBlocked(null)).toBe(false);
    // The null-sender item still passes the filter.
    const visible = filterBlocked(items, (i) => i.fromEmail);
    expect(visible.some((i) => i.id === "c")).toBe(true);
  });

  it("unblock reverses the block", () => {
    blockSender("bob@other.org");
    expect(isBlocked("bob@other.org")).toBe(true);
    unblockSender("bob@other.org");
    expect(isBlocked("bob@other.org")).toBe(false);
    expect(filterBlocked(items, (i) => i.fromEmail)).toHaveLength(3);
  });

  it("report maps to block (no server moderation backend)", () => {
    reportSender("bob@other.org");
    expect(isBlocked("bob@other.org")).toBe(true);
    expect(listBlocked()).toContain("bob@other.org");
  });

  it("block is idempotent", () => {
    blockSender("alice@lab.edu");
    blockSender("alice@lab.edu");
    expect(listBlocked()).toEqual(["alice@lab.edu"]);
  });
});
