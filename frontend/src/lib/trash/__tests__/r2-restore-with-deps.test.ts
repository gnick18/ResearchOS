// VCP R2 trash everywhere (2026-05-26): restore-with-dependencies tests
// for the prompt's parent-in-trash detection logic.
//
// We exercise `findParentInTrash` directly (the visible-prompt branch is
// a React modal and out of scope for unit tests). The OQ4 default is
// covered by the hook's "Restore both" return value when a parent
// surfaces.

import { beforeEach, describe, expect, it, vi } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    deleteFile: vi.fn(async (path: string) => {
      const had = memFs.has(path);
      memFs.delete(path);
      return had;
    }),
    isConnected: vi.fn(() => true),
    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = `${dirPath}/`;
      const out: string[] = [];
      for (const key of memFs.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) out.push(rest);
        }
      }
      return out.sort();
    }),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
  },
}));

vi.mock("@/lib/settings/user-settings", () => ({
  readUserSettings: vi.fn(async () => ({})),
  DEFAULT_SETTINGS: {},
}));

import { trashEntity, listTrash } from "..";
import { findParentInTrash } from "@/components/trash/RestoreParentPrompt";

const OWNER = "mira";

beforeEach(() => {
  memFs.clear();
});

describe("R2 restore-with-deps: findParentInTrash", () => {
  it("returns the parent index entry when both task and its project are in trash", async () => {
    // Seed and trash the parent project.
    memFs.set(`users/${OWNER}/projects/55.json`, {
      id: 55,
      name: "Aspergillus",
      owner: OWNER,
    });
    await trashEntity({
      owner: OWNER,
      entityType: "project",
      id: 55,
      deletedBy: OWNER,
    });

    // Seed and trash the child task with a parent ref.
    memFs.set(`users/${OWNER}/tasks/100.json`, {
      id: 100,
      name: "PCR Day 1",
      project_id: 55,
      owner: OWNER,
    });
    await trashEntity({
      owner: OWNER,
      entityType: "task",
      id: 100,
      deletedBy: OWNER,
      parent: { parent_id: 55, parent_entity_type: "project" },
    });

    const childEntries = await listTrash(OWNER, "task");
    expect(childEntries).toHaveLength(1);
    const child = childEntries[0];
    expect(child.parent_id).toBe(55);
    expect(child.parent_entity_type).toBe("project");

    const parent = await findParentInTrash(OWNER, child);
    expect(parent).not.toBeNull();
    expect(parent?.entity_type).toBe("project");
    expect(parent?.id).toBe(55);
  });

  it("returns null when the parent is NOT in trash (live parent still exists)", async () => {
    // Project is live on disk — never trashed.
    memFs.set(`users/${OWNER}/projects/55.json`, {
      id: 55,
      name: "Aspergillus",
      owner: OWNER,
    });
    // Trash only the task.
    memFs.set(`users/${OWNER}/tasks/100.json`, {
      id: 100,
      name: "PCR Day 1",
      project_id: 55,
      owner: OWNER,
    });
    await trashEntity({
      owner: OWNER,
      entityType: "task",
      id: 100,
      deletedBy: OWNER,
      parent: { parent_id: 55, parent_entity_type: "project" },
    });

    const [child] = await listTrash(OWNER, "task");
    const parent = await findParentInTrash(OWNER, child);
    expect(parent).toBeNull();
  });

  it("returns null when the child has no parent reference", async () => {
    memFs.set(`users/${OWNER}/lab_links/1.json`, {
      id: 1,
      title: "NCBI",
      owner: OWNER,
    });
    await trashEntity({
      owner: OWNER,
      entityType: "lab_link",
      id: 1,
      deletedBy: OWNER,
    });
    const [child] = await listTrash(OWNER, "lab_link");
    expect(child.parent_id).toBeUndefined();
    const parent = await findParentInTrash(OWNER, child);
    expect(parent).toBeNull();
  });
});
