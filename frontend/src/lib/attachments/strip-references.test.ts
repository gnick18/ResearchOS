// frontend/src/lib/attachments/strip-references.test.ts
//
// Story: a user inserts an image or file inline into a notes.md / results.md
// markdown body, then deletes the underlying file via drag-to-trash. The
// trash drop-zones call `stripAttachmentReferences` against the active
// editor's value so the inline ref disappears together with the file —
// no broken-image popup, no manual cleanup.
//
// These tests pin the helper's contract: which markdown shapes it removes,
// which it leaves alone, and how it handles URL-encoded filenames.

import { describe, expect, it } from "vitest";
import { stripAttachmentReferences } from "./strip-references";

describe("stripAttachmentReferences", () => {
  it("removes a markdown image ref", () => {
    const md = "Before\n\n![alt](Images/foo.png)\n\nAfter";
    const out = stripAttachmentReferences(md, "foo.png", "Images");
    expect(out).not.toContain("foo.png");
    expect(out).toContain("Before");
    expect(out).toContain("After");
  });

  it("removes a markdown file link", () => {
    const md = "See the writeup: [doc](Files/bar.pdf) for details.";
    const out = stripAttachmentReferences(md, "bar.pdf", "Files");
    expect(out).not.toContain("bar.pdf");
    expect(out).toContain("See the writeup:");
    expect(out).toContain("for details.");
  });

  it("removes a ref whose filename was URL-encoded in the markdown", () => {
    // Filenames with spaces land as `Files/READ%20ME.md` once the editor
    // percent-encodes the URL portion of the markdown link. The helper
    // accepts the *decoded* user-facing filename and matches both forms.
    const md = "Spec: [link](Files/READ%20ME.md)";
    const out = stripAttachmentReferences(md, "READ ME.md", "Files");
    expect(out).not.toContain("READ%20ME.md");
    expect(out).toContain("Spec:");
  });

  it("removes every occurrence when the same ref appears multiple times", () => {
    const md =
      "![one](Images/dup.png) text ![two](Images/dup.png) more ![three](Images/dup.png) end";
    const out = stripAttachmentReferences(md, "dup.png", "Images");
    expect(out).not.toContain("dup.png");
    expect(out).toContain("text");
    expect(out).toContain("more");
    expect(out).toContain("end");
  });

  it("is a no-op when the named ref is absent", () => {
    const md = "# Heading\n\nUnrelated body text — no attachments here.";
    const out = stripAttachmentReferences(md, "ghost.png", "Images");
    expect(out).toBe(md);
  });

  it("strips matching refs across both notes.md and results.md buffers", () => {
    // The helper operates on a single string; per-tab isolation since
    // 1613be79 means each tab owns its own markdown body. Verifying both
    // sides here pins the call-pattern: any caller that hosts two
    // editor surfaces (per-tab) can strip both by calling the helper
    // twice, once per buffer.
    const notes = "Notes body with ![cap](Images/shared.png) inline.";
    const results = "Results body with ![cap](Images/shared.png) inline.";
    const strippedNotes = stripAttachmentReferences(notes, "shared.png", "Images");
    const strippedResults = stripAttachmentReferences(results, "shared.png", "Images");
    expect(strippedNotes).not.toContain("shared.png");
    expect(strippedResults).not.toContain("shared.png");
    expect(strippedNotes).toContain("Notes body");
    expect(strippedResults).toContain("Results body");
  });

  it("preserves surrounding markdown unchanged", () => {
    const md = [
      "# Heading",
      "",
      "Paragraph one with **bold** and a [keepme](Files/keep.pdf) link.",
      "",
      "![drop](Images/drop.png)",
      "",
      "Paragraph two ends here.",
    ].join("\n");
    const out = stripAttachmentReferences(md, "drop.png", "Images");
    expect(out).toContain("# Heading");
    expect(out).toContain("Paragraph one with **bold** and a [keepme](Files/keep.pdf) link.");
    expect(out).toContain("Paragraph two ends here.");
    expect(out).not.toContain("drop.png");
    // The unrelated File link must survive an Images-side strip.
    expect(out).toContain("keep.pdf");
  });

  it("removes HTML <img> tags whose src points at Images/<filename>", () => {
    const md = 'Body <img src="Images/inline.png" alt="x"> end';
    const out = stripAttachmentReferences(md, "inline.png", "Images");
    expect(out).not.toContain("inline.png");
    expect(out).toContain("Body");
    expect(out).toContain("end");
  });

  it("removes HTML <a> tags whose href points at Files/<filename>", () => {
    const md = 'See <a href="Files/spec.pdf">the spec</a> please';
    const out = stripAttachmentReferences(md, "spec.pdf", "Files");
    expect(out).not.toContain("spec.pdf");
    expect(out).toContain("See");
    expect(out).toContain("please");
  });

  it("Files-side strip never removes an image ref that happens to share the stem", () => {
    // Guard against the negative-lookbehind regression — file delete
    // must leave `![alt](Images/foo.png)` alone.
    const md = "![pic](Images/foo.png) and [doc](Files/foo.png)";
    const out = stripAttachmentReferences(md, "foo.png", "Files");
    expect(out).toContain("![pic](Images/foo.png)");
    expect(out).not.toContain("[doc](Files/foo.png)");
  });
});
