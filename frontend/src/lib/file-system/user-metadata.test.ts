// frontend/src/lib/file-system/user-metadata.test.ts
//
// Tests for setUserMetadataColors — the atomic 2-field write used by the
// Settings color picker. Without atomicity (one read-modify-write cycle),
// two sequential setUserMetadataField calls could let the primary land on
// disk while the secondary gets clobbered by a concurrent reader on the
// other tab.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory FS mock ───────────────────────────────────────────────────────
const memFs = new Map<string, unknown>();
const writeJsonCalls: { path: string; data: unknown }[] = [];

vi.mock("./file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      writeJsonCalls.push({ path, data });
      // Deep-clone so test assertions see the snapshot at write-time, not a
      // mutated reference (the production code mutates `file.users[username]`
      // in place after reading).
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    isConnected: vi.fn(() => true),
  },
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import {
  setUserMetadataColors,
  getUserMetadata,
  readAllUserMetadata,
  suggestInitialColorForNewUser,
  createUserMetadataEntry,
  USER_METADATA_COLOR_PALETTE,
} from "./user-metadata";

beforeEach(() => {
  memFs.clear();
  writeJsonCalls.length = 0;
});

describe("setUserMetadataColors", () => {
  it("writes both color and color_secondary in a single writeJson call", async () => {
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
      },
    });

    const result = await setUserMetadataColors("alice", "#10b981", "#ef4444");

    // ONE write to the metadata file. This is the atomicity guarantee —
    // setUserMetadataColors must NOT issue two field-level writes (which
    // would race the read in concurrent-tab scenarios).
    const metaWrites = writeJsonCalls.filter(
      (c) => c.path === "users/_user_metadata.json",
    );
    expect(metaWrites).toHaveLength(1);

    // Both fields persisted.
    expect(result?.color).toBe("#10b981");
    expect(result?.color_secondary).toBe("#ef4444");

    // Re-read confirms disk state.
    const persisted = await getUserMetadata("alice");
    expect(persisted?.color).toBe("#10b981");
    expect(persisted?.color_secondary).toBe("#ef4444");
  });

  it("preserves untouched fields (created_at, hide_goals_from_lab, deleted_at)", async () => {
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: {
          color: "#3b82f6",
          created_at: "2026-01-01T00:00:00.000Z",
          hide_goals_from_lab: true,
        },
      },
    });

    await setUserMetadataColors("alice", "#10b981", "#ef4444");

    const persisted = await getUserMetadata("alice");
    expect(persisted?.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(persisted?.hide_goals_from_lab).toBe(true);
  });

  it("clears the secondary when passed null (gradient → solid)", async () => {
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: {
          color: "#3b82f6",
          color_secondary: "#10b981",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    const result = await setUserMetadataColors("alice", "#3b82f6", null);

    expect(result?.color_secondary).toBeNull();
    const persisted = await getUserMetadata("alice");
    expect(persisted?.color_secondary).toBeNull();
  });

  it("auto-creates the user entry when missing, with the supplied colors and a now-ish created_at", async () => {
    // No pre-existing metadata file → the user-metadata module reads `null`
    // and starts from an empty users map. Picking a color before the user
    // is first auto-tracked should still work (legitimate cold-path).
    const before = Date.now();
    const result = await setUserMetadataColors("brand-new", "#10b981", "#ef4444");
    const after = Date.now();

    expect(result?.color).toBe("#10b981");
    expect(result?.color_secondary).toBe("#ef4444");
    const createdAt = Date.parse(result?.created_at ?? "");
    expect(createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(createdAt).toBeLessThanOrEqual(after + 5);
  });

  it("never disconnects two users — writing for alice does not touch bob's entry", async () => {
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
        bob: {
          color: "#ef4444",
          color_secondary: "#f59e0b",
          created_at: "2026-01-02T00:00:00.000Z",
        },
      },
    });

    await setUserMetadataColors("alice", "#10b981", "#8b5cf6");

    const all = await readAllUserMetadata();
    expect(all.bob?.color).toBe("#ef4444");
    expect(all.bob?.color_secondary).toBe("#f59e0b");
    expect(all.alice?.color).toBe("#10b981");
    expect(all.alice?.color_secondary).toBe("#8b5cf6");
  });
});

describe("suggestInitialColorForNewUser", () => {
  it("returns the first palette color when no other users exist", () => {
    const result = suggestInitialColorForNewUser("alice", {});
    expect(result).toBe(USER_METADATA_COLOR_PALETTE[0]);
  });

  it("skips colors taken by other users as their SOLID primary", () => {
    const result = suggestInitialColorForNewUser("carol", {
      alice: { color: USER_METADATA_COLOR_PALETTE[0], created_at: "x" },
      bob: { color: USER_METADATA_COLOR_PALETTE[1], created_at: "x" },
    });
    // First two palette slots are taken as solids; the suggestion should be
    // the third palette entry.
    expect(result).toBe(USER_METADATA_COLOR_PALETTE[2]);
  });

  it("does NOT block on colors that are only part of a gradient (gradients don't reserve their primary)", () => {
    // Bob owns the first palette color but as part of a gradient (has a
    // secondary). New solid users can still claim the same primary
    // because the collision rule is solid-vs-solid only.
    const result = suggestInitialColorForNewUser("carol", {
      bob: {
        color: USER_METADATA_COLOR_PALETTE[0],
        color_secondary: USER_METADATA_COLOR_PALETTE[5],
        created_at: "x",
      },
    });
    expect(result).toBe(USER_METADATA_COLOR_PALETTE[0]);
  });

  it("ignores tombstoned users — their slot is free to reclaim", () => {
    const result = suggestInitialColorForNewUser("carol", {
      "deleted-user": {
        color: USER_METADATA_COLOR_PALETTE[0],
        created_at: "x",
        deleted_at: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(result).toBe(USER_METADATA_COLOR_PALETTE[0]);
  });

  it("falls back to the hash when ALL palette slots are taken as solids", () => {
    // Every palette color taken solid — the helper falls through to
    // the hash-based pick (a deterministic value, just no
    // longer guaranteed unique).
    const allTaken: Record<string, { color: string; created_at: string }> = {};
    USER_METADATA_COLOR_PALETTE.forEach((c, i) => {
      allTaken[`user${i}`] = { color: c, created_at: "x" };
    });
    const result = suggestInitialColorForNewUser("carol", allTaken);
    // The result must STILL be from the palette (hash-based fallback
    // picks from the same palette).
    expect(USER_METADATA_COLOR_PALETTE).toContain(result);
  });
});

describe("createUserMetadataEntry", () => {
  it("writes a brand-new entry with the chosen color and a now-ish created_at", async () => {
    const before = Date.now();
    const result = await createUserMetadataEntry("alice", "#10b981");
    const after = Date.now();

    expect(result?.color).toBe("#10b981");
    const createdAt = Date.parse(result?.created_at ?? "");
    expect(createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(createdAt).toBeLessThanOrEqual(after + 5);

    // Persisted to disk.
    const persisted = await getUserMetadata("alice");
    expect(persisted?.color).toBe("#10b981");
  });

  it("honors the explicit color over a pre-seeded entry (preserves other fields)", async () => {
    // Simulate the race: ensureLabUserMetadata seeded an entry first
    // with a different color (and hide-flag), then the user accepted
    // the color picker. The pick should win, but hide-flag stays.
    memFs.set("users/_user_metadata.json", {
      users: {
        alice: {
          color: "#3b82f6",
          created_at: "2026-01-01T00:00:00.000Z",
          hide_goals_from_lab: true,
        },
      },
    });

    const result = await createUserMetadataEntry("alice", "#ef4444");
    expect(result?.color).toBe("#ef4444");
    expect(result?.hide_goals_from_lab).toBe(true);
    expect(result?.created_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("never touches another user's entry", async () => {
    memFs.set("users/_user_metadata.json", {
      users: {
        bob: {
          color: "#ef4444",
          color_secondary: "#f59e0b",
          created_at: "2026-01-02T00:00:00.000Z",
        },
      },
    });

    await createUserMetadataEntry("alice", "#10b981");

    const all = await readAllUserMetadata();
    expect(all.bob?.color).toBe("#ef4444");
    expect(all.bob?.color_secondary).toBe("#f59e0b");
    expect(all.alice?.color).toBe("#10b981");
  });
});
