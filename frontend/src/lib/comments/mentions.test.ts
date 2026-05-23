// Lab Head Phase 2 — unit tests for the @-mention parser + reply tree.
// (lab head Phase 2 manager, 2026-05-23)
//
// Covers the edge cases that drove the parser design:
//   - email addresses don't trigger mentions
//   - dedup keeps document order
//   - tokenizer reproduces the original text losslessly
//   - reply-of-reply gets promoted to root's first-level child (1-deep cap)
//   - orphan replies (parent deleted) get promoted to roots

import { describe, expect, it } from "vitest";
import {
  buildCommentTree,
  commentPreview,
  extractMentions,
  tokenizeComment,
} from "./mentions";
import type { NoteComment } from "@/lib/types";

describe("extractMentions", () => {
  it("returns mentioned usernames in document order", () => {
    expect(extractMentions("hi @alex, ping @morgan later")).toEqual([
      "alex",
      "morgan",
    ]);
  });

  it("dedupes duplicates, keeping first occurrence", () => {
    expect(extractMentions("@alex and @alex again @morgan")).toEqual([
      "alex",
      "morgan",
    ]);
  });

  it("does not treat email addresses as mentions", () => {
    // The `@` in `alex@example.com` is preceded by a username character,
    // so the lookbehind kicks the parser out.
    expect(extractMentions("send to alex@example.com tomorrow")).toEqual([]);
  });

  it("treats a mention at the start of the string as valid", () => {
    expect(extractMentions("@alex check this")).toEqual(["alex"]);
  });

  it("treats punctuation before the @ as a valid prefix", () => {
    expect(extractMentions("(see @alex), also @morgan!")).toEqual([
      "alex",
      "morgan",
    ]);
  });
});

describe("tokenizeComment", () => {
  it("alternates text + mention spans", () => {
    expect(tokenizeComment("hi @alex, see @morgan's note")).toEqual([
      { kind: "text", value: "hi " },
      { kind: "mention", value: "alex" },
      { kind: "text", value: ", see " },
      { kind: "mention", value: "morgan" },
      { kind: "text", value: "'s note" },
    ]);
  });

  it("leaves plain text untouched when no mentions are present", () => {
    expect(tokenizeComment("no mentions here")).toEqual([
      { kind: "text", value: "no mentions here" },
    ]);
  });
});

describe("buildCommentTree", () => {
  const baseComment = (overrides: Partial<NoteComment>): NoteComment => ({
    id: "c1",
    author: "alex",
    text: "hi",
    created_at: "2026-05-13T10:00:00Z",
    ...overrides,
  });

  it("separates roots from replies", () => {
    const comments = [
      baseComment({ id: "root1", created_at: "2026-05-13T10:00:00Z" }),
      baseComment({
        id: "reply1",
        parent_id: "root1",
        created_at: "2026-05-13T10:30:00Z",
      }),
      baseComment({ id: "root2", created_at: "2026-05-13T11:00:00Z" }),
    ];
    const tree = buildCommentTree(comments);
    expect(tree.roots.map((c) => c.id)).toEqual(["root1", "root2"]);
    expect(tree.repliesByParent.get("root1")?.map((c) => c.id)).toEqual([
      "reply1",
    ]);
  });

  it("flattens reply-of-reply to the root level (1-deep cap)", () => {
    const comments = [
      baseComment({ id: "root1" }),
      baseComment({ id: "reply1", parent_id: "root1" }),
      // grandchild — should be promoted to a child of root1 (the nearest
      // top-level ancestor), not stay nested under reply1.
      baseComment({ id: "grand1", parent_id: "reply1" }),
    ];
    const tree = buildCommentTree(comments);
    expect(tree.roots.map((c) => c.id)).toEqual(["root1"]);
    expect(
      tree.repliesByParent.get("root1")?.map((c) => c.id).sort(),
    ).toEqual(["grand1", "reply1"]);
  });

  it("promotes orphan replies (missing parent) to roots", () => {
    const comments = [
      baseComment({ id: "orphan", parent_id: "missing-id" }),
      baseComment({ id: "root1" }),
    ];
    const tree = buildCommentTree(comments);
    expect(tree.roots.map((c) => c.id).sort()).toEqual(["orphan", "root1"]);
  });
});

describe("commentPreview", () => {
  it("collapses whitespace + trims", () => {
    expect(commentPreview("  hello\n\nworld   ")).toBe("hello world");
  });

  it("truncates at the configured max with an ellipsis", () => {
    const long = "a".repeat(150);
    expect(commentPreview(long, 50)).toBe("a".repeat(49) + "…");
  });
});
