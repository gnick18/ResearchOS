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
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "title", order: "asc", limit: 2 }),
    );
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
