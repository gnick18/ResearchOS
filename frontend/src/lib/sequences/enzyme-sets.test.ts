// enzyme sets bot — round-trip + mutation coverage for the per-user persistent
// enzyme-sets store. Mocks the same `fileService` JSON seam the production
// store reads/writes (a memFs map keyed by path), mirroring the harness in
// methods-api-excerpt.test.ts.

import { describe, expect, it, beforeEach, vi } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      // simulate a JSON round-trip so we catch anything non-serializable
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

import {
  listEnzymeSets,
  saveEnzymeSet,
  renameEnzymeSet,
  deleteEnzymeSet,
  enzymeSetsApi,
  type EnzymeSetsFile,
} from "./enzyme-sets";

const USER = "alex";
const PATH = `users/${USER}/_enzyme_sets.json`;

beforeEach(() => {
  memFs.clear();
});

describe("enzyme-sets store", () => {
  it("starts empty for a fresh user", async () => {
    await expect(listEnzymeSets(USER)).resolves.toEqual([]);
  });

  it("saves a new set and lists it back (round-trip through disk)", async () => {
    const saved = await saveEnzymeSet(USER, {
      name: "Cloning workhorses",
      enzymeKeys: ["ecori", "bamhi", "hindiii"],
    });
    expect(saved.id).toMatch(/^es_/);
    expect(saved.name).toBe("Cloning workhorses");
    expect(saved.enzymeKeys).toEqual(["ecori", "bamhi", "hindiii"]);

    const persisted = memFs.get(PATH) as EnzymeSetsFile;
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.sets).toHaveLength(1);

    const listed = await listEnzymeSets(USER);
    expect(listed).toHaveLength(1);
    expect(listed[0].enzymeKeys).toEqual(["ecori", "bamhi", "hindiii"]);
  });

  it("loading a saved set yields exactly its enzyme keys", async () => {
    const a = await saveEnzymeSet(USER, { name: "A", enzymeKeys: ["ecori"] });
    const b = await saveEnzymeSet(USER, {
      name: "B",
      enzymeKeys: ["bamhi", "noti"],
    });
    const sets = await listEnzymeSets(USER);
    const loadedA = sets.find((s) => s.id === a.id);
    const loadedB = sets.find((s) => s.id === b.id);
    expect(loadedA?.enzymeKeys).toEqual(["ecori"]);
    expect(loadedB?.enzymeKeys).toEqual(["bamhi", "noti"]);
  });

  it("normalizes keys: lowercases, trims, de-dups, drops blanks", async () => {
    const saved = await saveEnzymeSet(USER, {
      name: "Messy",
      enzymeKeys: ["EcoRI", " bamhi ", "ecori", "", "  ", "NotI"],
    });
    expect(saved.enzymeKeys).toEqual(["ecori", "bamhi", "noti"]);
  });

  it("updates an existing set in place when id matches (preserves createdAt)", async () => {
    const v1 = await saveEnzymeSet(USER, {
      name: "Set",
      enzymeKeys: ["ecori"],
    });
    await new Promise((r) => setTimeout(r, 2));
    const v2 = await saveEnzymeSet(USER, {
      id: v1.id,
      name: "Set",
      enzymeKeys: ["ecori", "bamhi"],
    });
    expect(v2.id).toBe(v1.id);
    expect(v2.createdAt).toBe(v1.createdAt);
    expect(v2.enzymeKeys).toEqual(["ecori", "bamhi"]);

    const sets = await listEnzymeSets(USER);
    expect(sets).toHaveLength(1); // updated in place, not duplicated
    expect(sets[0].enzymeKeys).toEqual(["ecori", "bamhi"]);
  });

  it("creates a new set when an unknown id is supplied", async () => {
    await saveEnzymeSet(USER, { name: "A", enzymeKeys: ["ecori"] });
    const created = await saveEnzymeSet(USER, {
      id: "es_does_not_exist",
      name: "B",
      enzymeKeys: ["bamhi"],
    });
    expect(created.id).not.toBe("es_does_not_exist");
    const sets = await listEnzymeSets(USER);
    expect(sets).toHaveLength(2);
  });

  it("renames a set, leaving keys + createdAt intact", async () => {
    const saved = await saveEnzymeSet(USER, {
      name: "Old name",
      enzymeKeys: ["ecori"],
    });
    const renamed = await renameEnzymeSet(USER, saved.id, "New name");
    expect(renamed?.name).toBe("New name");
    expect(renamed?.enzymeKeys).toEqual(["ecori"]);
    expect(renamed?.createdAt).toBe(saved.createdAt);

    const sets = await listEnzymeSets(USER);
    expect(sets[0].name).toBe("New name");
  });

  it("rename returns null for an unknown id", async () => {
    await expect(renameEnzymeSet(USER, "nope", "X")).resolves.toBeNull();
  });

  it("deletes a set and reports whether one was removed", async () => {
    const a = await saveEnzymeSet(USER, { name: "A", enzymeKeys: ["ecori"] });
    const b = await saveEnzymeSet(USER, { name: "B", enzymeKeys: ["bamhi"] });
    await expect(deleteEnzymeSet(USER, a.id)).resolves.toBe(true);
    await expect(deleteEnzymeSet(USER, "ghost")).resolves.toBe(false);
    const sets = await listEnzymeSets(USER);
    expect(sets).toHaveLength(1);
    expect(sets[0].id).toBe(b.id);
  });

  it("rejects an empty name on save and rename", async () => {
    await expect(
      saveEnzymeSet(USER, { name: "   ", enzymeKeys: ["ecori"] }),
    ).rejects.toThrow(/name is required/i);
    const saved = await saveEnzymeSet(USER, { name: "ok", enzymeKeys: [] });
    await expect(renameEnzymeSet(USER, saved.id, "  ")).rejects.toThrow(
      /name is required/i,
    );
  });

  it("sets are user-level: a different user has its own list", async () => {
    await saveEnzymeSet(USER, { name: "Alex set", enzymeKeys: ["ecori"] });
    await expect(listEnzymeSets("morgan")).resolves.toEqual([]);
    await saveEnzymeSet("morgan", { name: "Morgan set", enzymeKeys: ["noti"] });
    expect(await listEnzymeSets(USER)).toHaveLength(1);
    expect(await listEnzymeSets("morgan")).toHaveLength(1);
  });

  it("drops malformed entries when reading a hand-edited file", async () => {
    memFs.set(PATH, {
      schemaVersion: 1,
      sets: [
        { id: "ok", name: "Good", enzymeKeys: ["ecori"] },
        { id: "bad", enzymeKeys: ["bamhi"] }, // no name -> dropped
        null,
        "garbage",
      ],
    });
    const sets = await listEnzymeSets(USER);
    expect(sets).toHaveLength(1);
    expect(sets[0].name).toBe("Good");
  });

  it("concurrent saves in one tick both survive (write serialization)", async () => {
    await Promise.all([
      saveEnzymeSet(USER, { name: "A", enzymeKeys: ["ecori"] }),
      saveEnzymeSet(USER, { name: "B", enzymeKeys: ["bamhi"] }),
      saveEnzymeSet(USER, { name: "C", enzymeKeys: ["noti"] }),
    ]);
    const sets = await listEnzymeSets(USER);
    expect(sets).toHaveLength(3);
    expect(sets.map((s) => s.name).sort()).toEqual(["A", "B", "C"]);
  });

  it("exposes the same operations through enzymeSetsApi", async () => {
    const saved = await enzymeSetsApi.save(USER, {
      name: "Via api",
      enzymeKeys: ["ecori"],
    });
    expect(await enzymeSetsApi.list(USER)).toHaveLength(1);
    await enzymeSetsApi.rename(USER, saved.id, "Renamed");
    expect((await enzymeSetsApi.list(USER))[0].name).toBe("Renamed");
    await enzymeSetsApi.delete(USER, saved.id);
    expect(await enzymeSetsApi.list(USER)).toEqual([]);
  });
});
