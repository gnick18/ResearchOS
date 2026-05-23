// frontend/src/lib/methods-api-create.test.ts
//
// Regression test for `methodsApi.create`'s owner derivation +
// shared_with routing.
//
// Pre-R1d: `methodsApi.create` branched on the legacy `is_public`
// boolean to pick between the user's private store and the public
// store. The on-disk record persisted `owner: "public"` for the
// public branch and `owner: <currentUser>` for the private one.
//
// R1d (R1d shared_with API manager, 2026-05-23): the routing now
// branches on whether `shared_with` contains the unified WHOLE_LAB
// "*" sentinel. The legacy `is_public: true` boolean is still
// honored as a deprecated alias for one release of back-compat
// (with a runtime console.warn when it is the only sharing signal),
// and the on-disk `is_public` field is still written in both
// directions to preserve receiver-side back-compat readers.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Method } from "./types";

// ── Mock surface ────────────────────────────────────────────────────────────

const memFs = new Map<string, unknown>();

vi.mock("./file-system/file-service", () => ({
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
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { methodsApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

beforeEach(() => {
  memFs.clear();
  // The json-store memoizes the current user across calls; clear so each
  // test reads from the mocked indexeddb-store fresh.
  clearCurrentUserCache();
});

describe("methodsApi.create — owner derivation via shared_with", () => {
  it("personal method (no shared_with) gets owner: <currentUser>", async () => {
    const result = await methodsApi.create({
      name: "personal test",
      shared_with: [],
    });

    expect(result.owner).toBe("alex");
    expect(result.is_public).toBe(false);
  });

  it("whole-lab method (shared_with contains '*') gets owner: 'public'", async () => {
    const result = await methodsApi.create({
      name: "public test",
      shared_with: [{ username: "*", level: "read" }],
    });

    expect(result.owner).toBe("public");
    expect(result.is_public).toBe(true);
  });

  it("persists the correct owner on the on-disk record (personal)", async () => {
    const result = await methodsApi.create({
      name: "persisted personal",
      shared_with: [],
    });

    const persisted = memFs.get(`users/alex/methods/${result.id}.json`) as Method;
    expect(persisted).toBeDefined();
    expect(persisted.owner).toBe("alex");
    expect(persisted.is_public).toBe(false);
    expect(persisted.shared_with).toEqual([]);
  });

  it("persists the correct owner on the on-disk record (whole-lab)", async () => {
    const result = await methodsApi.create({
      name: "persisted public",
      shared_with: [{ username: "*", level: "read" }],
    });

    const persisted = memFs.get(`users/public/methods/${result.id}.json`) as Method;
    expect(persisted).toBeDefined();
    expect(persisted.owner).toBe("public");
    expect(persisted.is_public).toBe(true);
    // The "*" entry round-trips onto disk; both fields land this round
    // and the R1 schema rip drops `is_public` next release.
    expect(persisted.shared_with).toContainEqual({
      username: "*",
      level: "read",
    });
  });

  it("defaults to personal when shared_with is omitted entirely", async () => {
    const result = await methodsApi.create({
      name: "defaulted",
    });

    expect(result.owner).toBe("alex");
    expect(result.is_public).toBe(false);

    const persisted = memFs.get(`users/alex/methods/${result.id}.json`) as Method;
    expect(persisted.owner).toBe("alex");
    expect(persisted.shared_with).toEqual([]);
  });

  it("preserves explicit recipients alongside the '*' sentinel", async () => {
    const result = await methodsApi.create({
      name: "mixed share",
      shared_with: [
        { username: "*", level: "read" },
        { username: "casey", level: "edit" },
      ],
    });

    expect(result.owner).toBe("public");
    const persisted = memFs.get(`users/public/methods/${result.id}.json`) as Method;
    expect(persisted.shared_with).toEqual(
      expect.arrayContaining([
        { username: "*", level: "read" },
        { username: "casey", level: "edit" },
      ]),
    );
  });
});

describe("methodsApi.create — deprecated is_public back-compat alias", () => {
  it("legacy is_public: true still routes to the public namespace", async () => {
    // R1d retains the legacy alias for one release of back-compat. A
    // console.warn fires once when the boolean is the only sharing
    // signal; the routing decision still works.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await methodsApi.create({
        name: "legacy public",
        is_public: true,
      });

      expect(result.owner).toBe("public");
      expect(result.is_public).toBe(true);

      const persisted = memFs.get(`users/public/methods/${result.id}.json`) as Method;
      expect(persisted.is_public).toBe(true);
      // The alias also injects the "*" entry into the on-disk
      // shared_with so unified canRead readers work the same as
      // shared_with-native callers.
      expect(persisted.shared_with).toContainEqual({
        username: "*",
        level: "read",
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("legacy is_public: false routes to the private store", async () => {
    const result = await methodsApi.create({
      name: "legacy private",
      is_public: false,
    });

    expect(result.owner).toBe("alex");
    expect(result.is_public).toBe(false);
  });
});
