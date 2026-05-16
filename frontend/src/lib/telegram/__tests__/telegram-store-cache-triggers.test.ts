// Tests for the security-manager-approved write triggers in telegram-store
// (constraints [4], [4b], [6]). The cache module itself is mocked through
// idb-keyval so we exercise the exact wiring the store ships with.

import { describe, expect, it, beforeEach, vi } from "vitest";

// vi.mock factories hoist to the top of the file, so any module-level
// state they reference must live inside `vi.hoisted` to be available at
// hoist time. `state` carries the in-memory IDB/disk stores + folder name.
const state = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  fakeDisk: new Map<string, unknown>(),
  folderName: "lab-folder" as string | null,
}));

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => state.kv.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    state.kv.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    state.kv.delete(key);
  }),
  keys: vi.fn(async () => Array.from(state.kv.keys())),
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => state.fakeDisk.get(path) ?? null),
    writeJson: vi.fn(async (path: string, value: unknown) => {
      state.fakeDisk.set(path, value);
    }),
    deleteFile: vi.fn(async (path: string) => {
      state.fakeDisk.delete(path);
    }),
  },
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getStoredDirectoryMeta: vi.fn(async () =>
    state.folderName === null
      ? null
      : { name: state.folderName, grantedAt: 0 },
  ),
}));

import {
  readPairing,
  writePairing,
  clearPairing,
  type TelegramPairing,
} from "../telegram-store";
import {
  readTelegramTokenCache,
  writeTelegramTokenCache,
} from "../telegram-token-cache";

const ALICE_PAIRING: TelegramPairing = {
  botToken: "111:aaa",
  botUsername: "alice_bot",
  chatId: 1001,
  lastUpdateId: 0,
  pairedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  state.kv.clear();
  state.fakeDisk.clear();
  state.folderName = "lab-folder";
});

describe("writePairing — constraint [4a] (pairing success seeds the cache)", () => {
  it("writes both the disk sidecar AND the IDB token cache entry", async () => {
    await writePairing("alice", ALICE_PAIRING);

    expect(state.fakeDisk.get("users/alice/_telegram.json")).toEqual(ALICE_PAIRING);

    const cached = await readTelegramTokenCache("lab-folder", "alice");
    expect(cached).toEqual({
      botToken: "111:aaa",
      chatId: 1001,
      botUsername: "alice_bot",
    });
  });

  it("does NOT cache the lastUpdateId or pairedAt (constraint [2] minimal payload)", async () => {
    await writePairing("alice", ALICE_PAIRING);
    const cached = await readTelegramTokenCache("lab-folder", "alice");
    expect(cached).not.toHaveProperty("lastUpdateId");
    expect(cached).not.toHaveProperty("pairedAt");
  });

  it("bails on the cache write when no folder is connected", async () => {
    state.folderName = null;
    await writePairing("alice", ALICE_PAIRING);
    // No folder → cache wasn't scoped → idb-keyval is empty.
    expect(state.kv.size).toBe(0);
    // Disk write still went through (disk path doesn't need the folder name).
    expect(state.fakeDisk.get("users/alice/_telegram.json")).toEqual(ALICE_PAIRING);
  });
});

describe("readPairing — constraint [4] (lazy-refresh on successful disk read)", () => {
  it("seeds the cache when disk has a pairing but cache is empty", async () => {
    // Plant a sidecar without going through writePairing, so the cache
    // never got seeded. Mirrors the "first read after wipe" scenario.
    state.fakeDisk.set("users/alice/_telegram.json", ALICE_PAIRING);

    const got = await readPairing("alice");

    expect(got).toEqual(ALICE_PAIRING);
    const cached = await readTelegramTokenCache("lab-folder", "alice");
    expect(cached).toEqual({
      botToken: "111:aaa",
      chatId: 1001,
      botUsername: "alice_bot",
    });
  });

  it("does NOT seed the cache when disk has no pairing", async () => {
    const got = await readPairing("alice");
    expect(got).toBeNull();
    expect(await readTelegramTokenCache("lab-folder", "alice")).toBeNull();
  });

  it("constraint [4b] edge case: cache ABSENT + successful disk read STILL writes", async () => {
    // Reproduces the specific scenario the security manager pinned:
    // after a `forgetAllTelegramTokenCache` wipe, the very next
    // successful disk read must seed the cache. A `if (cached &&
    // cached !== inMemory)` predicate would skip this case; the
    // correct form `if (cached === null || cached !== inMemory)`
    // covers it.
    state.fakeDisk.set("users/alice/_telegram.json", ALICE_PAIRING);
    // Cache starts empty (kv.clear in beforeEach).

    await readPairing("alice");

    expect(await readTelegramTokenCache("lab-folder", "alice")).toEqual({
      botToken: "111:aaa",
      chatId: 1001,
      botUsername: "alice_bot",
    });
  });

  it("updates the cache when disk differs from cache (token rotated on disk)", async () => {
    // Cache has the OLD payload; disk has the NEW payload.
    await writeTelegramTokenCache("lab-folder", "alice", {
      botToken: "OLD:zzz",
      chatId: 1001,
      botUsername: "alice_bot",
    });
    state.fakeDisk.set("users/alice/_telegram.json", ALICE_PAIRING);

    await readPairing("alice");

    const cached = await readTelegramTokenCache("lab-folder", "alice");
    expect(cached?.botToken).toBe("111:aaa"); // refreshed
  });

  it("does NOT re-write when disk and cache already match (no churn)", async () => {
    state.fakeDisk.set("users/alice/_telegram.json", ALICE_PAIRING);
    await writeTelegramTokenCache("lab-folder", "alice", {
      botToken: "111:aaa",
      chatId: 1001,
      botUsername: "alice_bot",
    });

    // We can't directly count idb-keyval `set` calls here because the
    // mock module is shared; instead we assert the cache still equals
    // what we planted — i.e. no clobber.
    await readPairing("alice");

    const cached = await readTelegramTokenCache("lab-folder", "alice");
    expect(cached).toEqual({
      botToken: "111:aaa",
      chatId: 1001,
      botUsername: "alice_bot",
    });
  });
});

describe("clearPairing — constraint [6] (explicit disconnect clears matching entry)", () => {
  it("deletes both the disk sidecar AND the matching IDB cache entry", async () => {
    await writePairing("alice", ALICE_PAIRING);
    expect(await readTelegramTokenCache("lab-folder", "alice")).not.toBeNull();

    await clearPairing("alice");

    expect(state.fakeDisk.has("users/alice/_telegram.json")).toBe(false);
    expect(await readTelegramTokenCache("lab-folder", "alice")).toBeNull();
  });

  it("leaves OTHER users' cache entries intact (single-entry scope)", async () => {
    await writePairing("alice", ALICE_PAIRING);
    await writePairing("bob", { ...ALICE_PAIRING, botToken: "222:bbb", botUsername: "bob_bot", chatId: 2002 });

    await clearPairing("alice");

    expect(await readTelegramTokenCache("lab-folder", "alice")).toBeNull();
    expect(await readTelegramTokenCache("lab-folder", "bob")).not.toBeNull();
  });
});
