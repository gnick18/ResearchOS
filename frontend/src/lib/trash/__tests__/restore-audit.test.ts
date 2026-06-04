// restore audit bot (2026-06-04): tests for the two restore-time niceties.
//
//   Part 1 — name disambiguation on a LIVE collision. A restored record whose
//            display name already belongs to a live record of the same type is
//            renamed " (restored)", then " (restored 2)", " (restored 3)" ... No
//            collision means the name is left untouched. ONLY the name field
//            changes; id + content stay byte-faithful.
//
//   Part 2 — the deleted/restored audit. Every restored record (all types) gets
//            a `_restore_audit` blob carrying the delete attribution forward from
//            the trash entry (deleted_at / deleted_by) plus restored_at /
//            restored_by captured at restore time.
//
// Runs against the same in-memory `memFs` double the other R2 tests use.

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
    writeText: vi.fn(async (path: string, data: string) => {
      memFs.set(path, data);
    }),
    readText: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return typeof v === "string" ? v : null;
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
  RESTORE_AUDIT_FIELD,
  type RestoreAudit,
} from "..";

const OWNER = "mira";

beforeEach(() => {
  memFs.clear();
});

/** Trash then restore a single record of `entityType`, returning the restored
 *  live record. The live record is seeded at `{liveDir}/{id}.json`. */
async function trashAndRestore<T extends Record<string, unknown>>(
  entityType: Parameters<typeof restoreEntity>[1],
  liveDir: string,
  id: number,
  live: T,
  restoredBy = OWNER,
): Promise<Record<string, unknown> | null> {
  memFs.set(`users/${OWNER}/${liveDir}/${id}.json`, { id, ...live });
  await trashEntity({ owner: OWNER, entityType, id, deletedBy: "alex" });
  return (await restoreEntity(OWNER, entityType, id, restoredBy)) as Record<
    string,
    unknown
  > | null;
}

describe("Part 1 — name disambiguation on restore-collision", () => {
  it("no collision: keeps the original name unchanged", async () => {
    const restored = await trashAndRestore("method", "methods", 1, {
      name: "Gibson assembly",
    });
    expect(restored?.name).toBe("Gibson assembly");
  });

  it("one live collision: appends ' (restored)'", async () => {
    // A LIVE method already owns the name the trashed one will restore to.
    memFs.set(`users/${OWNER}/methods/99.json`, {
      id: 99,
      name: "Gibson assembly",
    });
    const restored = await trashAndRestore("method", "methods", 1, {
      name: "Gibson assembly",
    });
    expect(restored?.name).toBe("Gibson assembly (restored)");
  });

  it("two live collisions: appends ' (restored 2)'", async () => {
    memFs.set(`users/${OWNER}/methods/99.json`, {
      id: 99,
      name: "Gibson assembly",
    });
    memFs.set(`users/${OWNER}/methods/98.json`, {
      id: 98,
      name: "Gibson assembly (restored)",
    });
    const restored = await trashAndRestore("method", "methods", 1, {
      name: "Gibson assembly",
    });
    expect(restored?.name).toBe("Gibson assembly (restored 2)");
  });

  it("three live collisions: appends ' (restored 3)'", async () => {
    memFs.set(`users/${OWNER}/methods/99.json`, { id: 99, name: "Plasmid prep" });
    memFs.set(`users/${OWNER}/methods/98.json`, {
      id: 98,
      name: "Plasmid prep (restored)",
    });
    memFs.set(`users/${OWNER}/methods/97.json`, {
      id: 97,
      name: "Plasmid prep (restored 2)",
    });
    const restored = await trashAndRestore("method", "methods", 1, {
      name: "Plasmid prep",
    });
    expect(restored?.name).toBe("Plasmid prep (restored 3)");
  });

  it("honours the per-type name field: note title", async () => {
    memFs.set(`users/${OWNER}/notes/99.json`, { id: 99, title: "PCR setup" });
    const restored = await trashAndRestore("note", "notes", 1, {
      title: "PCR setup",
    });
    expect(restored?.title).toBe("PCR setup (restored)");
  });

  it("honours the per-type name field: purchase_item item_name", async () => {
    memFs.set(`users/${OWNER}/purchase_items/99.json`, {
      id: 99,
      item_name: "Taq polymerase",
    });
    const restored = await trashAndRestore("purchase_item", "purchase_items", 1, {
      item_name: "Taq polymerase",
    });
    expect(restored?.item_name).toBe("Taq polymerase (restored)");
  });
});

describe("Part 2 — deleted/restored audit stamped on restore", () => {
  it("stamps restored_at/by and carries deleted_at/by forward", async () => {
    const before = Date.now();
    const restored = await trashAndRestore(
      "method",
      "methods",
      5,
      { name: "Western blot" },
      "casey",
    );
    const after = Date.now();

    const audit = (restored as Record<string, unknown>)[
      RESTORE_AUDIT_FIELD
    ] as RestoreAudit;
    expect(audit).toBeDefined();
    // Carried from the trash entry (deletedBy was "alex").
    expect(audit.deleted_by).toBe("alex");
    expect(typeof audit.deleted_at).toBe("string");
    expect(Number.isNaN(Date.parse(audit.deleted_at))).toBe(false);
    // Captured at restore time.
    expect(audit.restored_by).toBe("casey");
    const restoredMs = Date.parse(audit.restored_at);
    expect(restoredMs).toBeGreaterThanOrEqual(before);
    expect(restoredMs).toBeLessThanOrEqual(after);
  });

  it("restored_by defaults to the owner when not provided", async () => {
    memFs.set(`users/${OWNER}/tasks/3.json`, { id: 3, name: "Day 1" });
    await trashEntity({ owner: OWNER, entityType: "task", id: 3, deletedBy: OWNER });
    const restored = (await restoreEntity(OWNER, "task", 3)) as Record<
      string,
      unknown
    >;
    const audit = restored[RESTORE_AUDIT_FIELD] as RestoreAudit;
    expect(audit.restored_by).toBe(OWNER);
  });
});

describe("Round-trip stays byte-faithful for content (only name + audit added)", () => {
  it("preserves every other field across delete + restore", async () => {
    const live = {
      id: 7,
      name: "Aspergillus Genome",
      is_archived: true,
      archived_at: "2026-05-20T00:00:00.000Z",
      owner: OWNER,
      shared_with: [{ username: "alex", role: "editor" }],
      tags: ["genomics", "fungal"],
    };
    memFs.set(`users/${OWNER}/projects/7.json`, live);
    await trashEntity({ owner: OWNER, entityType: "project", id: 7, deletedBy: OWNER });
    const restored = (await restoreEntity(OWNER, "project", 7)) as Record<
      string,
      unknown
    >;

    // No collision, so the name is untouched.
    expect(restored.name).toBe("Aspergillus Genome");
    // Every content field round-trips verbatim.
    expect(restored.is_archived).toBe(true);
    expect(restored.archived_at).toBe("2026-05-20T00:00:00.000Z");
    expect(restored.owner).toBe(OWNER);
    expect(restored.shared_with).toEqual([{ username: "alex", role: "editor" }]);
    expect(restored.tags).toEqual(["genomics", "fungal"]);
    // The ONLY additions are the audit blob and (here) no rename.
    expect(restored[RESTORE_AUDIT_FIELD]).toBeDefined();
    // No `_trash` block leaks back onto the live record.
    expect(restored._trash).toBeUndefined();
  });
});
