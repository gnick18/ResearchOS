// search_note_bodies tests (ai summary-robustness bot, 2026-06-14).
//
// Pure helpers (noteBodyText / findInBody / snippetAround) + the tool execute,
// stubbing the listNotes dep so no real folder is involved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchNoteBodiesDeps,
  searchNoteBodiesTool,
  noteBodyText,
  findInBody,
  snippetAround,
} from "../tools/search-note-bodies";
import type { Note } from "@/lib/types";

const note = (over: Partial<Note> = {}) =>
  ({
    id: 1,
    title: "Gel run",
    description: "",
    entries: [],
    ...over,
  }) as Note;

const withEntry = (id: number, title: string, content: string, entryTitle = "Day 1") =>
  note({
    id,
    title,
    entries: [
      { id: "e1", title: entryTitle, date: "2026-06-10", content, created_at: "", updated_at: "" },
    ],
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("pure helpers", () => {
  it("noteBodyText joins description + entry titles + entry content", () => {
    const n = note({ description: "top body", entries: [{ id: "e", title: "Heading", date: "", content: "deep cyp51A text", created_at: "", updated_at: "" }] as Note["entries"] });
    const body = noteBodyText(n);
    expect(body).toContain("top body");
    expect(body).toContain("Heading");
    expect(body).toContain("deep cyp51A text");
  });

  it("findInBody matches a case-insensitive substring", () => {
    expect(findInBody("contains CYP51A here", "cyp51a", false)).toEqual({ index: 9, length: 6 });
    expect(findInBody("nothing", "cyp51a", false)).toBeNull();
  });

  it("findInBody matches a regex when regex=true", () => {
    const hit = findInBody("ran 30 cycles", "\\d+ cycles", true);
    expect(hit).not.toBeNull();
    expect(hit!.length).toBeGreaterThan(0);
  });

  it("findInBody falls back to literal on an invalid regex", () => {
    // "(" is a bad pattern; treated as literal, so it finds the literal "(".
    expect(findInBody("a (b", "(", true)).toEqual({ index: 2, length: 1 });
  });

  it("snippetAround centers on the match with ellipses", () => {
    const text = "x".repeat(200) + "MATCH" + "y".repeat(200);
    const snip = snippetAround(text, 200, 5);
    expect(snip).toContain("MATCH");
    expect(snip.startsWith("...")).toBe(true);
    expect(snip.endsWith("...")).toBe(true);
  });
});

describe("search_note_bodies tool", () => {
  it("is read-only (no action/destructive)", () => {
    expect(searchNoteBodiesTool.action).toBeUndefined();
    expect(searchNoteBodiesTool.isDestructive).toBeUndefined();
  });

  it("finds notes whose BODY matches and returns snippet + entryTitle + deepLink", async () => {
    vi.spyOn(searchNoteBodiesDeps, "listNotes").mockResolvedValue([
      withEntry(7, "Titrations", "we screened the cyp51A locus today", "Run 3"),
      note({ id: 8, title: "Unrelated", description: "nothing here" }),
    ]);
    const r = (await searchNoteBodiesTool.execute({ query: "cyp51A" })) as {
      ok: boolean; count: number; results: Array<{ id: number; deepLink: string; snippet: string; entryTitle?: string }>;
    };
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
    expect(r.results[0].id).toBe(7);
    expect(r.results[0].deepLink).toBe("/notes/7");
    expect(r.results[0].snippet).toContain("cyp51A");
    expect(r.results[0].entryTitle).toBe("Run 3");
  });

  it("requires a query term", async () => {
    const r = (await searchNoteBodiesTool.execute({ query: "  " })) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/search term is required/i);
  });

  it("rejects an invalid regex cleanly", async () => {
    const r = (await searchNoteBodiesTool.execute({ query: "(", regex: true })) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a valid regular expression/i);
  });
});
