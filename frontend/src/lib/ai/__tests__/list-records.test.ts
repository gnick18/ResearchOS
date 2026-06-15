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
    expect(r.count).toBe(2);
    expect(r.sortBy).toBe("title");
    expect(r.order).toBe("asc");
    // list_records is a deterministic top-N, so the lister is asked for exactly the
    // requested limit (not a wider UI cap); the widget shows what was asked for.
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "title", order: "asc", limit: 2 }),
    );
  });

  it("the widget set respects the requested limit (top-N), not the whole table", async () => {
    // The lister returns the limit-capped page (3) plus the real total (13).
    vi.spyOn(listRecordsDeps, "list").mockResolvedValue({
      total: 13,
      items: [brief("1", "A"), brief("2", "B"), brief("3", "C")],
    });
    vi.spyOn(listRecordsDeps, "listMemberUsernames").mockResolvedValue([]);
    vi.spyOn(listRecordsDeps, "listProjects").mockResolvedValue([]);

    const r = (await listRecordsTool.execute({ limit: 3 })) as {
      count: number;
      total: number;
      _ui?: { kind: string; total: number; items: Array<{ id: string }> };
    };
    // The model learns the real total (13), but the widget shows only the 3 asked
    // for, with its header count matching the shown rows (not "3 of 13").
    expect(r.count).toBe(3);
    expect(r.total).toBe(13);
    expect(r._ui?.kind).toBe("list_records");
    expect(r._ui?.items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(r._ui?.total).toBe(3);
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
