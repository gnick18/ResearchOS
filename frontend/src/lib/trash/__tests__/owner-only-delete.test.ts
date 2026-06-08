// VCP R1 trash MVP notes (2026-05-26): defense-in-depth check that the
// notesApi.delete entry point refuses cross-owner deletes.
//
// ACL hardening (2026-06-08): the gate no longer trusts a non-null sessionId
// (the removed PI edit-session). A cross-owner delete now requires the live
// process viewer to be a lab head, resolved from the current user's seeded
// settings.json account_type.

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

import { notesApi } from "@/lib/local-api";

/** Mark the current user (alex) as a lab head for the duration of a test. */
function makeCurrentUserLabHead() {
  memFiles.set("users/alex/settings.json", { account_type: "lab_head" });
}

beforeEach(() => {
  trashedCalls.length = 0;
  memFiles.clear();
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

  it("lab-head cross-owner delete proceeds", async () => {
    makeCurrentUserLabHead();
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

  it("shared-edit user cross-owner delete is refused (not a lab head)", async () => {
    await notesApi.delete(3, "mira", { actor: "alex", sessionId: null });
    expect(trashedCalls).toHaveLength(0);
  });

  it("non-lab-head cross-owner delete is refused even with a sessionId (ACL hardening)", async () => {
    await notesApi.delete(4, "mira", { actor: "alex", sessionId: "lab-head-action" });
    expect(trashedCalls).toHaveLength(0);
  });
});
