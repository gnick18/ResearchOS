// Per-account settings round-trip for `lastSeenAnnouncementVersion`
// (whats-new bot). Proves the field is:
//   - absent by default (so the manager can detect a brand-new account
//     and silently record without showing the popup),
//   - persisted per-username via patchUserSettings,
//   - read back by readUserSettings for the SAME username,
//   - isolated between two accounts on the same (mocked) disk.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    // readUserSettings short-circuits to DEFAULT_SETTINGS when not
    // connected; force connected so our seeded payloads round-trip.
    isConnected: vi.fn(() => true),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
  },
}));

// readUserSettings seeds color / hide-goals from _user_metadata.json.
// Return null so that seeding short-circuits and never touches the field
// under test.
vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
  setUserMetadataField: vi.fn(async () => {}),
  setUserMetadataColors: vi.fn(async () => {}),
}));

import {
  readUserSettings,
  patchUserSettings,
} from "./user-settings";

beforeEach(() => {
  memFs.clear();
});

describe("lastSeenAnnouncementVersion settings round-trip", () => {
  it("is undefined for a brand-new account (no settings on disk)", async () => {
    const settings = await readUserSettings("mira");
    expect(settings.lastSeenAnnouncementVersion).toBeUndefined();
  });

  it("persists and reads back for the same username", async () => {
    await patchUserSettings("mira", {
      lastSeenAnnouncementVersion: "0.1.0",
    });
    const settings = await readUserSettings("mira");
    expect(settings.lastSeenAnnouncementVersion).toBe("0.1.0");
  });

  it("a later patch overwrites the stored version", async () => {
    await patchUserSettings("mira", {
      lastSeenAnnouncementVersion: "0.1.0",
    });
    await patchUserSettings("mira", {
      lastSeenAnnouncementVersion: "0.2.0",
    });
    const settings = await readUserSettings("mira");
    expect(settings.lastSeenAnnouncementVersion).toBe("0.2.0");
  });

  it("is isolated per account: writing mira does not affect alex", async () => {
    await patchUserSettings("mira", {
      lastSeenAnnouncementVersion: "0.2.0",
    });
    const mira = await readUserSettings("mira");
    const alex = await readUserSettings("alex");
    expect(mira.lastSeenAnnouncementVersion).toBe("0.2.0");
    expect(alex.lastSeenAnnouncementVersion).toBeUndefined();
  });

  it("patching an unrelated field leaves an existing version intact", async () => {
    await patchUserSettings("mira", {
      lastSeenAnnouncementVersion: "0.1.0",
    });
    await patchUserSettings("mira", { coloredHeader: false });
    const settings = await readUserSettings("mira");
    expect(settings.lastSeenAnnouncementVersion).toBe("0.1.0");
    expect(settings.coloredHeader).toBe(false);
  });
});
