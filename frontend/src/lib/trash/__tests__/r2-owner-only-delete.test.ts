// VCP R2 trash everywhere (2026-05-26): owner-only delete gate tests
// for the 7 entity APIs wired in R2 (notes test sits in
// owner-only-delete.test.ts already).
//
// ACL hardening (2026-06-08): the cross-owner delete contract changed. The
// gate used to treat any non-null `sessionId` as authorization (the PI
// edit-session). That bypass was removed — a cross-owner delete now requires
// the live process viewer to actually be a lab head. These tests drive the new
// contract by seeding the current user's `settings.json` account_type.
//
// Each test exercises the OQ9 contract at the API layer:
//   - Owner self-delete (actor === owner) proceeds.
//   - Cross-owner delete proceeds only when the current user is a lab head.
//   - A non-lab-head cross-owner delete is refused regardless of sessionId.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface TrashCall {
  owner: string;
  entityType: string;
  id: number;
  deletedBy: string;
  sessionId: string | null;
}

const trashCalls: TrashCall[] = [];

vi.mock("@/lib/trash", async () => {
  return {
    trashEntity: vi.fn(
      async (args: {
        owner: string;
        entityType: string;
        id: number;
        deletedBy: string;
        sessionId?: string | null;
      }) => {
        trashCalls.push({
          owner: args.owner,
          entityType: args.entityType,
          id: args.id,
          deletedBy: args.deletedBy,
          sessionId: args.sessionId ?? null,
        });
        return { id: args.id, _trash: { deleted_at: "2026-05-26T00:00:00.000Z" } };
      },
    ),
    restoreEntity: vi.fn(async () => null),
  };
});

vi.mock("@/lib/notes/notes-trash", () => ({
  trashNote: vi.fn(async () => null),
  restoreTrashedNote: vi.fn(async () => null),
}));

const memJson = new Map<string, unknown>();
vi.mock("@/lib/storage/json-store", () => ({
  // Minimal in-memory JsonStore stand-in. R2 deletes do a `.get(id)` to
  // resolve the owner from the on-disk record (when applicable). The
  // stub returns whatever the test seeded via `seedRecord`.
  JsonStore: class {
    prefix: string;
    constructor(prefix: string) {
      this.prefix = prefix;
    }
    async get(id: number) {
      return memJson.get(`${this.prefix}:${id}`) ?? null;
    }
    async getForUser(id: number, owner: string) {
      return memJson.get(`${owner}/${this.prefix}:${id}`) ?? null;
    }
    async listAll() {
      return [];
    }
    async delete() {
      return undefined;
    }
    async deleteForUser() {
      return undefined;
    }
    async update() {
      return null;
    }
    async updateForUser() {
      return null;
    }
    async create(data: unknown) {
      return data;
    }
    async createForUser(data: unknown) {
      return data;
    }
    async save() {
      return null;
    }
    async query() {
      return [];
    }
    async listAllForUser() {
      return [];
    }
  },
  getPublicStore: () => ({
    get: async () => null,
    listAll: async () => [],
    delete: async () => undefined,
    create: async (d: unknown) => d,
    update: async () => null,
  }),
  getLabStore: () => ({
    get: async () => null,
    listAll: async () => [],
    delete: async () => undefined,
    create: async (d: unknown) => d,
    update: async () => null,
  }),
  getCurrentUserCached: vi.fn(async () => "alex"),
  clearCurrentUserCache: vi.fn(),
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
  getMainUser: vi.fn(async () => "alex"),
  storeCurrentUser: vi.fn(),
  storeMainUser: vi.fn(),
  clearCurrentUser: vi.fn(),
  clearMainUser: vi.fn(),
}));

// Path-aware file mock so `buildCurrentViewer()` can resolve the current
// user's account_type from a seeded `settings.json`. Everything else returns
// null (the delete paths tolerate missing sidecars).
const memFiles = new Map<string, unknown>();
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) =>
      memFiles.has(path) ? memFiles.get(path) : null,
    ),
    writeJson: vi.fn(async () => undefined),
    ensureDir: vi.fn(async () => null),
    deleteFile: vi.fn(async () => true),
    deleteDirectory: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
    listFiles: vi.fn(async () => []),
    fileExists: vi.fn(async () => false),
  },
}));

/** Mark the current user (alex) as a lab head for the duration of a test. */
function makeCurrentUserLabHead() {
  memFiles.set("users/alex/settings.json", { account_type: "lab_head" });
}

import {
  tasksApi,
  methodsApi,
  projectsApi,
  goalsApi,
  labLinksApi,
  purchasesApi,
  massSpecApi,
} from "@/lib/local-api";

function seedRecord(prefix: string, id: number, record: unknown) {
  memJson.set(`${prefix}:${id}`, record);
}

beforeEach(() => {
  trashCalls.length = 0;
  memJson.clear();
  memFiles.clear();
});

describe("R2 owner-only gate (OQ9): tasksApi.delete", () => {
  it("owner self-delete proceeds", async () => {
    seedRecord("tasks", 1, { id: 1, owner: "alex", project_id: 3 });
    await tasksApi.delete(1);
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].entityType).toBe("task");
    expect(trashCalls[0].deletedBy).toBe("alex");
  });

  it("lab-head cross-owner delete proceeds", async () => {
    makeCurrentUserLabHead();
    seedRecord("tasks", 2, { id: 2, owner: "mira", project_id: 9 });
    await tasksApi.delete(2, { actor: "morgan", sessionId: "session-xyz" });
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].owner).toBe("mira");
    expect(trashCalls[0].deletedBy).toBe("morgan");
    expect(trashCalls[0].sessionId).toBe("session-xyz");
  });

  it("shared-edit user cross-owner delete is refused", async () => {
    seedRecord("tasks", 3, { id: 3, owner: "mira", project_id: 9 });
    await tasksApi.delete(3, { actor: "alex", sessionId: null });
    expect(trashCalls).toHaveLength(0);
  });

  it("non-lab-head cross-owner delete is refused even with a sessionId (ACL hardening)", async () => {
    // The current user (alex) is NOT a lab head; the sentinel sessionId must
    // no longer grant a cross-owner delete for free.
    seedRecord("tasks", 4, { id: 4, owner: "mira", project_id: 9 });
    await tasksApi.delete(4, { actor: "alex", sessionId: "lab-head-action" });
    expect(trashCalls).toHaveLength(0);
  });
});

describe("R2 owner-only gate (OQ9): methodsApi.delete", () => {
  it("owner self-delete proceeds", async () => {
    seedRecord("methods", 1, { id: 1, owner: "alex" });
    await methodsApi.delete(1);
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].entityType).toBe("method");
  });

  it("shared-edit cross-owner delete is refused", async () => {
    seedRecord("methods", 2, { id: 2, owner: "mira" });
    await methodsApi.delete(2, { actor: "alex", sessionId: null });
    expect(trashCalls).toHaveLength(0);
  });
});

describe("R2 owner-only gate (OQ9): projectsApi.delete", () => {
  it("owner self-delete proceeds", async () => {
    await projectsApi.delete(7);
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].entityType).toBe("project");
    expect(trashCalls[0].owner).toBe("alex");
  });

  it("lab-head cross-owner delete proceeds", async () => {
    // projectsApi.delete routes to the current user's folder (currentUser =
    // "alex"); a cross-owner attribution (actor "morgan") is allowed only
    // because alex is a lab head here.
    makeCurrentUserLabHead();
    await projectsApi.delete(8, { actor: "morgan", sessionId: "sess-1" });
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].sessionId).toBe("sess-1");
  });
});

describe("R2 owner-only gate (OQ9): goalsApi.delete + labLinksApi.delete", () => {
  it("goalsApi.delete: owner self-delete proceeds", async () => {
    seedRecord("goals", 1, { id: 1, project_id: 4 });
    await goalsApi.delete(1);
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].entityType).toBe("high_level_goal");
  });

  it("labLinksApi.delete: shared-edit cross-owner refused", async () => {
    seedRecord("lab_links", 1, { id: 1, owner: "mira" });
    await labLinksApi.delete(1, { actor: "alex", sessionId: null });
    expect(trashCalls).toHaveLength(0);
  });
});

describe("R2 owner-only gate (OQ9): purchasesApi.delete + massSpecApi.delete", () => {
  it("purchasesApi.delete: owner self-delete proceeds", async () => {
    seedRecord("purchase_items", 1, { id: 1, task_id: 5 });
    await purchasesApi.delete(1);
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].entityType).toBe("purchase_item");
  });

  it("massSpecApi.delete: lab-head cross-owner attribution", async () => {
    makeCurrentUserLabHead();
    seedRecord("mass_spec_methods", 1, { id: 1, owner: "mira" });
    await massSpecApi.delete(1, { actor: "morgan", sessionId: "session-mass" });
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].deletedBy).toBe("morgan");
    expect(trashCalls[0].sessionId).toBe("session-mass");
  });
});
