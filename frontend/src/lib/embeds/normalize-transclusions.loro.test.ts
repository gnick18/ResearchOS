// P7-2 transclusion Part B: verify the normalize transform that the normalizeRef
// dispatches in the editor. This is a pure-function test of normalizeTransclusions
// given a title->id map. The CM6 dispatch itself is browser-only, so that path is
// documented here rather than tested.
//
// The normalizeRef flow (what this test covers):
//   1. Editor reads current CM6 doc text.
//   2. Calls notesApi.list(), builds a Map<lc-title, id>.
//   3. Calls normalizeTransclusions(text, resolver).
//   4. If changed: dispatches a full-doc CM6 replace. The dispatch flows through
//      LoroSyncPlugin (Loro mode) or onChange (legacy mode). Both persist the
//      rewritten bytes before flush/write runs.
//   5. Updates lastAcceptedRef + calls onChangeRef so state stays consistent.
//   6. The existing normalizeEntryContent in notesApi.updateEntry runs again in
//      legacy mode (double-normalize is idempotent: already-normalized content
//      has no ![[]] so normalizeTransclusions returns changed=false).
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  normalizeTransclusions,
  type ResolveNoteId,
} from "./normalize-transclusions";

// A small title->id map that mirrors what normalizeRef builds from notesApi.list().
const TITLE_MAP: Record<string, string> = {
  "lysis protocol": "5",
  "intro note": "9",
};
const resolver: ResolveNoteId = (title) =>
  TITLE_MAP[title.trim().toLowerCase()] ?? null;

describe("normalizeTransclusions (normalizeRef transform, Part B)", () => {
  it("rewrites a resolved ![[Title#Heading]] to the portable embed link", () => {
    const { content, changed } = normalizeTransclusions(
      "![[Lysis Protocol#Results]]",
      resolver,
    );
    expect(changed).toBe(true);
    expect(content).toBe(
      "[Results](/notes/5#ros=transclude&section=Results)",
    );
  });

  it("leaves an unresolved ![[]] raw and sets changed=false", () => {
    const { content, changed } = normalizeTransclusions(
      "![[No Such Note#Heading]] stays raw",
      resolver,
    );
    expect(changed).toBe(false);
    expect(content).toBe("![[No Such Note#Heading]] stays raw");
  });

  it("is idempotent: a second pass on already-normalized content is a no-op", () => {
    const first = normalizeTransclusions(
      "![[Intro Note#Overview]]",
      resolver,
    );
    expect(first.changed).toBe(true);
    // Second pass: the content is now a plain link, no ![[]] present.
    const second = normalizeTransclusions(first.content, resolver);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  it("rewrites multiple transclusions in a single doc in one pass", () => {
    const src = "![[Intro Note]] and ![[Lysis Protocol#Elution]]";
    const { content, changed } = normalizeTransclusions(src, resolver);
    expect(changed).toBe(true);
    expect(content).toBe(
      "[Intro Note](/notes/9#ros=transclude) and [Elution](/notes/5#ros=transclude&section=Elution)",
    );
  });

  it("skips content with no ![[]] prefix check", () => {
    const src = "plain text with no transclusion at all";
    const { content, changed } = normalizeTransclusions(src, resolver);
    expect(changed).toBe(false);
    expect(content).toBe(src);
  });

  it("leaves a transclusion inside a fenced code block raw", () => {
    const src = ["```", "![[Lysis Protocol#X]]", "```"].join("\n");
    const { changed } = normalizeTransclusions(src, resolver);
    expect(changed).toBe(false);
  });

  it("leaves a transclusion inside inline code raw", () => {
    const src = "type `![[Lysis Protocol]]` to transclude";
    const { changed } = normalizeTransclusions(src, resolver);
    expect(changed).toBe(false);
  });
});
