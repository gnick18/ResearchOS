// frontend/src/lib/onboarding/dev-sandbox.test.ts
//
// Pins the `nextTestUserName()` counter behavior used by
// DevForceTipButton's "Show welcome wizard (creates Test user)"
// affordance. Per Grant's design lock (onboarding v2 manager 2026-05-20):
//
//   - Counter starts at 1, returns the lowest positive integer N
//     where "Test-N" is not present in _user_metadata.
//   - Tombstoned entries (deleted_at set) count as used so we don't
//     collide with their lingering metadata.
//   - Unrelated user keys (alex, morgan) are ignored — we only look
//     at the "Test-N" namespace.
//
// `readAllUserMetadata` is mocked so the test runs as a pure function
// against the metadata snapshot without touching disk.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock (must be declared before the import-under-test) ───────────────

type UserMetadataEntry = {
  color: string;
  created_at: string;
  deleted_at?: string;
  hide_goals_from_lab?: boolean;
};

const readAllUserMetadataMock =
  vi.fn<() => Promise<Record<string, UserMetadataEntry>>>();
vi.mock("@/lib/file-system/user-metadata", () => ({
  readAllUserMetadata: () => readAllUserMetadataMock(),
}));

// Import after the mock is wired.
import { nextTestUserName } from "./dev-sandbox";

function entry(extra: Partial<UserMetadataEntry> = {}): UserMetadataEntry {
  return {
    color: "#3b82f6",
    created_at: "2026-05-20T00:00:00.000Z",
    ...extra,
  };
}

beforeEach(() => {
  readAllUserMetadataMock.mockReset();
});

describe("nextTestUserName", () => {
  it("returns Test-1 when metadata is empty", async () => {
    readAllUserMetadataMock.mockResolvedValue({});
    expect(await nextTestUserName()).toBe("Test-1");
  });

  it("returns Test-2 when Test-1 exists", async () => {
    readAllUserMetadataMock.mockResolvedValue({
      "Test-1": entry(),
    });
    expect(await nextTestUserName()).toBe("Test-2");
  });

  it("fills the lowest gap (Test-2) when Test-1 and Test-3 exist", async () => {
    readAllUserMetadataMock.mockResolvedValue({
      "Test-1": entry(),
      "Test-3": entry(),
    });
    expect(await nextTestUserName()).toBe("Test-2");
  });

  it("treats tombstoned Test-1 as used and returns Test-2", async () => {
    readAllUserMetadataMock.mockResolvedValue({
      "Test-1": entry({ deleted_at: "2026-05-19T00:00:00.000Z" }),
    });
    expect(await nextTestUserName()).toBe("Test-2");
  });

  it("ignores unrelated usernames and returns Test-1", async () => {
    readAllUserMetadataMock.mockResolvedValue({
      alex: entry(),
      morgan: entry(),
    });
    expect(await nextTestUserName()).toBe("Test-1");
  });
});
