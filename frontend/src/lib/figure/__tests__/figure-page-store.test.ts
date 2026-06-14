import { describe, it, expect, beforeEach, vi } from "vitest";

// An in-memory file service so the store's path-building + round-trip is tested
// without real File System Access. Shared via vi.hoisted so the mock factory can
// see it.
const { files, writeProbe } = vi.hoisted(() => ({
  files: new Map<string, unknown>(),
  // Tracks write concurrency + ordering so the serialization test can assert no
  // two writes to one path ever overlap (the NoModificationAllowedError race).
  writeProbe: { active: 0, maxActive: 0, order: [] as string[] },
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: async (p: string) => (files.has(p) ? files.get(p) : null),
    writeJson: async (p: string, d: unknown) => {
      writeProbe.active += 1;
      writeProbe.maxActive = Math.max(writeProbe.maxActive, writeProbe.active);
      // Yield so any overlapping write would be observed as active > 1.
      await Promise.resolve();
      files.set(p, JSON.parse(JSON.stringify(d)));
      const name = (d as { name?: string }).name;
      if (name) writeProbe.order.push(name);
      writeProbe.active -= 1;
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
  beforeEach(() => {
    files.clear();
    writeProbe.active = 0;
    writeProbe.maxActive = 0;
    writeProbe.order = [];
  });

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

  it("serializes rapid saves to one page so writes never overlap", async () => {
    const page = await createFigurePageDoc("A", null);
    writeProbe.order = []; // ignore the create write
    // Fire many saves without awaiting between them (a slider-drag burst). They
    // must not overlap on the shared tmp file, and the last state must win.
    const promises = [] as Promise<void>[];
    for (let i = 1; i <= 12; i += 1) {
      promises.push(saveFigurePage({ ...page, name: `edit-${i}` }));
    }
    await Promise.all(promises);
    // Never more than one in-flight write at a time (no tmp-move race).
    expect(writeProbe.maxActive).toBe(1);
    // Coalesced: far fewer writes than the 12 calls, and the final state persisted.
    expect(writeProbe.order.length).toBeLessThan(12);
    expect(writeProbe.order.at(-1)).toBe("edit-12");
    expect((await readFigurePage(page.id))?.name).toBe("edit-12");
  });

  it("isolates serialization per page id", async () => {
    const a = await createFigurePageDoc("A", null);
    const b = await createFigurePageDoc("B", null);
    await Promise.all([
      saveFigurePage({ ...a, name: "A2" }),
      saveFigurePage({ ...b, name: "B2" }),
    ]);
    expect((await readFigurePage(a.id))?.name).toBe("A2");
    expect((await readFigurePage(b.id))?.name).toBe("B2");
  });
});
