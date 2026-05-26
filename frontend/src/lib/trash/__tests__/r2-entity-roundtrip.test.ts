// VCP R2 trash everywhere (2026-05-26): per-entity round-trip tests for
// the 7 entity types wired in R2 (notes already covered in trash.test.ts).
//
// Each test exercises: delete → verify in trash → restore → verify back
// at the live `original_path`. Tests run against the in-memory `memFs`
// double the R1 tests established.

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

import {
  trashEntity,
  restoreEntity,
  listTrash,
  readTrashIndex,
  type TrashEntityType,
} from "..";

const OWNER = "mira";

function findTrashFileFor(
  entityType: TrashEntityType,
  id: number,
): string | undefined {
  const dirName =
    entityType === "high_level_goal"
      ? "high_level_goals"
      : entityType === "lab_link"
        ? "lab_links"
        : entityType === "mass_spec_protocol"
          ? "mass_spec_protocols"
          : entityType === "purchase_item"
            ? "purchase_items"
            : entityType === "note"
              ? "notes"
              : `${entityType}s`;
  const prefix = `users/${OWNER}/_trash/${dirName}/${id}-`;
  for (const key of memFs.keys()) {
    if (key.startsWith(prefix) && key.endsWith(".json")) return key;
  }
  return undefined;
}

beforeEach(() => {
  memFs.clear();
});

describe("R2: per-entity round-trip", () => {
  const ENTITY_FIXTURES: Array<{
    entityType: TrashEntityType;
    liveDir: string;
    name: string;
    extra?: Record<string, unknown>;
  }> = [
    {
      entityType: "task",
      liveDir: "tasks",
      name: "PCR Day 1",
      extra: { project_id: 10, owner: OWNER },
    },
    {
      entityType: "method",
      liveDir: "methods",
      name: "Site-directed mutagenesis",
      extra: { owner: OWNER, parent_method_id: null },
    },
    {
      entityType: "project",
      liveDir: "projects",
      name: "Aspergillus Genome",
      extra: { owner: OWNER, is_archived: false },
    },
    {
      entityType: "purchase_item",
      liveDir: "purchase_items",
      name: "Taq polymerase",
      extra: { task_id: 5 },
    },
    {
      entityType: "high_level_goal",
      // NOTE: live path is `goals/`, not `high_level_goals/` — store
      // prefix mismatch.
      liveDir: "goals",
      name: "Submit grant",
      extra: { project_id: 7 },
    },
    {
      entityType: "lab_link",
      liveDir: "lab_links",
      name: "NCBI BLAST",
      extra: { owner: OWNER },
    },
    {
      entityType: "mass_spec_protocol",
      // NOTE: live path is `mass_spec_methods/`, not `mass_spec_protocols/`.
      liveDir: "mass_spec_methods",
      name: "Q-Exactive ESI+",
      extra: { owner: OWNER },
    },
  ];

  for (const fixture of ENTITY_FIXTURES) {
    it(`${fixture.entityType}: delete + restore round-trip`, async () => {
      const id = 42;
      const live = { id, name: fixture.name, ...fixture.extra };
      memFs.set(`users/${OWNER}/${fixture.liveDir}/${id}.json`, live);

      const trashed = await trashEntity({
        owner: OWNER,
        entityType: fixture.entityType,
        id,
        deletedBy: OWNER,
      });

      expect(trashed).not.toBeNull();
      expect(trashed?._trash.deleted_by).toBe(OWNER);
      // Live file is gone.
      expect(memFs.has(`users/${OWNER}/${fixture.liveDir}/${id}.json`)).toBe(
        false,
      );
      // Trash file landed at the right subdir + filename includes the id.
      expect(findTrashFileFor(fixture.entityType, id)).toBeDefined();

      // Index has the entry.
      const index = await readTrashIndex(OWNER);
      expect(
        index.entries.some(
          (e) => e.entity_type === fixture.entityType && e.id === id,
        ),
      ).toBe(true);

      const restored = await restoreEntity(OWNER, fixture.entityType, id);
      expect(restored).not.toBeNull();
      // Restored record matches the original (no _trash block).
      expect(restored).toEqual(live);
      // Trash file is gone.
      expect(findTrashFileFor(fixture.entityType, id)).toBeUndefined();
      // Live file is back.
      expect(memFs.has(`users/${OWNER}/${fixture.liveDir}/${id}.json`)).toBe(
        true,
      );
    });
  }
});

describe("R2: parent reference captured on trash entry", () => {
  it("task trash entry records project_id as parent_id", async () => {
    memFs.set(`users/${OWNER}/tasks/100.json`, {
      id: 100,
      name: "task",
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
    const entries = await listTrash(OWNER, "task");
    expect(entries).toHaveLength(1);
    expect(entries[0].parent_id).toBe(55);
    expect(entries[0].parent_entity_type).toBe("project");
  });

  it("purchase_item trash entry records task_id as parent_id", async () => {
    memFs.set(`users/${OWNER}/purchase_items/77.json`, {
      id: 77,
      item_name: "Reagent X",
      task_id: 33,
    });
    await trashEntity({
      owner: OWNER,
      entityType: "purchase_item",
      id: 77,
      deletedBy: OWNER,
      parent: { parent_id: 33, parent_entity_type: "task" },
    });
    const entries = await listTrash(OWNER, "purchase_item");
    expect(entries).toHaveLength(1);
    expect(entries[0].parent_id).toBe(33);
    expect(entries[0].parent_entity_type).toBe("task");
  });

  it("project trash preserves is_archived field across round-trip (§3h)", async () => {
    memFs.set(`users/${OWNER}/projects/9.json`, {
      id: 9,
      name: "Archived then trashed",
      is_archived: true,
      archived_at: "2026-05-20T00:00:00.000Z",
      owner: OWNER,
    });
    await trashEntity({
      owner: OWNER,
      entityType: "project",
      id: 9,
      deletedBy: OWNER,
    });
    const restored = await restoreEntity<{
      id: number;
      is_archived: boolean;
      archived_at: string | null;
    }>(OWNER, "project", 9);
    expect(restored?.is_archived).toBe(true);
    expect(restored?.archived_at).toBe("2026-05-20T00:00:00.000Z");
  });
});
