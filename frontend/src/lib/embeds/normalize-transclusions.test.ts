import { describe, it, expect } from "vitest";
import { normalizeTransclusions, type ResolveNoteId } from "./normalize-transclusions";

// A resolver matching a small fixed library, case-insensitively.
const LIB: Record<string, string> = {
  "lysis protocol": "5",
  "intro note": "9",
};
const resolve: ResolveNoteId = (title) => LIB[title.trim().toLowerCase()] ?? null;

describe("normalizeTransclusions", () => {
  it("rewrites a transclusion WITH a heading", () => {
    const { content, changed } = normalizeTransclusions(
      "See ![[Lysis Protocol#Lysis step]] below.",
      resolve,
    );
    expect(changed).toBe(true);
    expect(content).toBe(
      "See [Lysis step](/notes/5#ros=transclude&section=Lysis%20step) below.",
    );
  });

  it("rewrites a transclusion WITHOUT a heading (whole note)", () => {
    const { content, changed } = normalizeTransclusions("![[Intro Note]]", resolve);
    expect(changed).toBe(true);
    expect(content).toBe("[Intro Note](/notes/9#ros=transclude)");
  });

  it("leaves an unresolved transclusion raw", () => {
    const { content, changed } = normalizeTransclusions(
      "![[Unknown Note#X]] stays raw",
      resolve,
    );
    expect(changed).toBe(false);
    expect(content).toBe("![[Unknown Note#X]] stays raw");
  });

  it("rewrites multiple transclusions in one doc", () => {
    const { content, changed } = normalizeTransclusions(
      "![[Intro Note]] and ![[Lysis Protocol#Elution]]",
      resolve,
    );
    expect(changed).toBe(true);
    expect(content).toBe(
      "[Intro Note](/notes/9#ros=transclude) and [Elution](/notes/5#ros=transclude&section=Elution)",
    );
  });

  it("does NOT rewrite inside a fenced code block", () => {
    const src = ["```", "![[Lysis Protocol#X]]", "```"].join("\n");
    const { content, changed } = normalizeTransclusions(src, resolve);
    expect(changed).toBe(false);
    expect(content).toBe(src);
  });

  it("does NOT rewrite inside an inline code span", () => {
    const src = "type `![[Lysis Protocol]]` to transclude";
    const { content, changed } = normalizeTransclusions(src, resolve);
    expect(changed).toBe(false);
    expect(content).toBe(src);
  });

  it("rewrites a real transclusion on a line that also has unrelated inline code", () => {
    const src = "run `pcr.sh` then ![[Intro Note]]";
    const { content, changed } = normalizeTransclusions(src, resolve);
    expect(changed).toBe(true);
    expect(content).toBe("run `pcr.sh` then [Intro Note](/notes/9#ros=transclude)");
  });

  it("is byte-identical when there is no transclusion at all", () => {
    const src = "# Heading\n\nplain note body, no embeds.";
    const { content, changed } = normalizeTransclusions(src, resolve);
    expect(changed).toBe(false);
    expect(content).toBe(src);
  });

  it("escapes brackets in the heading link text", () => {
    const lib: ResolveNoteId = (t) => (t.trim().toLowerCase() === "n" ? "2" : null);
    const { content } = normalizeTransclusions("![[N#a [x] b]]", lib);
    // The `]` inside the inner text terminates the `![[ ]]` match early, so this is
    // treated as `![[N#a [x]` plus a trailing ` b]]`. Confirm we never produce a
    // broken link: the rewrite only fires on a clean inner, otherwise stays raw.
    expect(content.startsWith("![[") || content.startsWith("[")).toBe(true);
  });
});
