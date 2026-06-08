// seq delete trash bot (2026-06-04): owner-only delete gate (OQ9) for
// `sequencesApi.delete`. Mirrors r2-owner-only-delete.test.ts. The gate must
// hold even though sequences are a two-file shape: a non-owner with no active
// PI unlock must NOT be able to trash another user's sequence.
//
// We mock `@/lib/trash` so the test observes the dispatch args without
// touching disk; `sequenceStore` is mocked so the API can resolve the live
// sidecar (existence) per id.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface TrashCall {
  owner: string;
  entityType: string;
  id: number;
  deletedBy: string;
  sessionId: string | null;
}

const trashCalls: TrashCall[] = [];

vi.mock("@/lib/trash", async () => ({
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
      return { id: args.id, _trash: { deleted_at: "2026-06-04T00:00:00.000Z" } };
    },
  ),
  restoreEntity: vi.fn(async () => null),
  restoreSequenceFromTrash: vi.fn(async () => null),
}));

vi.mock("@/lib/notes/notes-trash", () => ({
  trashNote: vi.fn(async () => null),
  restoreTrashedNote: vi.fn(async () => null),
}));

vi.mock("@/lib/sequences/sequence-store", () => ({
  sequenceStore: {
    getRawForUser: vi.fn(async () => null),
    listMetaForUser: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  },
}));

vi.mock("@/lib/storage/json-store", () => ({
  JsonStore: class {
    prefix: string;
    constructor(prefix: string) {
      this.prefix = prefix;
    }
    async get() {
      return null;
    }
    async getForUser() {
      return null;
    }
    async listAll() {
      return [];
    }
    async delete() {
      return undefined;
    }
    async create(data: unknown) {
      return data;
    }
    async update() {
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

const memFiles = new Map<string, unknown>();
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) =>
      memFiles.has(path) ? memFiles.get(path) : null,
    ),
    writeJson: vi.fn(async () => undefined),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => undefined),
    ensureDir: vi.fn(async () => null),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
    listFiles: vi.fn(async () => []),
    fileExists: vi.fn(async () => false),
  },
}));

import { sequencesApi } from "@/lib/local-api";

/** Mark the current user (alex) as a lab head for the duration of a test. */
function makeCurrentUserLabHead() {
  memFiles.set("users/alex/settings.json", { account_type: "lab_head" });
}

beforeEach(() => {
  trashCalls.length = 0;
  memFiles.clear();
});

describe("seq owner-only delete gate (OQ9): sequencesApi.delete", () => {
  it("owner self-delete proceeds (current user = owner)", async () => {
    const ok = await sequencesApi.delete(5);
    expect(ok).toBe(true);
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].entityType).toBe("sequence");
    expect(trashCalls[0].owner).toBe("alex");
    expect(trashCalls[0].deletedBy).toBe("alex");
    expect(trashCalls[0].sessionId).toBeNull();
  });

  it("lab-head cross-owner delete proceeds", async () => {
    makeCurrentUserLabHead();
    const ok = await sequencesApi.delete(6, "mira", {
      actor: "morgan",
      sessionId: "session-seq",
    });
    expect(ok).toBe(true);
    expect(trashCalls).toHaveLength(1);
    expect(trashCalls[0].owner).toBe("mira");
    expect(trashCalls[0].deletedBy).toBe("morgan");
    expect(trashCalls[0].sessionId).toBe("session-seq");
  });

  it("shared-edit user cross-owner delete is REFUSED (not a lab head)", async () => {
    const ok = await sequencesApi.delete(7, "mira", {
      actor: "alex",
      sessionId: null,
    });
    expect(ok).toBe(false);
    expect(trashCalls).toHaveLength(0);
  });

  it("non-lab-head cross-owner delete is REFUSED even with a sessionId (ACL hardening)", async () => {
    const ok = await sequencesApi.delete(8, "mira", {
      actor: "alex",
      sessionId: "lab-head-action",
    });
    expect(ok).toBe(false);
    expect(trashCalls).toHaveLength(0);
  });
});
