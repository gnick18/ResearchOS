// frontend/src/lib/fetch-all-projects-hidden.test.ts
//
// Pins the hidden-project filter contract on
// `fetchAllProjectsIncludingShared`.
//
// Hidden projects (currently only the `_misc_purchases` bootstrap that
// backs the "Miscellaneous" purchases category) must:
//   - be filtered out by default so the misc bucket does NOT leak into
//     Home, Workbench, Gantt, search, project pickers, etc.
//   - be returned when the caller opts in with `{ includeHidden: true }`,
//     which is what /purchases passes so it can render the misc bucket.
//
// Setup mirrors projects-api-create-guard.test.ts: filesystem and
// current-user are mocked; we seed the on-disk shape directly and call
// the merged loader.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Project } from "./types";

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
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (path: string) => listed.get(path) ?? []),
    deleteFile: vi.fn(async () => true),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

import { fetchAllProjectsIncludingShared } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

function seedProject(id: number, overrides: Partial<Project>): void {
  const project: Project = {
    id,
    name: `Project ${id}`,
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-05-01T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alex",
    shared_with: [],
    ...overrides,
  };
  memFs.set(`users/alex/projects/${id}.json`, project);
  const dir = "users/alex/projects";
  const fileName = `${id}.json`;
  const existing = listed.get(dir) ?? [];
  if (!existing.includes(fileName)) {
    listed.set(dir, [...existing, fileName]);
  }
}

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
});

describe("fetchAllProjectsIncludingShared — hidden project filter", () => {
  it("hides projects with is_hidden=true by default", async () => {
    seedProject(1, { name: "Real project" });
    seedProject(2, { name: "_misc_purchases", is_hidden: true });

    const projects = await fetchAllProjectsIncludingShared();
    expect(projects.map((p) => p.name)).toEqual(["Real project"]);
  });

  it("returns hidden projects when includeHidden=true", async () => {
    seedProject(1, { name: "Real project" });
    seedProject(2, { name: "_misc_purchases", is_hidden: true });

    const projects = await fetchAllProjectsIncludingShared({
      includeHidden: true,
    });
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(["Real project", "_misc_purchases"]);
  });

  it("hides explicitly when includeHidden=false", async () => {
    seedProject(1, { name: "Real project" });
    seedProject(2, { name: "_misc_purchases", is_hidden: true });

    const projects = await fetchAllProjectsIncludingShared({
      includeHidden: false,
    });
    expect(projects.map((p) => p.name)).toEqual(["Real project"]);
  });

  it("passes non-hidden projects through regardless of the flag", async () => {
    seedProject(1, { name: "A" });
    seedProject(2, { name: "B" });

    const defaulted = await fetchAllProjectsIncludingShared();
    const included = await fetchAllProjectsIncludingShared({
      includeHidden: true,
    });
    expect(defaulted.length).toBe(2);
    expect(included.length).toBe(2);
  });
});
