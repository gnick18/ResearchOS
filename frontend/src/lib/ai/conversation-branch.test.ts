// Unit tests for the BeakerBot conversation branching engine (BeakerAI lane, 2026-06-16).

import { describe, it, expect } from "vitest";
import {
  emptyBranchTree,
  fromLinear,
  activePath,
  activePathIds,
  appendToActive,
  forkAt,
  branchesAt,
  switchBranch,
  activeHistoryLen,
  hasAnyBranch,
} from "./conversation-branch";
import type { ChatMessage } from "./conversation-store";

function msg(id: string, role: ChatMessage["role"] = "user", content = id): ChatMessage {
  return { id, role, content };
}

/** Build the canonical linear chat: u1 -> a1 -> u2 -> a2. */
function linear(): ChatMessage[] {
  return [msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user"), msg("a2", "assistant")];
}

describe("fromLinear + activePath", () => {
  it("round-trips a linear conversation", () => {
    const tree = fromLinear(linear());
    expect(activePathIds(tree)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(tree.rootId).toBe("u1");
    expect(tree.activeLeafId).toBe("a2");
  });

  it("is empty for no messages", () => {
    const tree = fromLinear([]);
    expect(tree).toEqual(emptyBranchTree());
    expect(activePath(tree)).toEqual([]);
  });
});

describe("appendToActive", () => {
  it("extends the active path and moves the leaf", () => {
    let tree = emptyBranchTree();
    tree = appendToActive(tree, msg("u1", "user"));
    tree = appendToActive(tree, msg("a1", "assistant"));
    expect(activePathIds(tree)).toEqual(["u1", "a1"]);
    expect(tree.rootId).toBe("u1");
    expect(tree.activeLeafId).toBe("a1");
  });

  it("does not mutate the input tree (pure)", () => {
    const tree = fromLinear(linear());
    const before = activePathIds(tree);
    appendToActive(tree, msg("x", "user"));
    expect(activePathIds(tree)).toEqual(before);
  });
});

describe("forkAt", () => {
  it("adds an alternate sibling and makes it active, preserving the original branch", () => {
    let tree = fromLinear(linear()); // u1 a1 u2 a2
    // Edit-and-resend at u2: fork an alternate user turn u2b.
    tree = forkAt(tree, "u2", msg("u2b", "user", "edited"));
    // The active path now goes u1 -> a1 -> u2b (the original u2/a2 still exist).
    expect(activePathIds(tree)).toEqual(["u1", "a1", "u2b"]);
    // The original branch is preserved in the tree.
    expect(tree.nodes["u2"]).toBeTruthy();
    expect(tree.nodes["a2"]).toBeTruthy();
    // u2 and u2b are siblings (both children of a1).
    expect(tree.nodes["a1"].childIds).toEqual(["u2", "u2b"]);
  });

  it("returns the tree unchanged for an unknown message", () => {
    const tree = fromLinear(linear());
    expect(forkAt(tree, "nope", msg("z"))).toBe(tree);
  });

  it("continuations append under the new branch", () => {
    let tree = fromLinear(linear());
    tree = forkAt(tree, "u2", msg("u2b", "user"));
    tree = appendToActive(tree, msg("a2b", "assistant"));
    expect(activePathIds(tree)).toEqual(["u1", "a1", "u2b", "a2b"]);
  });
});

describe("branchesAt + switchBranch", () => {
  it("reports the siblings and active index at a fork", () => {
    let tree = fromLinear(linear());
    tree = forkAt(tree, "u2", msg("u2b", "user"));
    tree = appendToActive(tree, msg("a2b", "assistant"));

    const b = branchesAt(tree, "u2");
    expect(b.ids).toEqual(["u2", "u2b"]);
    expect(b.total).toBe(2);
    expect(b.activeIndex).toBe(1); // u2b branch is active
  });

  it("switches back to the original branch and lands on its tip", () => {
    let tree = fromLinear(linear());
    tree = forkAt(tree, "u2", msg("u2b", "user"));
    tree = appendToActive(tree, msg("a2b", "assistant"));

    tree = switchBranch(tree, "u2");
    // Following u2 down to its tip (a2) restores the original continuation.
    expect(activePathIds(tree)).toEqual(["u1", "a1", "u2", "a2"]);

    const b = branchesAt(tree, "u2");
    expect(b.activeIndex).toBe(0);
  });

  it("reports total 1 for a non-forked message", () => {
    const tree = fromLinear(linear());
    expect(branchesAt(tree, "u2").total).toBe(1);
  });

  it("switchBranch follows the LAST child at each step (most recent continuation)", () => {
    let tree = fromLinear([msg("u1", "user")]);
    // Two assistant replies forked under u1: a1, then a1b (regenerate-as-branch).
    tree = appendToActive(tree, msg("a1", "assistant"));
    tree = forkAt(tree, "a1", msg("a1b", "assistant"));
    // Switching to u1 follows the last child -> a1b.
    tree = switchBranch(tree, "u1");
    expect(activePathIds(tree)).toEqual(["u1", "a1b"]);
  });
});

describe("hasAnyBranch + activeHistoryLen", () => {
  it("is false for a plain linear chat and true after a fork", () => {
    let tree = fromLinear(linear());
    expect(hasAnyBranch(tree)).toBe(false);
    tree = forkAt(tree, "u2", msg("u2b", "user"));
    expect(hasAnyBranch(tree)).toBe(true);
  });

  it("carries the history length of the active leaf", () => {
    let tree = emptyBranchTree();
    tree = appendToActive(tree, msg("u1", "user"), 1);
    tree = appendToActive(tree, msg("a1", "assistant"), 3);
    expect(activeHistoryLen(tree)).toBe(3);
    tree = appendToActive(tree, msg("u2", "user")); // no historyLen
    expect(activeHistoryLen(tree)).toBeNull();
  });
});
