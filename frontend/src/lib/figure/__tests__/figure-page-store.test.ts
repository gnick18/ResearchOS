import { describe, it, expect, beforeEach, vi } from "vitest";

// An in-memory file service so the store's path-building + round-trip is tested
// without real File System Access. Shared via vi.hoisted so the mock factory can
// see it.
const { files } = vi.hoisted(() => ({ files: new Map<string, unknown>() }));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: async (p: string) => (files.has(p) ? files.get(p) : null),
    writeJson: async (p: string, d: unknown) => {
      files.set(p, JSON.parse(JSON.stringify(d)));
    },
    listFiles: async (dir: string) =>
      [...files.keys()]
        .filter((k) => k.startsWith(dir + "/"))
        .map((k) => k.slice(dir.length + 1)),
  },
}));

vi.mock("@/lib/storage/json-store", () => ({
  getCurrentUserCached: async () => "alex",
}));

import {
  createFigurePageDoc,
  saveFigurePage,
  readFigurePage,
  listFigurePages,
} from "@/lib/figure/figure-page-store";

describe("figure-page store", () => {
  beforeEach(() => files.clear());

  it("create then read round-trips the page", async () => {
    const page = await createFigurePageDoc("Figure 1", "c1");
    expect(page.id).toBe("1");
    const read = await readFigurePage("1");
    expect(read?.name).toBe("Figure 1");
    expect(read?.collectionId).toBe("c1");
    expect(read?.labelStyle).toBe("ABC");
  });

  it("ids increment via the shared _counters entity", async () => {
    const a = await createFigurePageDoc("A", null);
    const b = await createFigurePageDoc("B", null);
    expect(a.id).toBe("1");
    expect(b.id).toBe("2");
    // the counter lives under the figures entity, not the figures dir
    expect(files.get("users/alex/_counters.json")).toEqual({ figures: 2 });
  });

  it("list filters by collection (undefined = all)", async () => {
    await createFigurePageDoc("A", "c1");
    await createFigurePageDoc("B", "c2");
    expect((await listFigurePages("c1")).map((p) => p.name)).toEqual(["A"]);
    expect(await listFigurePages()).toHaveLength(2);
  });

  it("save persists edits", async () => {
    const page = await createFigurePageDoc("A", null);
    page.name = "Renamed";
    await saveFigurePage(page);
    expect((await readFigurePage(page.id))?.name).toBe("Renamed");
  });
});
