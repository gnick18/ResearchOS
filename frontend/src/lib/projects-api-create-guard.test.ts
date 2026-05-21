// frontend/src/lib/projects-api-create-guard.test.ts
//
// Regression test for the orphan-project bug: a project card with a blank
// name appeared on the home page and refused to delete because the standard
// id-targeted delete path can't recover from a record whose id/name is
// malformed.
//
// Coverage:
//   - `projectsApi.create` rejects empty / whitespace / undefined names
//     (defense-in-depth on top of UI-level guards).
//   - `projectsApi.purgeMalformed()` removes on-disk project files whose
//     parsed JSON is missing id or has an empty name, and leaves valid
//     records and the per-project `-hosted.json` sidecar alone.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Project } from "./types";

// ── Mock surface ────────────────────────────────────────────────────────────

const memFs = new Map<string, unknown>();
const listed = new Map<string, string[]>();

vi.mock("./file-system/file-service", () => ({
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
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { projectsApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
});

describe("projectsApi.create — name guard", () => {
  it("rejects an empty string name", async () => {
    await expect(projectsApi.create({ name: "" })).rejects.toThrow(
      /name is required/i,
    );
  });

  it("rejects a whitespace-only name", async () => {
    await expect(projectsApi.create({ name: "   \t\n " })).rejects.toThrow(
      /name is required/i,
    );
  });

  it("rejects undefined name", async () => {
    // Intentional bad input — the guard must hold even when callers ignore
    // the type signature (e.g. JS callers or future refactors).
    await expect(
      projectsApi.create({ name: undefined as unknown as string }),
    ).rejects.toThrow(/name is required/i);
  });

  it("rejects non-string name", async () => {
    await expect(
      projectsApi.create({ name: 42 as unknown as string }),
    ).rejects.toThrow(/name is required/i);
  });

  it("accepts a normal name and persists it", async () => {
    const proj = await projectsApi.create({ name: "Real project" });
    expect(proj.name).toBe("Real project");
    expect(proj.id).toBeGreaterThan(0);
    const persisted = memFs.get(`users/alex/projects/${proj.id}.json`) as Project;
    expect(persisted.name).toBe("Real project");
    expect(persisted.owner).toBe("alex");
  });
});

describe("projectsApi.purgeMalformed", () => {
  it("removes a file with empty name and reports it", async () => {
    // Seed: one valid + one malformed (empty name).
    memFs.set("users/alex/projects/1.json", {
      id: 1,
      name: "Valid",
      weekend_active: false,
      tags: null,
      color: null,
      created_at: "2026-01-01T00:00:00Z",
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "alex",
      shared_with: [],
    });
    memFs.set("users/alex/projects/2.json", {
      id: 2,
      name: "",
      weekend_active: false,
      tags: null,
      color: null,
      created_at: "2026-01-01T00:00:00Z",
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "alex",
      shared_with: [],
    });
    listed.set("users/alex/projects", ["1.json", "2.json"]);

    const removed = await projectsApi.purgeMalformed();
    expect(removed).toEqual(["users/alex/projects/2.json"]);
    expect(memFs.has("users/alex/projects/1.json")).toBe(true);
    expect(memFs.has("users/alex/projects/2.json")).toBe(false);
  });

  it("removes a file whose JSON has no id at all", async () => {
    memFs.set("users/alex/projects/orphan.json", {
      name: "stuff",
      // id intentionally absent
    });
    listed.set("users/alex/projects", ["orphan.json"]);

    const removed = await projectsApi.purgeMalformed();
    expect(removed).toEqual(["users/alex/projects/orphan.json"]);
  });

  it("removes a file whose JSON has id=0", async () => {
    memFs.set("users/alex/projects/0.json", {
      id: 0,
      name: "zero",
    });
    listed.set("users/alex/projects", ["0.json"]);

    const removed = await projectsApi.purgeMalformed();
    expect(removed).toEqual(["users/alex/projects/0.json"]);
  });

  it("ignores `<id>-hosted.json` sidecars (they have a different shape)", async () => {
    memFs.set("users/alex/projects/1-hosted.json", {
      version: 1,
      hostedTasks: [],
    });
    listed.set("users/alex/projects", ["1-hosted.json"]);

    const removed = await projectsApi.purgeMalformed();
    expect(removed).toEqual([]);
    expect(memFs.has("users/alex/projects/1-hosted.json")).toBe(true);
  });

  it("returns empty when every file is valid", async () => {
    memFs.set("users/alex/projects/1.json", {
      id: 1,
      name: "Valid",
      weekend_active: false,
      tags: null,
      color: null,
      created_at: "2026-01-01T00:00:00Z",
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "alex",
      shared_with: [],
    });
    listed.set("users/alex/projects", ["1.json"]);

    const removed = await projectsApi.purgeMalformed();
    expect(removed).toEqual([]);
  });

  it("returns empty when there is no current user", async () => {
    // Reset the user mock to return null for this test.
    const indexeddbStore = await import("./file-system/indexeddb-store");
    const original = indexeddbStore.getCurrentUser;
    (indexeddbStore as { getCurrentUser: () => Promise<string | null> }).getCurrentUser = vi.fn(
      async () => null,
    );
    clearCurrentUserCache();
    try {
      const removed = await projectsApi.purgeMalformed();
      expect(removed).toEqual([]);
    } finally {
      (indexeddbStore as { getCurrentUser: () => Promise<string | null> }).getCurrentUser = original;
      clearCurrentUserCache();
    }
  });
});
