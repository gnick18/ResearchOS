/**
 * recipes-store.test.ts
 *
 * Round-trip tests for the saved analysis recipes store. The storage boundary
 * (fileService + getCurrentUserCached) is mocked with a tiny in-memory JSON map,
 * the same seam the other Data Hub api tests mock, so the test exercises the
 * real read-modify-write logic (id minting, sort, rename, remove) without disk.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory backing store for the mocked fileService.
const files = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    async ensureDir() {
      return null;
    },
    async readJson<T>(path: string): Promise<T | null> {
      return (files.get(path) as T) ?? null;
    },
    async writeJson<T>(path: string, data: T): Promise<void> {
      // Deep clone so the store never holds a live reference to test state.
      files.set(path, JSON.parse(JSON.stringify(data)));
    },
  },
}));

vi.mock("@/lib/storage/json-store", () => ({
  getCurrentUserCached: vi.fn(async () => "alice"),
}));

import { recipesApi } from "./recipes-store";

beforeEach(() => {
  files.clear();
});

describe("recipesApi round-trip", () => {
  it("list is empty for a user with no recipes", async () => {
    await expect(recipesApi.list()).resolves.toEqual([]);
  });

  it("create then list round-trips the recipe shape", async () => {
    const created = await recipesApi.create({
      name: "One-sided Welch",
      analysisType: "unpairedTTest",
      params: { tail: "greater", variance: "welch" },
      tableType: "column",
    });
    expect(created.id).toBe("1");
    expect(created.name).toBe("One-sided Welch");
    expect(created.analysisType).toBe("unpairedTTest");
    expect(created.params).toEqual({ tail: "greater", variance: "welch" });
    expect(created.tableType).toBe("column");
    expect(typeof created.created_at).toBe("string");

    const list = await recipesApi.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(created);
  });

  it("mints monotonically increasing ids that survive a delete", async () => {
    const a = await recipesApi.create({
      name: "A",
      analysisType: "oneWayAnova",
      params: {},
      tableType: "column",
    });
    const b = await recipesApi.create({
      name: "B",
      analysisType: "oneWayAnova",
      params: {},
      tableType: "column",
    });
    expect(a.id).toBe("1");
    expect(b.id).toBe("2");

    // Deleting A must NOT let C recycle id 1.
    await recipesApi.remove(a.id);
    const c = await recipesApi.create({
      name: "C",
      analysisType: "oneWayAnova",
      params: {},
      tableType: "column",
    });
    expect(c.id).toBe("3");
  });

  it("rename updates the name and leaves the rest intact", async () => {
    const created = await recipesApi.create({
      name: "Old",
      analysisType: "grubbsOutlier",
      params: { alpha: 0.05, mode: "twoSided" },
      tableType: "column",
    });
    const renamed = await recipesApi.rename(created.id, "New");
    expect(renamed).not.toBeNull();
    expect(renamed?.name).toBe("New");
    expect(renamed?.params).toEqual({ alpha: 0.05, mode: "twoSided" });

    const list = await recipesApi.list();
    expect(list[0].name).toBe("New");
  });

  it("rename and remove return falsy for an unknown id", async () => {
    await expect(recipesApi.rename("999", "x")).resolves.toBeNull();
    await expect(recipesApi.remove("999")).resolves.toBe(false);
  });

  it("remove drops only the targeted recipe", async () => {
    const a = await recipesApi.create({
      name: "A",
      analysisType: "kaplanMeier",
      params: {},
      tableType: "survival",
    });
    const b = await recipesApi.create({
      name: "B",
      analysisType: "coxRegression",
      params: { referenceGroup: "control" },
      tableType: "survival",
    });
    await expect(recipesApi.remove(a.id)).resolves.toBe(true);
    const list = await recipesApi.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(b.id);
  });

  it("params and tableType round-trip verbatim through disk", async () => {
    const params = { tail: "two", variance: "equal", postHoc: "tukey", alpha: 0.01 };
    await recipesApi.create({
      name: "Recipe",
      analysisType: "oneWayAnova",
      params,
      tableType: "column",
    });
    const [recipe] = await recipesApi.list();
    expect(recipe.params).toEqual(params);
    expect(recipe.tableType).toBe("column");
  });
});
