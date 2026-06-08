// Tests for lab-sync-manifest-store.ts.
//
// Covers:
//   - load(): reads from the correct per-owner path; returns {} on null.
//   - save(): writes to the correct per-owner path with the given manifest.
//
// fileService is mocked so no filesystem handle is required.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the file-service module so no real FSA handle is required.
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (_path: string) => null),
    writeJson: vi.fn(async (_path: string, _data: unknown) => undefined),
  },
}));

// Import AFTER the mock is registered.
import { fileService } from "@/lib/file-system/file-service";
import {
  createFileServiceManifestStore,
  LAB_SYNC_MANIFEST_FILE,
} from "../lab-sync-manifest-store";
import type { LabSyncManifest } from "../lab-sync";

// Typed helpers to access mock call arguments without unsafe any-casts.
const mockReadJson = fileService.readJson as ReturnType<typeof vi.fn>;
const mockWriteJson = fileService.writeJson as ReturnType<typeof vi.fn>;

describe("createFileServiceManifestStore", () => {
  const store = createFileServiceManifestStore();
  const owner = "alice";
  const expectedPath = `users/${owner}/${LAB_SYNC_MANIFEST_FILE}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // load()
  // ---------------------------------------------------------------------------

  describe("load()", () => {
    it("reads from the correct per-owner path", async () => {
      const fixture: LabSyncManifest = { "lab1/alice/task/t1": "abc123" };
      mockReadJson.mockResolvedValueOnce(fixture);

      const result = await store.load(owner);

      expect(mockReadJson).toHaveBeenCalledOnce();
      expect(mockReadJson.mock.calls[0][0]).toBe(expectedPath);
      expect(result).toEqual(fixture);
    });

    it("returns {} when readJson returns null (first-run semantics)", async () => {
      mockReadJson.mockResolvedValueOnce(null);

      const result = await store.load(owner);

      expect(result).toEqual({});
    });

    it("returns {} when readJson returns undefined (treated as null)", async () => {
      mockReadJson.mockResolvedValueOnce(undefined);

      const result = await store.load(owner);

      expect(result).toEqual({});
    });

    it("uses owner-namespaced paths (two owners produce different paths)", async () => {
      mockReadJson.mockResolvedValue(null);

      await store.load("alice");
      await store.load("bob");

      const calls = mockReadJson.mock.calls as [string][];
      expect(calls[0][0]).toBe(`users/alice/${LAB_SYNC_MANIFEST_FILE}`);
      expect(calls[1][0]).toBe(`users/bob/${LAB_SYNC_MANIFEST_FILE}`);
    });
  });

  // ---------------------------------------------------------------------------
  // save()
  // ---------------------------------------------------------------------------

  describe("save()", () => {
    it("writes to the correct per-owner path with the given manifest", async () => {
      const manifest: LabSyncManifest = {
        "lab1/alice/task/t1": "deadbeef",
        "lab1/alice/note/n2": "cafebabe",
      };

      await store.save(owner, manifest);

      expect(mockWriteJson).toHaveBeenCalledOnce();
      const [path, data] = mockWriteJson.mock.calls[0] as [
        string,
        LabSyncManifest,
      ];
      expect(path).toBe(expectedPath);
      expect(data).toEqual(manifest);
    });

    it("uses owner-namespaced paths on save", async () => {
      const m: LabSyncManifest = {};
      await store.save("alice", m);
      await store.save("bob", m);

      const calls = mockWriteJson.mock.calls as [string, LabSyncManifest][];
      expect(calls[0][0]).toBe(`users/alice/${LAB_SYNC_MANIFEST_FILE}`);
      expect(calls[1][0]).toBe(`users/bob/${LAB_SYNC_MANIFEST_FILE}`);
    });
  });
});
