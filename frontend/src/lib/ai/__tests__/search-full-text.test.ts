// search_full_text tool tests (ai summary-robustness bot, 2026-06-14).
//
// Stubs the deps (notes / methods / method-body reader) so no real folder is hit.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchFullTextDeps,
  searchFullTextTool,
  noteBodyText,
  experimentBodyText,
  purchaseBodyText,
  inventoryBodyText,
} from "../tools/search-full-text";
import type { Note, Method, Task, PurchaseItem, InventoryItem } from "@/lib/types";

const purchase = (id: number, name: string, notes: string) =>
  ({ id, item_name: name, notes }) as PurchaseItem;

const invItem = (id: number, name: string, notes: string | null = null, hazard: string | null = null) =>
  ({ id, name, notes, hazard_note: hazard }) as InventoryItem;

const note = (id: number, title: string, content: string, entryTitle = "Day 1") =>
  ({
    id,
    title,
    description: "",
    entries: [{ id: "e1", title: entryTitle, date: "2026-06-10", content, created_at: "", updated_at: "" }],
  }) as Note;

const method = (id: number, name: string, isPublic = false) =>
  ({ id, name, source_path: `methods/m${id}/m${id}.md`, method_type: "markdown", is_public: isPublic }) as Method;

const expTask = (id: number, name: string, deviation = "", type: Task["task_type"] = "experiment") =>
  ({ id, name, task_type: type, owner: "me", deviation_log: deviation || null }) as Task;

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

  it("attaches a record-set under _ui for a set of matches, none for a lone match", async () => {
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
    const oneNote = [1].map((id) => note(id, `Note ${id}`, "cyp51A here"));
    vi.spyOn(searchFullTextDeps, "listNotes").mockResolvedValue(oneNote);
    vi.spyOn(searchFullTextDeps, "listMethods").mockResolvedValue([]);
    const small = (await searchFullTextTool.execute({ query: "cyp51A" })) as { _ui?: unknown };
    expect(small._ui).toBeUndefined();
  });
});

describe("experimentBodyText", () => {
  it("joins the name + deviation log + results writeup", () => {
    const t = expTask(1, "Colony PCR", "ran 2C hot");
    const body = experimentBodyText(t, "Lanes 3, 7, 11 showed no band.");
    expect(body).toContain("Colony PCR");
    expect(body).toContain("ran 2C hot");
    expect(body).toContain("no band");
  });
});

describe("search_full_text over experiments", () => {
  it("reads experiment results.md writeups + deviation logs and matches them", async () => {
    vi.spyOn(searchFullTextDeps, "listNotes").mockResolvedValue([]);
    vi.spyOn(searchFullTextDeps, "listMethods").mockResolvedValue([]);
    vi.spyOn(searchFullTextDeps, "listTasks").mockResolvedValue([
      expTask(10, "Colony PCR, Plate 4"),
      expTask(11, "Order tips", "", "purchase"), // not an experiment, skipped
    ]);
    vi.spyOn(searchFullTextDeps, "readExperimentResults").mockResolvedValue(
      "Lanes 3, 7, 11 showed no band. Re-ran, no band again.",
    );

    const r = (await searchFullTextTool.execute({ query: "no band", types: ["experiment"] })) as {
      ok: boolean; count: number; totalMatches: number;
      results: Array<{ type: string; id: number; matches: number; deepLink: string; snippet: string }>;
    };
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1); // only the experiment task, not the purchase
    const hit = r.results[0];
    expect(hit.type).toBe("experiment");
    expect(hit.id).toBe(10);
    expect(hit.matches).toBe(2);
    expect(hit.snippet).toContain("no band");
  });

  it("does not read experiment bodies when experiment is excluded from types", async () => {
    vi.spyOn(searchFullTextDeps, "listNotes").mockResolvedValue([note(1, "N", "no band here")]);
    vi.spyOn(searchFullTextDeps, "listMethods").mockResolvedValue([]);
    const taskSpy = vi.spyOn(searchFullTextDeps, "listTasks").mockResolvedValue([]);
    await searchFullTextTool.execute({ query: "no band", types: ["note"] });
    expect(taskSpy).not.toHaveBeenCalled();
  });
});

describe("purchaseBodyText + inventoryBodyText", () => {
  it("joins purchase item name + notes", () => {
    expect(purchaseBodyText(purchase(1, "P1000 tips", "backordered until July"))).toContain("backordered");
  });
  it("joins inventory name + notes + hazard note", () => {
    const body = inventoryBodyText(invItem(1, "Acetone", "near-empty", "Flammable"));
    expect(body).toContain("near-empty");
    expect(body).toContain("Flammable");
  });
});

describe("search_full_text over purchases + inventory", () => {
  it("matches purchase notes and inventory notes", async () => {
    vi.spyOn(searchFullTextDeps, "listNotes").mockResolvedValue([]);
    vi.spyOn(searchFullTextDeps, "listMethods").mockResolvedValue([]);
    vi.spyOn(searchFullTextDeps, "listTasks").mockResolvedValue([]);
    vi.spyOn(searchFullTextDeps, "listPurchases").mockResolvedValue([
      purchase(20, "P1000 tips", "backordered until July"),
      purchase(21, "Q5 polymerase", "fresh lot"),
    ]);
    vi.spyOn(searchFullTextDeps, "listInventoryItems").mockResolvedValue([
      invItem(30, "Acetone", "running low, backordered"),
    ]);

    const r = (await searchFullTextTool.execute({ query: "backordered" })) as {
      ok: boolean; count: number; results: Array<{ type: string; id: number; deepLink: string }>;
    };
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2); // one purchase + one inventory item
    const types = r.results.map((x) => x.type).sort();
    expect(types).toEqual(["inventory", "purchase"]);
    expect(r.results.find((x) => x.type === "purchase")?.deepLink).toBe("/purchases");
    expect(r.results.find((x) => x.type === "inventory")?.deepLink).toBe("/inventory");
  });
});
