// frontend/src/lib/projects-hosted-sidecar-skip.test.ts
//
// Tour orphan project R1 root-cause (2026-05-26): the home page surfaced
// a red-bannered "(unnamed project)" card whenever a `<id>-hosted.json`
// cross-owner manifest existed alongside real project files in a user's
// `projects/` directory. `JsonStore.listAll` read every `.json` file
// (including the sidecar), and the sidecar shape `{ version, hostedTasks }`
// lacks `id` and `name` — both fields land `undefined` in the parsed
// record, which fails the orphan-card check on Home.
//
// `projectsApi.purgeMalformed()` already skipped `-hosted.json` via the
// same convention; the read path didn't, so the orphan card kept coming
// back on every render even after the sweep ran. The fix lifts the skip
// into a shared `shouldSkipSidecarFile` helper on the store so both
// listing paths (`listAll` + `listAllForUser`) and the existing purge
// stay in sync.
//
// These tests pin the contract: a hosted-manifest sidecar in `projects/`
// must NEVER surface as a project record on read.

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

function seedProject(id: number, overrides: Partial<Project> = {}): void {
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

function seedHostedSidecar(projectId: number): void {
  const path = `users/alex/projects/${projectId}-hosted.json`;
  memFs.set(path, { version: 1, hostedTasks: [] });
  const dir = "users/alex/projects";
  const fileName = `${projectId}-hosted.json`;
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

describe("projects listing — hosted-sidecar skip", () => {
  it("does NOT surface `<id>-hosted.json` as a project record", async () => {
    seedProject(1, { name: "Test Project" });
    seedHostedSidecar(1);

    const projects = await fetchAllProjectsIncludingShared();
    expect(projects.length).toBe(1);
    expect(projects[0]?.name).toBe("Test Project");
    expect(projects[0]?.id).toBe(1);
  });

  it("skips the sidecar even when no real project exists", async () => {
    // Edge case: a project was deleted but its hosted-manifest was left
    // behind by a prior bug. Should be invisible to the home grid.
    seedHostedSidecar(1);

    const projects = await fetchAllProjectsIncludingShared();
    expect(projects).toEqual([]);
  });

  it("returns the real project from a fresh-user shape", async () => {
    // Regression: the tour's §6.1 fresh-user case used to surface 2 cards
    // — the just-created "Test Project" PLUS a "(unnamed project)" orphan
    // backed by the hosted-manifest sidecar. After R1 only the real card
    // remains.
    seedProject(1, { name: "Test Project" });

    const projects = await fetchAllProjectsIncludingShared();
    expect(projects.length).toBe(1);
    expect(projects.every((p) => p.name && p.name.length > 0)).toBe(true);
  });

  it("drops records with no valid id (defense in depth)", async () => {
    // Even if a future sidecar slips past `shouldSkipSidecarFile` and
    // lands in `projects/` with a `.json` extension but no `id` field,
    // the read-time filter in `fetchAllProjectsIncludingShared` should
    // catch it. Simulate by seeding a record-shaped blob without an
    // integer id.
    seedProject(1, { name: "Test Project" });
    // Inject a malformed `.json` directly into the mock — bypassing
    // `seedProject` so we can set a record with no usable id.
    const dir = "users/alex/projects";
    const fileName = "garbage.json";
    memFs.set(`${dir}/${fileName}`, { foo: "bar" });
    listed.set(dir, [...(listed.get(dir) ?? []), fileName]);

    const projects = await fetchAllProjectsIncludingShared();
    expect(projects.length).toBe(1);
    expect(projects[0]?.name).toBe("Test Project");
  });
});
