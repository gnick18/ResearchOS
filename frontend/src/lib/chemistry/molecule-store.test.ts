import { beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the chemistry-workbench Phase 1 on-disk shape (the flagged data-shape
// change) against an in-memory fake fileService: the .mol + .meta.json pair, the
// per-user counter id allocation, the crash-safe write order, and the
// create/list/get/update/delete roundtrip. No real File System Access needed.

const files = new Map<string, string>();

vi.mock("../file-system/file-service", () => ({
  fileService: {
    async ensureDir() {
      return null;
    },
    async listFiles(dir: string) {
      const prefix = `${dir}/`;
      return [...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => p.slice(prefix.length));
    },
    async readJson<T>(path: string): Promise<T | null> {
      const raw = files.get(path);
      return raw == null ? null : (JSON.parse(raw) as T);
    },
    async writeJson<T>(path: string, data: T) {
      files.set(path, JSON.stringify(data));
    },
    async readText(path: string) {
      return files.get(path) ?? null;
    },
    async writeText(path: string, content: string) {
      files.set(path, content);
    },
    async deleteFile(path: string) {
      return files.delete(path);
    },
  },
}));

vi.mock("../storage/json-store", () => ({
  getCurrentUserCached: async () => "grant",
}));

import { moleculeStore } from "./molecule-store";

const MOLFILE = "\n  fake molfile body\nM  END\n";

describe("moleculeStore on-disk shape", () => {
  beforeEach(() => {
    files.clear();
  });

  it("writes the .mol + .meta.json pair at the locked per-user path", async () => {
    const { meta } = await moleculeStore.create(MOLFILE, {
      name: "Aspirin",
      project_ids: ["3"],
      added_at: "2026-06-10T00:00:00.000Z",
      source: "drawn",
      smiles: "CC(=O)Oc1ccccc1C(=O)O",
    });
    expect(meta.id).toBe("1");
    expect(files.has("users/grant/molecules/1.mol")).toBe(true);
    expect(files.has("users/grant/molecules/1.meta.json")).toBe(true);
    expect(files.get("users/grant/molecules/1.mol")).toBe(MOLFILE);
    // counter bumped under the shared per-user counters file
    expect(files.get("users/grant/_counters.json")).toContain("\"molecules\":1");
  });

  it("allocates incrementing ids and lists newest first", async () => {
    await moleculeStore.create(MOLFILE, {
      name: "A",
      project_ids: [],
      added_at: "2026-06-10T00:00:00.000Z",
    });
    await moleculeStore.create(MOLFILE, {
      name: "B",
      project_ids: [],
      added_at: "2026-06-10T00:00:01.000Z",
    });
    const list = await moleculeStore.listMeta();
    expect(list.map((m) => m.id)).toEqual(["2", "1"]);
    expect(list[0].name).toBe("B");
  });

  it("roundtrips the Molfile + sidecar through getRaw", async () => {
    const { meta } = await moleculeStore.create(MOLFILE, {
      name: "Caffeine",
      project_ids: [],
      added_at: "2026-06-10T00:00:00.000Z",
    });
    const raw = await moleculeStore.getRaw(meta.id);
    expect(raw?.molfile).toBe(MOLFILE);
    expect(raw?.meta.name).toBe("Caffeine");
  });

  it("patches the sidecar without touching the .mol", async () => {
    const { meta } = await moleculeStore.create(MOLFILE, {
      name: "old",
      project_ids: [],
      added_at: "2026-06-10T00:00:00.000Z",
    });
    const updated = await moleculeStore.updateMeta(
      meta.id,
      { name: "new", project_ids: ["7"] },
      "grant",
    );
    expect(updated?.name).toBe("new");
    expect(updated?.project_ids).toEqual(["7"]);
    expect(updated?.id).toBe(meta.id);
    // .mol untouched
    expect(files.get("users/grant/molecules/1.mol")).toBe(MOLFILE);
  });

  it("skips a torn record that has a .mol but no sidecar", async () => {
    // simulate a crash between the two writes (mol written, sidecar not)
    files.set("users/grant/molecules/9.mol", MOLFILE);
    const list = await moleculeStore.listMeta();
    expect(list).toEqual([]);
  });

  it("deletes both files of the pair", async () => {
    const { meta } = await moleculeStore.create(MOLFILE, {
      name: "x",
      project_ids: [],
      added_at: "2026-06-10T00:00:00.000Z",
    });
    const had = await moleculeStore.delete(meta.id, "grant");
    expect(had).toBe(true);
    expect(files.has("users/grant/molecules/1.mol")).toBe(false);
    expect(files.has("users/grant/molecules/1.meta.json")).toBe(false);
  });
});
