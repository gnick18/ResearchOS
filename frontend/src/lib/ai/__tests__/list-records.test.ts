// list_records tool tests (ai summary-robustness bot, 2026-06-14).
//
// Stubs the deps so no real folder is hit. Asserts the tool resolves names/period
// into a filter and passes a clean sorted query to listArtifacts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { listRecordsDeps, listRecordsTool } from "../tools/list-records";
import type { ArtifactBrief } from "@/lib/ai/artifact-index";

const brief = (id: string, title: string): ArtifactBrief => ({
  type: "experiment",
  id,
  title,
  deepLink: `/workbench/experiments/${id}`,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("list_records tool", () => {
  it("is read-only", () => {
    expect(listRecordsTool.action).toBeUndefined();
    expect(listRecordsTool.isDestructive).toBeUndefined();
  });

  it("passes sortBy/order/limit through and returns total + count", async () => {
    const listSpy = vi
      .spyOn(listRecordsDeps, "list")
      .mockResolvedValue({ total: 42, items: [brief("1", "A"), brief("2", "B")] });
    vi.spyOn(listRecordsDeps, "listMemberUsernames").mockResolvedValue([]);
    vi.spyOn(listRecordsDeps, "listProjects").mockResolvedValue([]);

    const r = (await listRecordsTool.execute({ sortBy: "title", order: "asc", limit: 2 })) as {
      ok: boolean; total: number; count: number; sortBy: string; order: string;
    };
    expect(r.ok).toBe(true);
    expect(r.total).toBe(42);
    // The model-facing count is the requested limit (2), even though the tool now
    // fetches up to the UI cap (500) once so the inline record-set widget gets the
    // full match set. items is sliced to the limit for the model.
    expect(r.count).toBe(2);
    expect(r.sortBy).toBe("title");
    expect(r.order).toBe("asc");
    // deps.list is asked for the UI cap, not the model limit, so the widget set is
    // complete in one pass; sortBy/order still flow through unchanged.
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "title", order: "asc", limit: 500 }),
    );
  });

  it("attaches the full match set as a UI-only record-set under _ui when >4 match", async () => {
    vi.spyOn(listRecordsDeps, "list").mockResolvedValue({
      total: 5,
      items: [brief("1", "A"), brief("2", "B"), brief("3", "C"), brief("4", "D"), brief("5", "E")],
    });
    vi.spyOn(listRecordsDeps, "listMemberUsernames").mockResolvedValue([]);
    vi.spyOn(listRecordsDeps, "listProjects").mockResolvedValue([]);

    const r = (await listRecordsTool.execute({ limit: 1 })) as {
      count: number;
      _ui?: { kind: string; total: number; items: Array<{ id: string }> };
    };
    // Model sees only the requested 1 item; the widget set carries all 5.
    expect(r.count).toBe(1);
    expect(r._ui?.kind).toBe("list_records");
    expect(r._ui?.total).toBe(5);
    expect(r._ui?.items.map((i) => i.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("does NOT attach _ui for a lone match (1 item stays an inline chip)", async () => {
    vi.spyOn(listRecordsDeps, "list").mockResolvedValue({
      total: 1,
      items: [brief("1", "A")],
    });
    vi.spyOn(listRecordsDeps, "listMemberUsernames").mockResolvedValue([]);
    vi.spyOn(listRecordsDeps, "listProjects").mockResolvedValue([]);

    const r = (await listRecordsTool.execute({ limit: 10 })) as {
      count: number;
      _ui?: unknown;
    };
    expect(r.count).toBe(1);
    expect(r._ui).toBeUndefined();
  });

  it("attaches _ui for a small set of 2 (compact-layout floor)", async () => {
    vi.spyOn(listRecordsDeps, "list").mockResolvedValue({
      total: 2,
      items: [brief("1", "A"), brief("2", "B")],
    });
    vi.spyOn(listRecordsDeps, "listMemberUsernames").mockResolvedValue([]);
    vi.spyOn(listRecordsDeps, "listProjects").mockResolvedValue([]);

    const r = (await listRecordsTool.execute({ limit: 10 })) as {
      _ui?: { items: Array<{ id: string }> };
    };
    expect(r._ui?.items).toHaveLength(2);
  });

  it("resolves a relative period into a date filter", async () => {
    const listSpy = vi.spyOn(listRecordsDeps, "list").mockResolvedValue({ total: 0, items: [] });
    vi.spyOn(listRecordsDeps, "listMemberUsernames").mockResolvedValue([]);
    vi.spyOn(listRecordsDeps, "listProjects").mockResolvedValue([]);

    await listRecordsTool.execute({ period: "this_year" });
    const passed = listSpy.mock.calls[0][0];
    expect(passed.filter?.since).toMatch(/^\d{4}-01-01$/);
  });

  it("resolves owner NAMES to usernames in the filter", async () => {
    const listSpy = vi.spyOn(listRecordsDeps, "list").mockResolvedValue({ total: 0, items: [] });
    vi.spyOn(listRecordsDeps, "listMemberUsernames").mockResolvedValue(["kritika", "grant"]);
    vi.spyOn(listRecordsDeps, "listProjects").mockResolvedValue([]);

    await listRecordsTool.execute({ owners: ["Kritka"] }); // typo, fuzzy-resolves
    const passed = listSpy.mock.calls[0][0];
    expect(passed.filter?.owners).toEqual(["kritika"]);
  });

  it("drops invalid types", async () => {
    const listSpy = vi.spyOn(listRecordsDeps, "list").mockResolvedValue({ total: 0, items: [] });
    vi.spyOn(listRecordsDeps, "listMemberUsernames").mockResolvedValue([]);
    vi.spyOn(listRecordsDeps, "listProjects").mockResolvedValue([]);

    await listRecordsTool.execute({ types: ["note", "bogus"] });
    const passed = listSpy.mock.calls[0][0];
    expect(passed.filter?.types).toEqual(["note"]);
  });
});
