// frontend/src/lib/users-create-curated-defaults.test.ts
//
// Extension Store Phase U2 follow-up (u2-curated-default bot, 2026-05-29).
//
// New accounts should land on a CURATED SHORT picker set
// (Markdown + PDF + PCR), while EXISTING accounts keep all method types
// enabled. The curated set is written ONLY at genuine account creation, so
// it cannot retroactively curate existing users.
//
// This file proves the end-to-end contract through the real
// `usersApi.create` path (mirrors user-tombstone.test.ts: mock the
// file-service + indexeddb-store, run the real settings + metadata stack
// over an in-memory disk):
//
//   1. After `usersApi.create("newbie")`, the new account's settings.json
//      carries `enabledMethodTypes` === the curated set, and its picker
//      therefore resolves to exactly Markdown / PDF / PCR (+ always-on
//      compound, which is implied and never persisted).
//   2. An account with NO `enabledMethodTypes` field on disk still resolves
//      to ALL types enabled (existing-user no-regression). Creation must not
//      have mutated a shared default that would curate everyone.
//   3. Enabling another type via the existing per-type path works on top of
//      the curated set.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── In-memory FS mock (same surface as user-tombstone.test.ts) ──────────────
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
    isConnected: vi.fn(() => true),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
    getDirectory: vi.fn(async () => ({ removeEntry: vi.fn(async () => {}) })),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async () => []),
    listDirectories: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => ""),
  storeCurrentUser: vi.fn(async () => {}),
  clearCurrentUser: vi.fn(async () => {}),
  clearCurrentUserCache: vi.fn(() => {}),
  getMainUser: vi.fn(async () => ""),
  storeMainUser: vi.fn(async () => {}),
  clearMainUser: vi.fn(async () => {}),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { usersApi } from "./local-api";
import {
  CURATED_DEFAULT_METHOD_TYPES,
  allMethodTypeIds,
  readEnabledMethodTypes,
  resolveEnabledMethodTypes,
  setMethodTypeEnabled,
} from "./methods/method-type-enablement";
import { readUserSettings } from "./settings/user-settings";

beforeEach(() => {
  memFs.clear();
});

describe("CURATED_DEFAULT_METHOD_TYPES", () => {
  it("is exactly Markdown + PDF + PCR (verified registry slugs)", () => {
    expect([...CURATED_DEFAULT_METHOD_TYPES]).toEqual(["markdown", "pdf", "pcr"]);
  });

  it("never includes always-on compound (it is implied, never persisted)", () => {
    expect(CURATED_DEFAULT_METHOD_TYPES).not.toContain("compound");
  });
});

describe("usersApi.create — curated default stamping", () => {
  it("stamps the curated set into the new account's settings.json", async () => {
    const result = await usersApi.create("newbie");
    expect(result.created).toBe(true);

    // The field landed on disk with exactly the curated slugs.
    const onDisk = memFs.get("users/newbie/settings.json") as {
      enabledMethodTypes?: string[];
    };
    expect(onDisk?.enabledMethodTypes).toEqual(["markdown", "pdf", "pcr"]);
  });

  it("makes the new account's picker resolve to Markdown / PDF / PCR (+ compound)", async () => {
    await usersApi.create("newbie");

    const settings = await readUserSettings("newbie");
    const set = resolveEnabledMethodTypes(settings.enabledMethodTypes);

    // The three curated types are enabled.
    expect(set.has("markdown")).toBe(true);
    expect(set.has("pdf")).toBe(true);
    expect(set.has("pcr")).toBe(true);
    // compound is always-on (hidden-from-picker), forced on regardless.
    expect(set.has("compound")).toBe(true);
    // Everything else is OFF by default for a new account.
    expect(set.has("mass_spec")).toBe(false);
    expect(set.has("lc_gradient")).toBe(false);
    expect(set.has("cell_culture")).toBe(false);
    expect(set.has("qpcr_analysis")).toBe(false);
    expect(set.has("coding_workflow")).toBe(false);
    expect(set.has("plate")).toBe(false);
    // Resolved set = 3 curated + compound.
    expect(set.size).toBe(CURATED_DEFAULT_METHOD_TYPES.length + 1);
  });

  it("lets the new account enable another type via the existing path", async () => {
    await usersApi.create("newbie");

    // Mass spec is off for a fresh account...
    let set = await readEnabledMethodTypes("newbie");
    expect(set.has("mass_spec")).toBe(false);

    // ...the existing per-type toggle turns it on and it sticks.
    await setMethodTypeEnabled("newbie", "mass_spec", true);
    set = await readEnabledMethodTypes("newbie");
    expect(set.has("mass_spec")).toBe(true);
    // Curated types remain enabled.
    expect(set.has("markdown")).toBe(true);
    expect(set.has("pcr")).toBe(true);
  });
});

describe("existing-account no-regression", () => {
  it("an account with NO enabledMethodTypes field still resolves to ALL enabled", async () => {
    // Simulate an EXISTING user: a settings.json that predates U2 and has no
    // `enabledMethodTypes` field at all. (This is the realistic shape for
    // every account created before this change.)
    memFs.set("users/oldtimer/settings.json", {
      schemaVersion: 1,
      account_type: "member",
    });

    const set = await readEnabledMethodTypes("oldtimer");
    // Absent => everything enabled (back-compat contract).
    expect(set.size).toBe(allMethodTypeIds().length);
    for (const id of allMethodTypeIds()) expect(set.has(id)).toBe(true);
  });

  it("creating a NEW account does not curate an existing untouched account", async () => {
    // Pre-seed an existing user with no enablement field.
    memFs.set("users/oldtimer/settings.json", {
      schemaVersion: 1,
      account_type: "member",
    });

    // Create a fresh account on the same disk.
    await usersApi.create("newbie");

    // The new account is curated...
    const newbie = await readEnabledMethodTypes("newbie");
    expect(newbie.has("mass_spec")).toBe(false);

    // ...but the existing account is untouched: still all-enabled, and its
    // on-disk settings still has NO enabledMethodTypes field.
    const oldtimer = await readEnabledMethodTypes("oldtimer");
    expect(oldtimer.size).toBe(allMethodTypeIds().length);
    const oldOnDisk = memFs.get("users/oldtimer/settings.json") as {
      enabledMethodTypes?: string[];
    };
    expect(oldOnDisk.enabledMethodTypes).toBeUndefined();
  });
});
