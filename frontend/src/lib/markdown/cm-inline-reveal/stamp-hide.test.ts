/**
 * Coverage for the stamp-hide CM6 extension: the provenance stamp block is
 * hidden in the editor (a block:true replace span over its full range) while the
 * underlying document keeps the text byte-for-byte, so the saved .md + exports
 * still carry the provenance.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";

import { findStampSpan, stampHideExtension } from "./stamp-hide";
import { createNewFileContent } from "@/lib/stamp-utils";

function stateFor(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown(), stampHideExtension],
  });
}

const CANONICAL_STAMP = [
  "<!-- stamp:start -->",
  "2026-02-15  ",
  "12:07 PM  ",
  "experiment: Western Blot  ",
  "project folder: Protein Research  ",
  "<!-- stamp:end -->",
  "___",
].join("\n");

describe("findStampSpan", () => {
  it("returns null when there is no stamp", () => {
    const state = stateFor("# Just a heading\n\nsome body text");
    expect(findStampSpan(state)).toBeNull();
  });

  it("spans the whole canonical stamp block + trailing rule", () => {
    const doc = `${CANONICAL_STAMP}\n\n# Lab Notes: Western Blot\n\nbody`;
    const state = stateFor(doc);
    const span = findStampSpan(state);
    expect(span).not.toBeNull();
    expect(span!.from).toBe(0);
    // The hidden span ends at/after the `___` separator and does NOT reach the
    // user heading, so the heading stays visible + editable.
    const hidden = doc.slice(span!.from, span!.to);
    expect(hidden).toContain("<!-- stamp:start -->");
    expect(hidden).toContain("<!-- stamp:end -->");
    expect(hidden).toContain("___");
    expect(hidden).not.toContain("# Lab Notes");
    expect(hidden).not.toContain("body");
  });

  it("also swallows a leftover legacy [last-access] line", () => {
    const doc = [
      CANONICAL_STAMP,
      "[last-access]: # (2026-02-15T12:07:00Z)",
      "",
      "# Lab Notes: Western Blot",
      "",
      "body",
    ].join("\n");
    const state = stateFor(doc);
    const span = findStampSpan(state)!;
    const hidden = doc.slice(span.from, span.to);
    expect(hidden).toContain("[last-access]");
    expect(hidden).not.toContain("# Lab Notes");
  });

  it("hides the stamp a fresh file from createNewFileContent ships with", () => {
    const doc = createNewFileContent("Western Blot", "Protein Research", "notes");
    const state = stateFor(doc);
    const span = findStampSpan(state);
    expect(span).not.toBeNull();
    const hidden = doc.slice(span!.from, span!.to);
    expect(hidden).toContain("<!-- stamp:start -->");
    expect(hidden).toContain("<!-- stamp:end -->");
    // The injected H1 title stays visible.
    expect(hidden).not.toContain("# Lab Notes");
  });
});

describe("document is never mutated by hiding", () => {
  it("doc.toString() equals the input byte-for-byte after building decorations", () => {
    const doc = `${CANONICAL_STAMP}\n\n# Lab Notes: Western Blot\n\nbody`;
    const state = stateFor(doc);
    // Building the StateField decorations is part of EditorState.create above.
    expect(state.doc.toString()).toBe(doc);
  });
});
