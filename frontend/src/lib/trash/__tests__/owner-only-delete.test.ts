// VCP R1 trash MVP notes (2026-05-26): defense-in-depth check that the
// notesApi.delete entry point refuses cross-owner deletes without an
// active Phase 5 session id (OQ9).

import { beforeEach, describe, expect, it, vi } from "vitest";

const trashedCalls: Array<{
  owner: string;
  id: number;
  actor: string;
  sessionId: string | null;
}> = [];

vi.mock("@/lib/notes/notes-trash", () => ({
  trashNote: vi.fn(
    async (
      owner: string,
      id: number,
      opts?: { actor?: string; sessionId?: string | null },
    ) => {
      trashedCalls.push({
        owner,
        id,
        actor: opts?.actor ?? owner,
        sessionId: opts?.sessionId ?? null,
      });
      return { id, deleted_at: "2026-05-26T00:00:00.000Z" };
    },
  ),
  restoreTrashedNote: vi.fn(async () => null),
}));

vi.mock("@/lib/storage/json-store", () => ({
  JsonStore: class {},
  getPublicStore: vi.fn(),
  getLabStore: vi.fn(),
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

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async () => null),
    writeJson: vi.fn(async () => undefined),
    ensureDir: vi.fn(async () => null),
    deleteFile: vi.fn(async () => true),
    deleteDirectory: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
    listFiles: vi.fn(async () => []),
    fileExists: vi.fn(async () => false),
  },
}));

import { notesApi } from "@/lib/local-api";

beforeEach(() => {
  trashedCalls.length = 0;
});

describe("notesApi.delete owner-only gate (OQ9)", () => {
  it("owner self-delete proceeds (actor === owner)", async () => {
    await notesApi.delete(1, "alex", { actor: "alex" });
    expect(trashedCalls).toHaveLength(1);
    expect(trashedCalls[0]).toEqual({
      owner: "alex",
      id: 1,
      actor: "alex",
      sessionId: null,
    });
  });

  it("PI cross-owner delete proceeds when sessionId is present", async () => {
    await notesApi.delete(2, "mira", {
      actor: "morgan",
      sessionId: "session-xyz",
    });
    expect(trashedCalls).toHaveLength(1);
    expect(trashedCalls[0]).toEqual({
      owner: "mira",
      id: 2,
      actor: "morgan",
      sessionId: "session-xyz",
    });
  });

  it("shared-edit user cross-owner delete is refused (no session)", async () => {
    await notesApi.delete(3, "mira", { actor: "alex", sessionId: null });
    expect(trashedCalls).toHaveLength(0);
  });
});
