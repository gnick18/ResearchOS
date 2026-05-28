// frontend/src/lib/metadata/user-metadata-orcid.test.ts
//
// Round-trip + backward-compat tests for the ORCID iD field on
// UserMetadataEntry (metadata implementation bot, 2026-05-28):
//
//   1. Writing the canonical ORCID via the existing setUserMetadataField
//      path persists it and reads back via getUserMetadata.
//   2. Backward-compat: a pre-slice _user_metadata.json entry missing the
//      `orcid` field still loads unchanged (absent field stays absent), and
//      writing orcid onto it preserves the other fields (color, created_at).

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UserMetadataFile } from "../file-system/user-metadata";

const METADATA_PATH = "users/_user_metadata.json";

// ── In-memory file-service mock ─────────────────────────────────────────────
const memFs = new Map<string, unknown>();

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import {
  getUserMetadata,
  setUserMetadataField,
  readAllUserMetadata,
} from "../file-system/user-metadata";

beforeEach(() => {
  memFs.clear();
});

describe("UserMetadataEntry.orcid - round-trip", () => {
  it("persists the canonical ORCID via setUserMetadataField and reads it back", async () => {
    // Seed an existing entry so the write merges onto it.
    memFs.set(METADATA_PATH, {
      users: {
        alex: { color: "#3b82f6", created_at: "2025-01-01T00:00:00.000Z" },
      },
    } satisfies UserMetadataFile);

    await setUserMetadataField("alex", "orcid", "0000-0002-1825-0097");

    const entry = await getUserMetadata("alex");
    expect(entry).not.toBeNull();
    expect(entry!.orcid).toBe("0000-0002-1825-0097");
    // Other fields preserved through the merge.
    expect(entry!.color).toBe("#3b82f6");
    expect(entry!.created_at).toBe("2025-01-01T00:00:00.000Z");
  });

  it("can clear the ORCID with null without disturbing other fields", async () => {
    memFs.set(METADATA_PATH, {
      users: {
        alex: {
          color: "#10b981",
          created_at: "2025-01-01T00:00:00.000Z",
          orcid: "0000-0002-1825-0097",
        },
      },
    } satisfies UserMetadataFile);

    await setUserMetadataField("alex", "orcid", null);

    const entry = await getUserMetadata("alex");
    expect(entry!.orcid).toBeNull();
    expect(entry!.color).toBe("#10b981");
  });
});

describe("UserMetadataEntry.orcid - backward-compat", () => {
  it("an old metadata entry missing orcid still loads", async () => {
    memFs.set(METADATA_PATH, {
      users: {
        morgan: { color: "#ef4444", created_at: "2024-06-01T00:00:00.000Z" },
      },
    } satisfies UserMetadataFile);

    const all = await readAllUserMetadata();
    expect(all.morgan).toBeDefined();
    expect(all.morgan.color).toBe("#ef4444");
    // Absent field stays absent - no eager migration.
    expect(all.morgan.orcid).toBeUndefined();
  });

  it("writing orcid onto a legacy entry leaves its other fields intact", async () => {
    memFs.set(METADATA_PATH, {
      users: {
        morgan: {
          color: "#ef4444",
          created_at: "2024-06-01T00:00:00.000Z",
          hide_goals_from_lab: true,
        },
      },
    } satisfies UserMetadataFile);

    await setUserMetadataField("morgan", "orcid", "0000-0002-1694-233X");

    const entry = await getUserMetadata("morgan");
    expect(entry!.orcid).toBe("0000-0002-1694-233X");
    expect(entry!.color).toBe("#ef4444");
    expect(entry!.created_at).toBe("2024-06-01T00:00:00.000Z");
    expect(entry!.hide_goals_from_lab).toBe(true);
  });
});
