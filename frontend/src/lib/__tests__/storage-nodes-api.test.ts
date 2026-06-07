// frontend/src/lib/__tests__/storage-nodes-api.test.ts
//
// Inventory box-finder foundation (2026-06-07). Pins the contract of
// `storageNodesApi` (the recursive `StorageNode` location tree from
// `plans/INVENTORY_DESIGN.md` §5.3) against the same in-memory file-service
// mock the inventory-api test uses.
//
// Covered: create + read of a node; the whole-lab-edit sharing default;
// cross-user routing (createForUser / getForUser / saveForUser); the
// parent_id tree links (listChildren of a parent + top-level nodes); box-dim
// fields on a `box` node; normalization of a legacy / partial record; and the
// whole-lab `fetchAllStorageNodesIncludingShared` aggregate with the
// `is_shared_with_me` overlay.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { StorageNode } from "../types";

const memFs = new Map<string, unknown>();
const listed = new Map<string, string[]>();

function trackFile(path: string): void {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const fileName = path.slice(slash + 1);
  const existing = listed.get(dir) ?? [];
  if (!existing.includes(fileName)) listed.set(dir, [...existing, fileName]);
}

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
      trackFile(path);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (path: string) => listed.get(path) ?? []),
    deleteFile: vi.fn(async (path: string) => {
      memFs.delete(path);
      return true;
    }),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

// `fetchAllStorageNodesIncludingShared` walks `discoverUsers()`.
vi.mock("../file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alex", "mira"]),
}));

import {
  storageNodesApi,
  normalizeStorageNodeRecord,
  fetchAllStorageNodesIncludingShared,
} from "../local-api";
import { clearCurrentUserCache } from "../storage/json-store";
import { WHOLE_LAB_SENTINEL } from "../sharing/unified";

beforeEach(() => {
  memFs.clear();
  listed.clear();
  clearCurrentUserCache();
});

describe("storageNodesApi — create + read", () => {
  it("creates a node under the current user and reads it back", async () => {
    const node = await storageNodesApi.create({
      name: "-80 #2",
      kind: "freezer",
      temperature: "-80 C",
    });
    expect(node.id).toBe(1);
    expect(node.name).toBe("-80 #2");
    expect(node.kind).toBe("freezer");
    expect(node.parent_id).toBeNull();
    expect(node.owner).toBe("alex");
    expect(memFs.has("users/alex/storage_nodes/1.json")).toBe(true);

    const read = await storageNodesApi.get(1);
    expect(read?.name).toBe("-80 #2");
    expect(read?.temperature).toBe("-80 C");
  });

  it("defaults kind to 'other' when omitted", async () => {
    const node = await storageNodesApi.create({ name: "Mystery cabinet" });
    expect(node.kind).toBe("other");
  });

  it("carries box grid dims on a box node", async () => {
    const box = await storageNodesApi.create({
      name: "Box: Q5 enzymes",
      kind: "box",
      box_rows: 9,
      box_cols: 9,
    });
    expect(box.kind).toBe("box");
    expect(box.box_rows).toBe(9);
    expect(box.box_cols).toBe(9);
  });

  it("defaults new records to whole-lab EDIT sharing", async () => {
    const node = await storageNodesApi.create({ name: "Shelf 3", kind: "shelf" });
    expect(node.shared_with).toEqual([
      { username: WHOLE_LAB_SENTINEL, level: "edit" },
    ]);
  });

  it("honors an explicit private shared_with (solo tree)", async () => {
    const node = await storageNodesApi.create({
      name: "Private freezer",
      kind: "freezer",
      shared_with: [],
    });
    expect(node.shared_with).toEqual([]);
  });
});

describe("storageNodesApi — parent_id tree links", () => {
  it("listChildren returns the direct children of a parent, and top-level for null", async () => {
    const freezer = await storageNodesApi.create({ name: "-80 #1", kind: "freezer" });
    const room = await storageNodesApi.create({ name: "Cold room", kind: "room" });
    const rack = await storageNodesApi.create({
      name: "Rack A",
      kind: "rack",
      parent_id: freezer.id,
    });
    const box = await storageNodesApi.create({
      name: "Box 1",
      kind: "box",
      parent_id: rack.id,
      box_rows: 10,
      box_cols: 10,
    });

    // Top-level: the freezer + the room (parent_id === null), not the nested ones.
    const top = await storageNodesApi.listChildren(null);
    expect(top.map((n) => n.id).sort()).toEqual([freezer.id, room.id].sort());

    // Children of the freezer: the rack only.
    const underFreezer = await storageNodesApi.listChildren(freezer.id);
    expect(underFreezer.map((n) => n.id)).toEqual([rack.id]);

    // Children of the rack: the box only.
    const underRack = await storageNodesApi.listChildren(rack.id);
    expect(underRack.map((n) => n.id)).toEqual([box.id]);

    // The box is a leaf.
    expect(await storageNodesApi.listChildren(box.id)).toEqual([]);
  });

  it("a node walks back up to its parent via parent_id", async () => {
    const freezer = await storageNodesApi.create({ name: "-80 #3", kind: "freezer" });
    const box = await storageNodesApi.create({
      name: "Box X",
      kind: "box",
      parent_id: freezer.id,
    });
    const readBox = await storageNodesApi.get(box.id);
    expect(readBox?.parent_id).toBe(freezer.id);
    const readParent = await storageNodesApi.get(readBox!.parent_id!);
    expect(readParent?.name).toBe("-80 #3");
  });
});

describe("storageNodesApi — update + delete", () => {
  it("updates a node and re-stamps attribution", async () => {
    const node = await storageNodesApi.create({ name: "Shelf 1", kind: "shelf" });
    const updated = await storageNodesApi.update(node.id, {
      name: "Shelf 1 (relabeled)",
      temperature: "RT",
    });
    expect(updated?.name).toBe("Shelf 1 (relabeled)");
    expect(updated?.temperature).toBe("RT");
    expect(updated?.last_edited_by).toBeTruthy();
  });

  it("update returns null for a missing id", async () => {
    expect(await storageNodesApi.update(999, { name: "nope" })).toBeNull();
  });

  it("soft-deletes a node into the trash dir", async () => {
    const node = await storageNodesApi.create({ name: "Doomed rack", kind: "rack" });
    await storageNodesApi.delete(node.id);
    // The live record is gone; a trash mirror exists under _trash/storage_nodes/.
    expect(memFs.has("users/alex/storage_nodes/1.json")).toBe(false);
    const trashed = [...memFs.keys()].some((k) =>
      k.includes("_trash") && k.includes("storage_nodes"),
    );
    expect(trashed).toBe(true);
  });
});

describe("storageNodesApi — cross-user routing", () => {
  it("createForUser bumps the target user's counter and lands in their dir", async () => {
    const node = await storageNodesApi.createForUser(
      { name: "Mira freezer", kind: "freezer" },
      "mira",
    );
    expect(node.owner).toBe("mira");
    expect(memFs.has("users/mira/storage_nodes/1.json")).toBe(true);

    const read = await storageNodesApi.getForUser(node.id, "mira");
    expect(read?.name).toBe("Mira freezer");
  });

  it("saveForUser overwrites a record in the owner's dir", async () => {
    const node = await storageNodesApi.createForUser(
      { name: "X", kind: "box" },
      "mira",
    );
    const saved = await storageNodesApi.saveForUser(
      node.id,
      { ...node, name: "X (saved)" },
      "mira",
    );
    expect(saved.name).toBe("X (saved)");
    const read = await storageNodesApi.getForUser(node.id, "mira");
    expect(read?.name).toBe("X (saved)");
  });

  it("listChildren routes into another owner's namespace", async () => {
    const freezer = await storageNodesApi.createForUser(
      { name: "Mira -80", kind: "freezer" },
      "mira",
    );
    await storageNodesApi.createForUser(
      { name: "Mira rack", kind: "rack", parent_id: freezer.id },
      "mira",
    );
    const children = await storageNodesApi.listChildren(freezer.id, "mira");
    expect(children.map((n) => n.name)).toEqual(["Mira rack"]);
  });
});

describe("fetchAllStorageNodesIncludingShared — whole-lab aggregate", () => {
  it("unions every member's shared nodes with the is_shared_with_me overlay", async () => {
    // alex (current user) creates one whole-lab-shared node; mira creates one.
    await storageNodesApi.create({ name: "Alex freezer", kind: "freezer" });
    await storageNodesApi.createForUser({ name: "Mira freezer", kind: "freezer" }, "mira");

    const all = await fetchAllStorageNodesIncludingShared();
    const mine = all.find((n) => n.name === "Alex freezer");
    const theirs = all.find((n) => n.name === "Mira freezer");

    expect(mine).toBeTruthy();
    expect(theirs).toBeTruthy();
    expect(mine?.is_shared_with_me).toBe(false);
    expect(theirs?.is_shared_with_me).toBe(true);
  });

  it("excludes another member's PRIVATE nodes from the aggregate", async () => {
    await storageNodesApi.createForUser(
      { name: "Mira private box", kind: "box", shared_with: [] },
      "mira",
    );
    const all = await fetchAllStorageNodesIncludingShared();
    expect(all.find((n) => n.name === "Mira private box")).toBeUndefined();
  });
});

describe("normalizeStorageNodeRecord — legacy / partial records", () => {
  it("back-fills missing fields without an on-disk migration", () => {
    const partial = {
      id: 7,
      name: "Old node",
      // kind, parent_id, temperature, box dims, notes, sharing all absent
    } as unknown as StorageNode;
    const norm = normalizeStorageNodeRecord(partial, "alex");
    expect(norm.kind).toBe("other");
    expect(norm.parent_id).toBeNull();
    expect(norm.temperature).toBeNull();
    expect(norm.box_rows).toBeNull();
    expect(norm.box_cols).toBeNull();
    expect(norm.notes).toBeNull();
    expect(norm.owner).toBe("alex");
    expect(norm.shared_with).toEqual([]);
    expect(norm.created_by).toBeNull();
  });

  it("preserves a populated record verbatim", () => {
    const full: StorageNode = {
      id: 3,
      name: "Box: antibodies",
      kind: "box",
      parent_id: 2,
      temperature: "-20 C",
      box_rows: 9,
      box_cols: 9,
      notes: "left drawer",
      owner: "mira",
      shared_with: [{ username: WHOLE_LAB_SENTINEL, level: "edit" }],
      created_by: "mira",
    };
    const norm = normalizeStorageNodeRecord(full);
    expect(norm).toMatchObject({
      id: 3,
      name: "Box: antibodies",
      kind: "box",
      parent_id: 2,
      box_rows: 9,
      box_cols: 9,
    });
  });
});
