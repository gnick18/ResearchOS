// Tests for dataHubApi (Phase 0 data model). fileService + the current-user
// helper are mocked with an in-memory store spanning multiple users.

import { describe, it, expect, vi, beforeEach } from "vitest";

const blobs = new Map<string, Uint8Array>();
const jsons = new Map<string, unknown>();
let CURRENT_USER = "alex";

// Derive the set of user dir names from the paths we have written under users/.
function userDirs(): string[] {
  const names = new Set<string>();
  for (const path of [...jsons.keys(), ...blobs.keys()]) {
    const m = path.match(/^users\/([^/]+)\//);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

// List the file names directly inside a dir path (one level deep).
function listFiles(dirPath: string): string[] {
  const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  const names = new Set<string>();
  for (const path of jsons.keys()) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest.includes("/")) names.add(rest);
  }
  return [...names].sort();
}

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    ensureDir: vi.fn(async () => null),
    readFileAsBlob: vi.fn(async (path: string) => {
      const v = blobs.get(path);
      if (v === undefined) return null;
      return new Blob([v.buffer as ArrayBuffer]);
    }),
    writeFileFromBlob: vi.fn(async (path: string, blob: Blob) => {
      blobs.set(path, new Uint8Array(await blob.arrayBuffer()));
    }),
    readJson: vi.fn(async (path: string) =>
      jsons.has(path) ? jsons.get(path) : null,
    ),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      jsons.set(path, data);
    }),
    deleteFile: vi.fn(async (path: string) => {
      const had = jsons.has(path) || blobs.has(path);
      jsons.delete(path);
      blobs.delete(path);
      return had;
    }),
    listFiles: vi.fn(async (dirPath: string) => listFiles(dirPath)),
    listDirectories: vi.fn(async (dirPath: string) =>
      dirPath === "users" ? userDirs() : [],
    ),
  },
}));

vi.mock("@/lib/storage/json-store", () => ({
  getCurrentUserCached: vi.fn(async () => CURRENT_USER),
}));

import { dataHubApi } from "../../api";

describe("dataHubApi", () => {
  beforeEach(() => {
    blobs.clear();
    jsons.clear();
    CURRENT_USER = "alex";
  });

  it("create allocates a string id, writes both files, and bumps the counter", async () => {
    const doc = await dataHubApi.create({
      name: "Assay 1",
      table_type: "column",
      project_ids: ["proj-a"],
    });
    expect(typeof doc.id).toBe("string");
    expect(doc.id).toBe("1");
    expect(doc.name).toBe("Assay 1");
    expect(doc.created_at).toBeTruthy();
    // Counter bumped.
    expect(jsons.get("users/alex/_counters.json")).toEqual({ datahub: 1 });
    // Both files written.
    expect(jsons.has(`users/alex/datahub/1.json`)).toBe(true);
    expect(blobs.has(`users/alex/datahub/1.loro`)).toBe(true);

    const doc2 = await dataHubApi.create({ name: "Assay 2", table_type: "xy" });
    expect(doc2.id).toBe("2");
  });

  it("list returns every document across all users, sorted by name", async () => {
    await dataHubApi.create({ name: "Bravo", table_type: "column", project_ids: ["p1"] });
    CURRENT_USER = "mira";
    await dataHubApi.create({ name: "Alpha", table_type: "xy", project_ids: ["p1"] });

    const all = await dataHubApi.list();
    expect(all.map((d) => d.name)).toEqual(["Alpha", "Bravo"]);
  });

  it("listByProject filters on project membership (N-to-M)", async () => {
    await dataHubApi.create({ name: "InP1", table_type: "column", project_ids: ["p1", "p2"] });
    await dataHubApi.create({ name: "InP2only", table_type: "column", project_ids: ["p2"] });
    await dataHubApi.create({ name: "NoProj", table_type: "column", project_ids: [] });

    const p1 = await dataHubApi.listByProject("p1");
    expect(p1.map((d) => d.name)).toEqual(["InP1"]);

    const p2 = await dataHubApi.listByProject("p2");
    expect(p2.map((d) => d.name)).toEqual(["InP1", "InP2only"]);
  });

  it("listByFolder filters on project + folder_path (null = project root)", async () => {
    await dataHubApi.create({
      name: "Root",
      table_type: "column",
      project_ids: ["p1"],
      folder_path: null,
    });
    await dataHubApi.create({
      name: "InRaw",
      table_type: "column",
      project_ids: ["p1"],
      folder_path: "raw",
    });

    const root = await dataHubApi.listByFolder("p1", null);
    expect(root.map((d) => d.name)).toEqual(["Root"]);
    // "" is treated as the root.
    const rootEmpty = await dataHubApi.listByFolder("p1", "");
    expect(rootEmpty.map((d) => d.name)).toEqual(["Root"]);

    const raw = await dataHubApi.listByFolder("p1", "raw");
    expect(raw.map((d) => d.name)).toEqual(["InRaw"]);
  });

  it("get returns metadata by id and null for a missing id", async () => {
    const created = await dataHubApi.create({ name: "X", table_type: "column" });
    const got = await dataHubApi.get(created.id);
    expect(got?.name).toBe("X");
    expect(await dataHubApi.get("nope")).toBeNull();
  });

  it("update patches metadata-only fields without losing the table", async () => {
    const created = await dataHubApi.create({
      name: "Orig",
      table_type: "column",
      project_ids: ["p1"],
      columns: [{ id: "c1", name: "X", role: "x", dataType: "number" }],
      rows: [{ id: "r1", cells: { c1: 5 } }],
    });
    const updated = await dataHubApi.update(created.id, {
      name: "Renamed",
      project_ids: ["p1", "p2"],
      folder_path: "results",
      last_edited_by: "alex",
    });
    expect(updated?.name).toBe("Renamed");
    expect(updated?.project_ids).toEqual(["p1", "p2"]);
    expect(updated?.folder_path).toBe("results");

    // The table survived (read it back off the mirror).
    const mirror = jsons.get(`users/alex/datahub/${created.id}.json`) as {
      rows: { id: string; cells: Record<string, unknown> }[];
    };
    expect(mirror.rows[0].cells.c1).toBe(5);
  });

  it("update returns null for a missing id", async () => {
    expect(await dataHubApi.update("nope", { name: "x" })).toBeNull();
  });

  it("delete removes both files and returns true, false when missing", async () => {
    const created = await dataHubApi.create({ name: "Doomed", table_type: "column" });
    expect(await dataHubApi.delete(created.id)).toBe(true);
    expect(jsons.has(`users/alex/datahub/${created.id}.json`)).toBe(false);
    expect(blobs.has(`users/alex/datahub/${created.id}.loro`)).toBe(false);
    expect(await dataHubApi.delete("nope")).toBe(false);
  });
});
