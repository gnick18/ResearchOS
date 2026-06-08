// ACL hardening (2026-06-08): write-path enforcement tests.
//
// Two themes, both exercising the LIBRARY layer (not the UI):
//
//   THEME A — the fetch-all-including-shared loaders must re-derive a
//   shared-in record's permission from the SOURCE record's `shared_with`
//   (owner-controlled) instead of trusting the receiver-writable
//   `_shared_with_me.json` manifest. A stale (owner downgraded edit->view)
//   or forged (receiver grants themselves edit) manifest entry must NOT let
//   the receiver edit, and a revoked record must not surface at all.
//
//   THEME B (C2) — `sharingApi.share*` must refuse to mutate `shared_with`
//   on a record the caller does not own.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task, Method, Project } from "@/lib/types";

const memFs = new Map<string, unknown>();
let currentUserMock = "morgan";

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
    listFiles: vi.fn(async () => []),
    listDirectories: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
}));

// Imports after the mocks.
import {
  fetchAllTasksIncludingShared,
  fetchAllMethodsIncludingShared,
  fetchAllProjectsIncludingShared,
  sharingApi,
  purchasesApi,
} from "@/lib/local-api";
import { clearCurrentUserCache } from "@/lib/storage/json-store";

function setCurrentUser(name: string) {
  currentUserMock = name;
  clearCurrentUserCache();
}

/** Let any `void applyManifestRepairs(...)` fire-and-forget write flush. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

function seedManifest(
  receiver: string,
  manifest: {
    tasks?: Array<{ id: number; owner: string; permission: string }>;
    projects?: Array<{ id: number; owner: string; permission: string }>;
    methods?: Array<{ id: number; owner: string; permission: string }>;
  },
) {
  memFs.set(`users/${receiver}/_shared_with_me.json`, {
    version: 1,
    tasks: manifest.tasks ?? [],
    projects: manifest.projects ?? [],
    methods: manifest.methods ?? [],
  });
}

function seedSourceTask(owner: string, id: number, shared_with: unknown[]) {
  const task = {
    id,
    project_id: 1,
    name: `task ${id}`,
    start_date: "2026-06-01",
    duration_days: 1,
    end_date: "2026-06-01",
    is_complete: false,
    task_type: "experiment",
    method_ids: [],
    method_attachments: [],
    owner,
    shared_with,
  } as unknown as Task;
  memFs.set(`users/${owner}/tasks/${id}.json`, task);
}

beforeEach(() => {
  memFs.clear();
  setCurrentUser("morgan");
});

// ── THEME A: source-of-truth permission cross-validation ────────────────

describe("Theme A: fetchAllTasksIncludingShared cross-validates against source", () => {
  it("uses the SOURCE level (view), not the manifest's stale 'edit'", async () => {
    // Manifest still claims edit; the owner has since downgraded to read.
    seedManifest("morgan", { tasks: [{ id: 5, owner: "alex", permission: "edit" }] });
    seedSourceTask("alex", 5, [{ username: "morgan", level: "read", permission: "view" }]);

    const tasks = await fetchAllTasksIncludingShared();
    const shared = tasks.find((t) => t.is_shared_with_me && t.id === 5);
    expect(shared).toBeTruthy();
    // Source says read → receiver gets view, regardless of the manifest.
    expect(shared?.shared_permission).toBe("view");

    // The stale manifest entry is repaired to "view".
    await flush();
    const repaired = memFs.get("users/morgan/_shared_with_me.json") as {
      tasks: Array<{ id: number; permission: string }>;
    };
    expect(repaired.tasks[0].permission).toBe("view");
  });

  it("does NOT surface a task the source has revoked, and prunes the manifest", async () => {
    seedManifest("morgan", { tasks: [{ id: 6, owner: "alex", permission: "edit" }] });
    // Source no longer shares with morgan at all.
    seedSourceTask("alex", 6, []);

    const tasks = await fetchAllTasksIncludingShared();
    expect(tasks.find((t) => t.is_shared_with_me && t.id === 6)).toBeUndefined();

    await flush();
    const repaired = memFs.get("users/morgan/_shared_with_me.json") as {
      tasks: unknown[];
    };
    expect(repaired.tasks).toHaveLength(0);
  });

  it("does NOT honor a forged manifest 'edit' when the source grants only read", async () => {
    // Receiver hand-edited their own manifest to grant themselves edit.
    seedManifest("morgan", { tasks: [{ id: 7, owner: "alex", permission: "edit" }] });
    seedSourceTask("alex", 7, [{ username: "morgan", level: "read" }]);

    const tasks = await fetchAllTasksIncludingShared();
    const shared = tasks.find((t) => t.is_shared_with_me && t.id === 7);
    expect(shared?.shared_permission).toBe("view");
  });

  it("preserves a legitimate edit share (source grants edit)", async () => {
    seedManifest("morgan", { tasks: [{ id: 8, owner: "alex", permission: "edit" }] });
    seedSourceTask("alex", 8, [{ username: "morgan", level: "edit", permission: "edit" }]);

    const tasks = await fetchAllTasksIncludingShared();
    const shared = tasks.find((t) => t.is_shared_with_me && t.id === 8);
    expect(shared?.shared_permission).toBe("edit");
  });

  it("honors the whole-lab '*' edit sentinel from the source", async () => {
    seedManifest("morgan", { tasks: [{ id: 9, owner: "alex", permission: "view" }] });
    seedSourceTask("alex", 9, [{ username: "*", level: "edit", permission: "edit" }]);

    const tasks = await fetchAllTasksIncludingShared();
    const shared = tasks.find((t) => t.is_shared_with_me && t.id === 9);
    // Manifest said view, but the source "*" grants edit lab-wide.
    expect(shared?.shared_permission).toBe("edit");
  });
});

describe("Theme A: fetchAllMethodsIncludingShared cross-validates against source", () => {
  it("downgrades a stale manifest 'edit' to the source 'view'", async () => {
    seedManifest("morgan", { methods: [{ id: 3, owner: "alex", permission: "edit" }] });
    memFs.set("users/alex/methods/3.json", {
      id: 3,
      name: "qPCR",
      owner: "alex",
      shared_with: [{ username: "morgan", level: "read" }],
    } as unknown as Method);

    const methods = await fetchAllMethodsIncludingShared();
    const shared = methods.find((m) => m.is_shared_with_me && m.id === 3);
    expect(shared?.shared_permission).toBe("view");
  });

  it("drops a revoked shared method", async () => {
    seedManifest("morgan", { methods: [{ id: 4, owner: "alex", permission: "edit" }] });
    memFs.set("users/alex/methods/4.json", {
      id: 4,
      name: "Western",
      owner: "alex",
      shared_with: [],
    } as unknown as Method);

    const methods = await fetchAllMethodsIncludingShared();
    expect(methods.find((m) => m.is_shared_with_me && m.id === 4)).toBeUndefined();
  });
});

describe("Theme A: fetchAllProjectsIncludingShared cross-validates against source", () => {
  it("downgrades a stale manifest 'edit' to the source 'view'", async () => {
    seedManifest("morgan", { projects: [{ id: 2, owner: "alex", permission: "edit" }] });
    memFs.set("users/alex/projects/2.json", {
      id: 2,
      name: "Shared project",
      owner: "alex",
      shared_with: [{ username: "morgan", level: "read" }],
    } as unknown as Project);

    const projects = await fetchAllProjectsIncludingShared();
    const shared = projects.find((p) => p.is_shared_with_me && p.id === 2);
    expect(shared?.shared_permission).toBe("view");
  });

  it("drops a revoked shared project", async () => {
    seedManifest("morgan", { projects: [{ id: 3, owner: "alex", permission: "edit" }] });
    memFs.set("users/alex/projects/3.json", {
      id: 3,
      name: "Revoked project",
      owner: "alex",
      shared_with: [],
    } as unknown as Project);

    const projects = await fetchAllProjectsIncludingShared();
    expect(projects.find((p) => p.is_shared_with_me && p.id === 3)).toBeUndefined();
  });
});

// ── THEME B (C2): ownership guard on sharingApi.share* ──────────────────

describe("Theme B (C2): sharingApi ownership guards", () => {
  it("shareTask refuses when the record is owned by someone else", async () => {
    // A task sitting in morgan's folder but stamped as owned by alex.
    seedSourceTask("morgan", 11, []);
    const forged = memFs.get("users/morgan/tasks/11.json") as Task;
    (forged as unknown as { owner: string }).owner = "alex";

    await expect(
      sharingApi.shareTask(11, { username: "bob", level: "edit" }),
    ).rejects.toThrow(/cannot change sharing/i);
    // shared_with was never mutated.
    const after = memFs.get("users/morgan/tasks/11.json") as Task;
    expect(after.shared_with).toEqual([]);
  });

  it("shareTask succeeds for a task the current user owns", async () => {
    seedSourceTask("morgan", 12, []);
    const res = await sharingApi.shareTask(12, { username: "bob", level: "edit" });
    expect(res.status).toBe("ok");
    const after = memFs.get("users/morgan/tasks/12.json") as Task;
    expect(after.shared_with?.some((s) => s.username === "bob")).toBe(true);
  });

  it("shareProject refuses a record owned by someone else", async () => {
    memFs.set("users/morgan/projects/20.json", {
      id: 20,
      name: "Not mine",
      owner: "alex",
      shared_with: [],
    } as unknown as Project);
    await expect(
      sharingApi.shareProject(20, { username: "bob", level: "edit" }),
    ).rejects.toThrow(/cannot change sharing/i);
  });

  it("shareMethod refuses a record owned by someone else", async () => {
    memFs.set("users/morgan/methods/30.json", {
      id: 30,
      name: "Not mine",
      owner: "alex",
      shared_with: [],
    } as unknown as Method);
    await expect(
      sharingApi.shareMethod(30, { username: "bob", level: "edit" }),
    ).rejects.toThrow(/cannot change sharing/i);
  });

  it("shareLink refuses a record owned by someone else", async () => {
    memFs.set("users/morgan/lab_links/40.json", {
      id: 40,
      title: "Not mine",
      url: "https://example.com",
      owner: "alex",
      shared_with: [],
    });
    await expect(
      sharingApi.shareLink(40, [{ username: "bob", level: "edit" }]),
    ).rejects.toThrow(/cannot change sharing/i);
  });

  it("shareGoal refuses a record owned by someone else", async () => {
    memFs.set("users/morgan/goals/50.json", {
      id: 50,
      name: "Not mine",
      owner: "alex",
      shared_with: [],
      smart_goals: [],
    });
    await expect(
      sharingApi.shareGoal(50, [{ username: "bob", level: "edit" }]),
    ).rejects.toThrow(/cannot change sharing/i);
  });
});

// ── Theme B (C5): purchasesApi.update cross-owner gate ──────────────────

describe("Theme B (C5): purchasesApi.update cross-owner gate", () => {
  function seedPurchase(owner: string, id: number) {
    memFs.set(`users/${owner}/purchase_items/${id}.json`, {
      id,
      task_id: 1,
      item_name: `item ${id}`,
      quantity: 1,
      price_per_unit: 10,
      shipping_fees: 0,
      total_price: 10,
      approved: false,
    });
  }

  it("refuses a cross-owner write when the current user is not a lab head", async () => {
    seedPurchase("alex", 60);
    await expect(
      purchasesApi.update(60, { item_name: "hacked" }, "alex"),
    ).rejects.toThrow(/not a lab head/i);
    const after = memFs.get("users/alex/purchase_items/60.json") as { item_name: string };
    expect(after.item_name).toBe("item 60");
  });

  it("allows a cross-owner write when the current user IS a lab head", async () => {
    memFs.set("users/morgan/settings.json", { account_type: "lab_head" });
    seedPurchase("alex", 61);
    const res = await purchasesApi.update(61, { item_name: "approved edit" }, "alex");
    expect(res?.item_name).toBe("approved edit");
  });

  it("allows an own-record write (no owner arg) regardless of role", async () => {
    seedPurchase("morgan", 62);
    const res = await purchasesApi.update(62, { item_name: "my edit" });
    expect(res?.item_name).toBe("my edit");
  });
});
