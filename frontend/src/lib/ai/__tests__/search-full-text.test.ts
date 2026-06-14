// search_full_text tool tests (ai summary-robustness bot, 2026-06-14).
//
// Stubs the deps (notes / methods / method-body reader) so no real folder is hit.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchFullTextDeps, searchFullTextTool, noteBodyText } from "../tools/search-full-text";
import type { Note, Method } from "@/lib/types";

const note = (id: number, title: string, content: string, entryTitle = "Day 1") =>
  ({
    id,
    title,
    description: "",
    entries: [{ id: "e1", title: entryTitle, date: "2026-06-10", content, created_at: "", updated_at: "" }],
  }) as Note;

const method = (id: number, name: string, isPublic = false) =>
  ({ id, name, source_path: `methods/m${id}/m${id}.md`, method_type: "markdown", is_public: isPublic }) as Method;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("noteBodyText", () => {
  it("joins description + entry titles + content", () => {
    const n = { description: "top", entries: [{ id: "e", title: "H", content: "deep cyp51A", date: "", created_at: "", updated_at: "" }] } as Note;
    expect(noteBodyText(n)).toContain("top");
    expect(noteBodyText(n)).toContain("deep cyp51A");
  });
});

describe("search_full_text tool", () => {
  it("is read-only", () => {
    expect(searchFullTextTool.action).toBeUndefined();
    expect(searchFullTextTool.isDestructive).toBeUndefined();
  });

  it("searches notes AND methods, returns totalMatches + per-record matches", async () => {
    vi.spyOn(searchFullTextDeps, "listNotes").mockResolvedValue([
      note(7, "Titrations", "cyp51A screen, cyp51A again", "Run 3"),
      note(8, "Unrelated", "nothing here"),
    ]);
    vi.spyOn(searchFullTextDeps, "listMethods").mockResolvedValue([method(3, "Knockout protocol")]);
    vi.spyOn(searchFullTextDeps, "readMethodBody").mockResolvedValue("the cyp51A locus is targeted");

    const r = (await searchFullTextTool.execute({ query: "cyp51A" })) as {
      ok: boolean; count: number; totalMatches: number;
      results: Array<{ type: string; id: number; matches: number; deepLink: string; entryTitle?: string }>;
    };
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2); // one note + one method
    expect(r.totalMatches).toBe(3); // 2 in the note body + 1 in the method
    const noteHit = r.results.find((x) => x.type === "note");
    const methodHit = r.results.find((x) => x.type === "method");
    expect(noteHit?.matches).toBe(2);
    expect(noteHit?.entryTitle).toBe("Run 3");
    expect(methodHit?.id).toBe(3);
    expect(methodHit?.deepLink).toContain("method");
  });

  it("honors the types filter (notes only skips method reads)", async () => {
    const noteSpy = vi.spyOn(searchFullTextDeps, "listNotes").mockResolvedValue([note(7, "N", "cyp51A")]);
    const methodSpy = vi.spyOn(searchFullTextDeps, "listMethods").mockResolvedValue([method(3, "M")]);
    const r = (await searchFullTextTool.execute({ query: "cyp51A", types: ["note"] })) as { count: number };
    expect(r.count).toBe(1);
    expect(noteSpy).toHaveBeenCalled();
    expect(methodSpy).not.toHaveBeenCalled();
  });

  it("requires a query and rejects a bad regex", async () => {
    const blank = (await searchFullTextTool.execute({ query: " " })) as { ok: boolean; error: string };
    expect(blank.ok).toBe(false);
    const bad = (await searchFullTextTool.execute({ query: "(", regex: true })) as { ok: boolean; error: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/not a valid regular expression/i);
  });

  it("attaches a record-set under _ui when >4 records match, none for 4 or fewer", async () => {
    const fiveNotes = [1, 2, 3, 4, 5].map((id) => note(id, `Note ${id}`, "cyp51A here"));
    vi.spyOn(searchFullTextDeps, "listNotes").mockResolvedValue(fiveNotes);
    vi.spyOn(searchFullTextDeps, "listMethods").mockResolvedValue([]);
    const big = (await searchFullTextTool.execute({ query: "cyp51A" })) as {
      _ui?: { kind: string; total: number; query: string; items: Array<{ type: string }> };
    };
    expect(big._ui?.kind).toBe("search_full_text");
    expect(big._ui?.total).toBe(5);
    expect(big._ui?.query).toBe("cyp51A");
    expect(big._ui?.items.every((i) => i.type === "note")).toBe(true);

    vi.restoreAllMocks();
    const fourNotes = [1, 2, 3, 4].map((id) => note(id, `Note ${id}`, "cyp51A here"));
    vi.spyOn(searchFullTextDeps, "listNotes").mockResolvedValue(fourNotes);
    vi.spyOn(searchFullTextDeps, "listMethods").mockResolvedValue([]);
    const small = (await searchFullTextTool.execute({ query: "cyp51A" })) as { _ui?: unknown };
    expect(small._ui).toBeUndefined();
  });
});
