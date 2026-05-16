// SENSITIVE: tests for the IDB token cache (SECURITY_AUDIT.md §1.3).
//
// Covers the security-manager-approved constraints whose surface lives in
// the cache module itself:
//   [1]  per-{folder, user} key isolation (no cross-user reads)
//   [9]  `forgetAllTelegramTokenCache(folder)` wipes ALL entries in folder
//   [6]/[7] `clearTelegramTokenCacheEntry(folder, user)` clears only the
//        matching {folder, user} pair
//
// Constraint [4] (write triggers) and [5] (clearDirectoryHandle folder-
// wipe) are exercised by the telegram-store + indexeddb-store tests
// adjacent to this file, since they sit at the call-site boundaries.

import { describe, expect, it, beforeEach, vi } from "vitest";

// In-memory idb-keyval mock. Cache module talks ONLY to idb-keyval, so
// we don't need the raw indexedDB shim that demo-handle-preservation
// uses for FSA handles.
const kv = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => kv.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    kv.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    kv.delete(key);
  }),
  keys: vi.fn(async () => Array.from(kv.keys())),
}));

import {
  readTelegramTokenCache,
  writeTelegramTokenCache,
  clearTelegramTokenCacheEntry,
  forgetAllTelegramTokenCache,
  type CachedTelegramToken,
} from "../telegram-token-cache";

const ALICE_TOKEN: CachedTelegramToken = {
  botToken: "111:aaa",
  chatId: 1001,
  botUsername: "alice_bot",
};

const BOB_TOKEN: CachedTelegramToken = {
  botToken: "222:bbb",
  chatId: 2002,
  botUsername: "bob_bot",
};

beforeEach(() => {
  kv.clear();
});

describe("read/write round-trip", () => {
  it("writes then reads back the same payload for a {folder, user}", async () => {
    await writeTelegramTokenCache("lab-folder", "alice", ALICE_TOKEN);
    const got = await readTelegramTokenCache("lab-folder", "alice");
    expect(got).toEqual(ALICE_TOKEN);
  });

  it("read returns null when no entry exists for a {folder, user}", async () => {
    expect(await readTelegramTokenCache("lab-folder", "ghost")).toBeNull();
  });
});

describe("per-{folder, user} isolation (constraint [1])", () => {
  it("Alice's cache is invisible to a Bob read in the SAME folder", async () => {
    await writeTelegramTokenCache("lab-folder", "alice", ALICE_TOKEN);
    expect(await readTelegramTokenCache("lab-folder", "bob")).toBeNull();
  });

  it("Alice's cache in folder A is invisible to a read in folder B", async () => {
    await writeTelegramTokenCache("folder-A", "alice", ALICE_TOKEN);
    expect(await readTelegramTokenCache("folder-B", "alice")).toBeNull();
  });

  it("two users in the same folder do not overwrite each other", async () => {
    await writeTelegramTokenCache("lab-folder", "alice", ALICE_TOKEN);
    await writeTelegramTokenCache("lab-folder", "bob", BOB_TOKEN);
    expect(await readTelegramTokenCache("lab-folder", "alice")).toEqual(ALICE_TOKEN);
    expect(await readTelegramTokenCache("lab-folder", "bob")).toEqual(BOB_TOKEN);
  });
});

describe("clearTelegramTokenCacheEntry (constraints [6] disconnect, [7] recovery-reject)", () => {
  it("clears only the matching {folder, user} pair", async () => {
    await writeTelegramTokenCache("lab-folder", "alice", ALICE_TOKEN);
    await writeTelegramTokenCache("lab-folder", "bob", BOB_TOKEN);

    await clearTelegramTokenCacheEntry("lab-folder", "alice");

    expect(await readTelegramTokenCache("lab-folder", "alice")).toBeNull();
    // Bob's entry is untouched — single-entry delete must not affect siblings.
    expect(await readTelegramTokenCache("lab-folder", "bob")).toEqual(BOB_TOKEN);
  });

  it("does not error when the entry doesn't exist", async () => {
    await expect(
      clearTelegramTokenCacheEntry("lab-folder", "ghost"),
    ).resolves.toBeUndefined();
  });
});

describe("forgetAllTelegramTokenCache(folder) (constraint [9])", () => {
  it("wipes every entry scoped to the given folder, across all users", async () => {
    await writeTelegramTokenCache("lab-folder", "alice", ALICE_TOKEN);
    await writeTelegramTokenCache("lab-folder", "bob", BOB_TOKEN);

    await forgetAllTelegramTokenCache("lab-folder");

    expect(await readTelegramTokenCache("lab-folder", "alice")).toBeNull();
    expect(await readTelegramTokenCache("lab-folder", "bob")).toBeNull();
  });

  it("leaves entries in OTHER folders untouched (constraint [5] folder-scope)", async () => {
    await writeTelegramTokenCache("folder-A", "alice", ALICE_TOKEN);
    await writeTelegramTokenCache("folder-B", "alice", BOB_TOKEN);

    await forgetAllTelegramTokenCache("folder-A");

    expect(await readTelegramTokenCache("folder-A", "alice")).toBeNull();
    expect(await readTelegramTokenCache("folder-B", "alice")).toEqual(BOB_TOKEN);
  });

  it("does not error on an empty store", async () => {
    await expect(forgetAllTelegramTokenCache("lab-folder")).resolves.toBeUndefined();
  });

  it("does not wipe foreign idb-keyval keys with similar prefixes", async () => {
    // Plant some unrelated keys that share a prefix-like shape. The
    // wipe scans by EXACT prefix `research-os-telegram-token-cache:`
    // + folder + `:` so neighbors stay safe.
    kv.set("research-os-current-user", "alice");
    kv.set("research-os-directory-handle-meta", { name: "x", grantedAt: 0 });
    await writeTelegramTokenCache("lab-folder", "alice", ALICE_TOKEN);

    await forgetAllTelegramTokenCache("lab-folder");

    expect(kv.get("research-os-current-user")).toBe("alice");
    expect(kv.get("research-os-directory-handle-meta")).toEqual({
      name: "x",
      grantedAt: 0,
    });
  });
});
