// search_my_work tool tests (ai record-widget bot, 2026-06-14).
//
// search_my_work returns ranked ArtifactBriefs across types and, when MORE THAN 4
// match, attaches a UI-only record-set under _ui so the inline browser renders. The
// model-facing { count, results } is unchanged either way. searchMyWork itself is
// the index resolver, mocked here so no real folder is hit; the test asserts the
// mapping (briefToRow) and the ">4" gating.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ArtifactBrief } from "@/lib/ai/artifact-index";

const searchMyWorkMock = vi.fn();
vi.mock("@/lib/ai/artifact-index", () => ({
  searchMyWork: (...args: unknown[]) => searchMyWorkMock(...args),
}));

import { searchMyWorkTool } from "../tools/search-my-work";

const brief = (id: string, type: ArtifactBrief["type"], title: string): ArtifactBrief => ({
  type,
  id,
  title,
  date: "2026-06-10",
  deepLink: `/${type}/${id}`,
});

beforeEach(() => {
  searchMyWorkMock.mockReset();
});

describe("search_my_work tool", () => {
  it("is read-only and passes the query through to searchMyWork", async () => {
    searchMyWorkMock.mockResolvedValue([brief("1", "note", "A")]);
    expect(searchMyWorkTool.action).toBeUndefined();
    const out = (await searchMyWorkTool.execute({ query: "CRISPR note" })) as {
      count: number;
      results: ArtifactBrief[];
    };
    expect(out.count).toBe(1);
    expect(out.results).toHaveLength(1);
    expect(searchMyWorkMock).toHaveBeenCalledWith("CRISPR note", expect.any(Object));
  });

  it("attaches a cross-type record-set under _ui when >4 results, keyed by real type", async () => {
    searchMyWorkMock.mockResolvedValue([
      brief("1", "note", "Cloning note"),
      brief("2", "experiment", "Colony PCR"),
      brief("3", "method", "Tm method"),
      brief("4", "sequence", "pUC19"),
      brief("5", "project", "cyp51A"),
    ]);
    const out = (await searchMyWorkTool.execute({ query: "cyp51A" })) as {
      count: number;
      _ui?: { kind: string; total: number; query: string; items: Array<{ type: string }> };
    };
    expect(out.count).toBe(5);
    expect(out._ui?.kind).toBe("search_my_work");
    expect(out._ui?.total).toBe(5);
    expect(out._ui?.query).toBe("cyp51A");
    // Each row keeps its real type so the widget's type-filter chips slice it.
    expect(out._ui?.items.map((i) => i.type)).toEqual([
      "note",
      "experiment",
      "method",
      "sequence",
      "project",
    ]);
  });

  it("does NOT attach _ui for a lone result (1 stays an inline chip)", async () => {
    searchMyWorkMock.mockResolvedValue([brief("1", "note", "A")]);
    const out = (await searchMyWorkTool.execute({ query: "notes" })) as {
      count: number;
      _ui?: unknown;
    };
    expect(out.count).toBe(1);
    expect(out._ui).toBeUndefined();
  });
});
