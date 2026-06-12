import { describe, it, expect } from "vitest";
import {
  extractMarkdownSection,
  extractNoteSection,
  listSectionHeadings,
} from "./markdown-section";
import type { Note } from "@/lib/types";

const DOC = [
  "# Intro",
  "intro text",
  "",
  "## Lysis step",
  "Add 200 uL buffer.",
  "",
  "### Sub detail",
  "vortex 10s",
  "",
  "## Elution",
  "elute in 50 uL",
  "",
  "# Conclusion",
  "done",
].join("\n");

describe("extractMarkdownSection", () => {
  it("returns the section body up to the next same-level heading", () => {
    const out = extractMarkdownSection(DOC, "Lysis step");
    expect(out).toContain("Add 200 uL buffer.");
    // The nested subheading is INCLUDED in the section.
    expect(out).toContain("### Sub detail");
    expect(out).toContain("vortex 10s");
    // The sibling "## Elution" ends it.
    expect(out).not.toContain("elute in 50 uL");
  });

  it("a sibling heading stops the section", () => {
    const out = extractMarkdownSection(DOC, "Elution");
    expect(out).toBe("elute in 50 uL");
  });

  it("matches case-insensitively and trimmed", () => {
    expect(extractMarkdownSection(DOC, "  lYsIs StEp  ")).toContain(
      "Add 200 uL buffer.",
    );
  });

  it("the last section runs to end of document", () => {
    expect(extractMarkdownSection(DOC, "Conclusion")).toBe("done");
  });

  it("a top-level heading section includes its subsections", () => {
    const out = extractMarkdownSection(DOC, "Intro");
    expect(out).toContain("intro text");
    expect(out).toContain("## Lysis step");
    // The next H1 ends it.
    expect(out).not.toContain("done");
  });

  it("returns null when no heading matches", () => {
    expect(extractMarkdownSection(DOC, "Nope")).toBeNull();
  });

  it("returns null for an empty heading", () => {
    expect(extractMarkdownSection(DOC, "")).toBeNull();
    expect(extractMarkdownSection(DOC, "   ")).toBeNull();
  });

  it("returns the FIRST match on duplicate headings", () => {
    const dup = ["## A", "first", "## A", "second"].join("\n");
    expect(extractMarkdownSection(dup, "A")).toBe("first");
  });

  it("ignores a `#` that is inside a fenced code block", () => {
    const fenced = [
      "## Real",
      "real body",
      "```",
      "# not a heading",
      "```",
      "more body",
      "## Next",
      "next body",
    ].join("\n");
    const out = extractMarkdownSection(fenced, "Real");
    expect(out).toContain("real body");
    expect(out).toContain("# not a heading");
    expect(out).toContain("more body");
    expect(out).not.toContain("next body");
    // And the fake heading is not listable.
    expect(extractMarkdownSection(fenced, "not a heading")).toBeNull();
  });
});

describe("listSectionHeadings", () => {
  it("lists every ATX heading with its level, skipping fenced code", () => {
    const headings = listSectionHeadings(DOC);
    expect(headings).toEqual([
      { level: 1, text: "Intro" },
      { level: 2, text: "Lysis step" },
      { level: 3, text: "Sub detail" },
      { level: 2, text: "Elution" },
      { level: 1, text: "Conclusion" },
    ]);
  });

  it("does not list headings inside a fence", () => {
    const fenced = ["# A", "```", "# B", "```", "# C"].join("\n");
    expect(listSectionHeadings(fenced)).toEqual([
      { level: 1, text: "A" },
      { level: 1, text: "C" },
    ]);
  });
});

function makeNote(entries: Array<{ title: string; content: string }>): Note {
  return {
    id: 1,
    title: "Protocol",
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: entries.map((e, i) => ({
      id: `e${i}`,
      title: e.title,
      date: "2026-06-12",
      content: e.content,
      created_at: "2026-06-12T00:00:00Z",
      updated_at: "2026-06-12T00:00:00Z",
    })),
    updated_at: "2026-06-12T00:00:00Z",
    username: "alex",
  } as Note;
}

describe("extractNoteSection", () => {
  it("matches an ENTRY title first, returning the entry content", () => {
    const note = makeNote([
      { title: "Day 1", content: "## Lysis step\nbuffer" },
      { title: "Lysis step", content: "this is the entry body" },
    ]);
    // Entry-title match wins over the heading match in the first entry.
    expect(extractNoteSection(note, "Lysis step")).toBe("this is the entry body");
  });

  it("falls back to a heading match across entries (first hit wins)", () => {
    const note = makeNote([
      { title: "Day 1", content: "## Intro\nhello" },
      { title: "Day 2", content: "## Lysis step\nbuffer line" },
    ]);
    expect(extractNoteSection(note, "Lysis step")).toBe("buffer line");
  });

  it("returns the whole note body when the heading is empty", () => {
    const note = makeNote([
      { title: "Day 1", content: "first entry" },
      { title: "Day 2", content: "second entry" },
    ]);
    const out = extractNoteSection(note, "");
    expect(out).toContain("first entry");
    expect(out).toContain("second entry");
  });

  it("returns null when no entry title or heading matches", () => {
    const note = makeNote([{ title: "Day 1", content: "## A\nbody" }]);
    expect(extractNoteSection(note, "Missing")).toBeNull();
  });

  it("returns null for an empty-heading whole-note when there is no content", () => {
    const note = makeNote([{ title: "Day 1", content: "" }]);
    expect(extractNoteSection(note, "")).toBeNull();
  });
});
