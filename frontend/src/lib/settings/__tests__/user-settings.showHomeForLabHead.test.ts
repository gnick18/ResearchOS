/**
 * user-settings — `showHomeForLabHead` default + round-trip.
 *
 * PI Home migration (pi-home-migration, 2026-05-29). The migration hinges
 * on this field DEFAULTING to `false`: a fresh settings.json (or one
 * written before this field existed) must resolve to "Home hidden for
 * PIs" so an upgrading lab head gets the new behavior without a manual
 * opt-out. These tests pin that default plus a patch round-trip.
 *
 * fileService + the _user_metadata mirror helpers are stubbed so the
 * read/write paths exercise `normalize` against an in-memory store rather
 * than touching disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory JSON store standing in for the on-disk settings.json. Each
// test seeds / inspects this via the mocked fileService.
const store = new Map<string, unknown>();

vi.mock("../../file-system/file-service", () => ({
  fileService: {
    isConnected: () => true,
    readJson: async (path: string) =>
      store.has(path) ? store.get(path) : null,
    writeJson: async (path: string, value: unknown) => {
      store.set(path, value);
    },
    fileExists: async (path: string) => store.has(path),
  },
}));

// The metadata mirror is exercised on write; stub it inert so the write
// path doesn't fault, and getUserMetadata returns null (no legacy seed).
vi.mock("../../file-system/user-metadata", () => ({
  setUserMetadataField: async () => {},
  setUserMetadataColors: async () => {},
  getUserMetadata: async () => null,
}));

import {
  DEFAULT_SETTINGS,
  readUserSettings,
  patchUserSettings,
} from "../user-settings";

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("user-settings — showHomeForLabHead", () => {
  it("DEFAULT_SETTINGS.showHomeForLabHead is false", () => {
    expect(DEFAULT_SETTINGS.showHomeForLabHead).toBe(false);
  });

  it("a settings.json with no showHomeForLabHead field normalizes to false", async () => {
    // Simulate an upgrading lab_head whose settings.json predates the
    // field — the migration must default them to Home-hidden.
    store.set("users/mira/settings.json", {
      schemaVersion: 1,
      account_type: "lab_head",
      visibleTabs: ["/"],
      defaultLandingTab: "/",
    });
    const settings = await readUserSettings("mira");
    expect(settings.showHomeForLabHead).toBe(false);
    expect(settings.account_type).toBe("lab_head");
  });

  it("preserves an explicit showHomeForLabHead=true on read", async () => {
    store.set("users/mira/settings.json", {
      schemaVersion: 1,
      account_type: "lab_head",
      showHomeForLabHead: true,
    });
    const settings = await readUserSettings("mira");
    expect(settings.showHomeForLabHead).toBe(true);
  });

  it("patchUserSettings round-trips the opt-back-in flag", async () => {
    store.set("users/mira/settings.json", {
      schemaVersion: 1,
      account_type: "lab_head",
    });
    const afterOptIn = await patchUserSettings("mira", {
      showHomeForLabHead: true,
    });
    expect(afterOptIn.showHomeForLabHead).toBe(true);

    // Re-read from the in-memory store to confirm it persisted.
    const reread = await readUserSettings("mira");
    expect(reread.showHomeForLabHead).toBe(true);

    // Flipping back off persists too.
    const afterOptOut = await patchUserSettings("mira", {
      showHomeForLabHead: false,
    });
    expect(afterOptOut.showHomeForLabHead).toBe(false);
  });
});
