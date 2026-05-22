// frontend/src/lib/purchases/misc-project.test.ts
//
// Pins the contract of the per-user `_misc_purchases` project helper that
// backs the "Miscellaneous" category on /purchases.
//
// Coverage:
//   - `ensureMiscProject` creates a fresh hidden project on the first
//     call AND persists it on disk;
//   - the second call is idempotent — it returns the same id without
//     writing a second project file;
//   - the predicate `isMiscProject` only matches when BOTH the hidden
//     flag and the reserved name are set (defends against a user-created
//     project that happens to be named `_misc_purchases`);
//   - `is_hidden` round-trips through write + read.
//
// The persistence layer is mocked the same way as
// projects-api-create-guard.test.ts so the misc helper can be tested
// without spinning up the OPFS/filesystem stack.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Project } from "../types";

// ── Mock surface ────────────────────────────────────────────────────────────

const memFs = new Map<string, unknown>();
const listed = new Map<string, string[]>();

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
      const dir = path.slice(0, path.lastIndexOf("/"));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const existing = listed.get(dir) ?? [];
      if (!existing.includes(name)) {
        listed.set(dir, [...existing, name]);
      }
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (path: string) => listed.get(path) ?? []),
    deleteFile: vi.fn(async (path: string) => {
      const existed = memFs.has(path);
      memFs.delete(path);
      const dir = path.slice(0, path.lastIndexOf("/"));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const existing = listed.get(dir) ?? [];
      listed.set(
        dir,
        existing.filter((n) => n !== name),
      );
      return existed;
    }),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import {
  MISC_CATEGORY_LABEL,
  MISC_PROJECT_NAME,
  ensureMiscProject,
  isMiscProject,
} from "./misc-project";
import { clearCurrentUserCache } from "../storage/json-store";

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
});

describe("ensureMiscProject", () => {
  it("creates a new hidden project on the first call and persists it on disk", async () => {
    const created = await ensureMiscProject("alex");

    expect(created.name).toBe(MISC_PROJECT_NAME);
    expect(created.is_hidden).toBe(true);
    expect(created.owner).toBe("alex");
    expect(created.id).toBeGreaterThan(0);

    // The reserved category label is the human-readable display name;
    // the on-disk record carries the raw `_misc_purchases` name.
    expect(MISC_CATEGORY_LABEL).toBe("Miscellaneous");

    // Persisted on disk under the current-user's projects directory.
    const persisted = memFs.get(
      `users/alex/projects/${created.id}.json`,
    ) as Project | undefined;
    expect(persisted).toBeDefined();
    expect(persisted!.name).toBe(MISC_PROJECT_NAME);
    expect(persisted!.is_hidden).toBe(true);
  });

  it("is idempotent: a second call returns the same project without writing a new one", async () => {
    const first = await ensureMiscProject("alex");
    const fileNamesAfterFirst = [
      ...(listed.get("users/alex/projects") ?? []),
    ];

    const second = await ensureMiscProject("alex");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe(MISC_PROJECT_NAME);

    // Sweeping check: no new project file landed on disk between the
    // two calls.
    const fileNamesAfterSecond = listed.get("users/alex/projects") ?? [];
    expect(fileNamesAfterSecond.length).toBe(fileNamesAfterFirst.length);
  });

  it("rejects empty / blank usernames with a clear error", async () => {
    await expect(ensureMiscProject("")).rejects.toThrow(/username is required/i);
    await expect(ensureMiscProject("   ")).rejects.toThrow(
      /username is required/i,
    );
  });

  it("round-trips is_hidden through write + read (the persistence path keeps the flag)", async () => {
    const created = await ensureMiscProject("alex");
    const onDisk = memFs.get(`users/alex/projects/${created.id}.json`) as Project;
    expect(onDisk.is_hidden).toBe(true);

    // Simulate a fresh read by calling ensureMiscProject again — the
    // helper should match the existing file via is_hidden + name and
    // return it unchanged.
    const reread = await ensureMiscProject("alex");
    expect(reread.id).toBe(created.id);
    expect(reread.is_hidden).toBe(true);
  });
});

describe("isMiscProject predicate", () => {
  const baseProject: Project = {
    id: 1,
    name: "",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-05-22T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alex",
    shared_with: [],
  };

  it("returns true only when both is_hidden AND the reserved name match", () => {
    expect(
      isMiscProject({ ...baseProject, name: MISC_PROJECT_NAME, is_hidden: true }),
    ).toBe(true);
  });

  it("returns false for a normal project (no is_hidden, normal name)", () => {
    expect(isMiscProject({ ...baseProject, name: "My research" })).toBe(false);
  });

  it("returns false when a user-created project happens to be named _misc_purchases without the hidden flag", () => {
    // Defense: someone could in theory create a project named
    // `_misc_purchases` via direct file edit or a buggy importer. The
    // predicate refuses to collapse that into the misc bucket unless
    // the hidden flag is also set.
    expect(
      isMiscProject({ ...baseProject, name: MISC_PROJECT_NAME, is_hidden: false }),
    ).toBe(false);
    expect(
      isMiscProject({
        ...baseProject,
        name: MISC_PROJECT_NAME,
        is_hidden: undefined,
      }),
    ).toBe(false);
  });

  it("returns false when is_hidden is set but the name does not match", () => {
    // A future hidden-but-not-misc project (e.g. a hidden archive bucket)
    // must NOT route to the Miscellaneous filter.
    expect(
      isMiscProject({ ...baseProject, name: "_archive_purchases", is_hidden: true }),
    ).toBe(false);
  });
});
