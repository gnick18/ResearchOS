// frontend/src/lib/file-system/user-discovery.test.ts
//
// Regression-test wave 1 (PRIVACY + DATA INTEGRITY at the logic layer).
//
// discoverUsers() is the single chokepoint every "who is in this lab"
// surface funnels through (login picker, lab roster, lab-mode accessors,
// cross-user reads). It joins the on-disk user directories against the
// `_user_metadata.json` tombstone map: a user whose entry carries a
// `deleted_at` timestamp is soft-deleted and must be EXCLUDED, even though
// a cloud-sync provider (OneDrive Files On-Demand, Dropbox) may have
// re-spawned a placeholder directory underneath us.
//
// Motivating bug class: a `deleted_at` tombstone once made a user vanish
// (correct) — but the inverse invariant (clearing `deleted_at` revives
// them, the BeakerBot revive path) was never tested end to end. These
// tests drive the REAL `discoverUsers` + REAL `readAllUserMetadata`
// against an in-memory file service so both halves of the tombstone join
// are exercised, not mocked.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UserMetadataFile } from "./user-metadata";

const memFs = new Map<string, unknown>();
let connected = true;
// On-disk user directories. discoverUsers reads these via listDirectories.
let userDirs: string[] = [];

vi.mock("./file-service", () => ({
  fileService: {
    isConnected: vi.fn(() => connected),
    listDirectories: vi.fn(async (dirPath: string) => {
      if (dirPath !== "users") return [];
      return [...userDirs];
    }),
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
  },
}));

// Imports after mock.
import { discoverUsers, discoverRealLocalUsers } from "./user-discovery";

const METADATA_PATH = "users/_user_metadata.json";

function setMetadata(file: UserMetadataFile): void {
  memFs.set(METADATA_PATH, file);
}

beforeEach(() => {
  memFs.clear();
  connected = true;
  userDirs = [];
});

describe("discoverUsers — basic enumeration", () => {
  it("returns sorted user directories, filtering system dirs", async () => {
    userDirs = [
      "morgan",
      "alex",
      "public",
      "lab",
      "_no_user_",
      "_global_counters.json",
      "_user_metadata.json",
    ];
    setMetadata({ users: {} });
    expect(await discoverUsers()).toEqual(["alex", "morgan"]);
  });

  it("returns [] when not connected", async () => {
    connected = false;
    userDirs = ["alex"];
    expect(await discoverUsers()).toEqual([]);
  });

  it("returns [] when the users dir is empty", async () => {
    userDirs = [];
    setMetadata({ users: {} });
    expect(await discoverUsers()).toEqual([]);
  });
});

describe("discoverUsers — tombstone semantics", () => {
  it("EXCLUDES a user whose metadata carries deleted_at", async () => {
    userDirs = ["alex", "beakerbot", "morgan"];
    setMetadata({
      users: {
        alex: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        beakerbot: {
          color: "#ef4444",
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: "2026-05-20T00:00:00.000Z",
        },
        morgan: { color: "#10b981", created_at: "2026-01-01T00:00:00.000Z" },
      },
    });

    const users = await discoverUsers();
    expect(users).toEqual(["alex", "morgan"]);
    expect(users).not.toContain("beakerbot");
  });

  it("excludes a tombstoned user EVEN WHEN the directory still exists on disk", async () => {
    // The defining scenario: cloud sync re-spawned a placeholder folder for
    // a soft-deleted user. The directory is present, but the tombstone must
    // still win — otherwise the deleted user leaks back into every picker.
    userDirs = ["ghost"]; // directory present
    setMetadata({
      users: {
        ghost: {
          color: "#f59e0b",
          created_at: "2025-01-01T00:00:00.000Z",
          deleted_at: "2026-05-01T00:00:00.000Z",
        },
      },
    });
    expect(await discoverUsers()).toEqual([]);
  });

  it("clearing deleted_at RE-INCLUDES the user (BeakerBot revive invariant)", async () => {
    userDirs = ["beakerbot"];

    // Start tombstoned -> excluded.
    setMetadata({
      users: {
        beakerbot: {
          color: "#ef4444",
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: "2026-05-20T00:00:00.000Z",
        },
      },
    });
    expect(await discoverUsers()).toEqual([]);

    // Revive: drop the deleted_at field. discoverUsers must surface them
    // again on the very next read (no caching of the tombstone state).
    setMetadata({
      users: {
        beakerbot: {
          color: "#ef4444",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    expect(await discoverUsers()).toEqual(["beakerbot"]);
  });

  it("a user with a directory but NO metadata entry is still discovered", async () => {
    // No tombstone means no exclusion. Users created before the metadata
    // file existed (or imports that skipped the ensure step) have a folder
    // but no entry — they must still appear.
    userDirs = ["legacyuser"];
    setMetadata({ users: {} });
    expect(await discoverUsers()).toEqual(["legacyuser"]);
  });

  it("a metadata tombstone with no on-disk directory does NOT resurrect a user", async () => {
    // Tombstone present but the directory is gone: the user is simply
    // absent (nothing to surface), and the tombstone does not invent a
    // directory entry. discoverUsers is directory-driven, metadata-filtered.
    userDirs = [];
    setMetadata({
      users: {
        old_deleted: {
          color: "#ef4444",
          created_at: "2025-01-01T00:00:00.000Z",
          deleted_at: "2026-05-01T00:00:00.000Z",
        },
      },
    });
    expect(await discoverUsers()).toEqual([]);
  });
});

describe("discoverRealLocalUsers — materialized-co-member semantics (Task C)", () => {
  it("excludes materialized co-members so a lone member resolves to just themselves", async () => {
    // A member of someone else's lab: their OWN dir + the materialized head +
    // a materialized co-member. Only the viewer is a real local user.
    userDirs = ["viewer", "pi", "labmate"];
    setMetadata({
      users: {
        viewer: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        pi: {
          color: "#ef4444",
          created_at: "2026-01-01T00:00:00.000Z",
          materialized_member: true,
        },
        labmate: {
          color: "#10b981",
          created_at: "2026-01-01T00:00:00.000Z",
          materialized_member: true,
        },
      },
    });
    // discoverUsers still counts everyone (the over-count the gate saw).
    expect(await discoverUsers()).toEqual(["labmate", "pi", "viewer"]);
    // The membership-derived count is just the one real local user.
    expect(await discoverRealLocalUsers()).toEqual(["viewer"]);
  });

  it("counts genuine co-located users (no materialized flag) as multi-user", async () => {
    userDirs = ["alex", "morgan"];
    setMetadata({
      users: {
        alex: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        morgan: { color: "#10b981", created_at: "2026-01-01T00:00:00.000Z" },
      },
    });
    expect(await discoverRealLocalUsers()).toEqual(["alex", "morgan"]);
  });

  it("still excludes tombstoned users (same as discoverUsers)", async () => {
    userDirs = ["alex", "ghost"];
    setMetadata({
      users: {
        alex: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        ghost: {
          color: "#ef4444",
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: "2026-05-01T00:00:00.000Z",
        },
      },
    });
    expect(await discoverRealLocalUsers()).toEqual(["alex"]);
  });

  it("a user with a directory but NO metadata entry counts as a real local user", async () => {
    userDirs = ["legacyuser"];
    setMetadata({ users: {} });
    expect(await discoverRealLocalUsers()).toEqual(["legacyuser"]);
  });
});
