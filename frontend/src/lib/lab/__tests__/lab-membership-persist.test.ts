// Tests for lib/lab/lab-membership-persist.ts
//
// persistLabMembership must call updateUserSettings with the correct
// account_type + lab_id pair for both "head" and "member" roles.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock user-settings BEFORE importing the module under test (vi.mock is hoisted
// before imports, but explicit before the import keeps intent clear in diffs).
// ---------------------------------------------------------------------------

vi.mock("@/lib/settings/user-settings", () => ({
  updateUserSettings: vi.fn().mockResolvedValue({}),
}));

import { persistLabMembership } from "../lab-membership-persist";
import { updateUserSettings } from "@/lib/settings/user-settings";

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistLabMembership", () => {
  it("calls updateUserSettings with account_type lab_head + lab_id for role head", async () => {
    await persistLabMembership("manny", { labId: "L1", role: "head" });

    expect(updateUserSettings).toHaveBeenCalledTimes(1);
    // updateUserSettings receives (username, updater). Invoke the updater with
    // a dummy current-settings object and check what it returns.
    const [calledUsername, updater] = vi.mocked(updateUserSettings).mock.calls[0] as [string, (c: object) => object];
    expect(calledUsername).toBe("manny");
    const patch = updater({});
    expect(patch).toEqual({ account_type: "lab_head", lab_id: "L1" });
  });

  it("calls updateUserSettings with account_type member + lab_id for role member", async () => {
    await persistLabMembership("dana", { labId: "L2", role: "member" });

    expect(updateUserSettings).toHaveBeenCalledTimes(1);
    const [calledUsername, updater] = vi.mocked(updateUserSettings).mock.calls[0] as [string, (c: object) => object];
    expect(calledUsername).toBe("dana");
    const patch = updater({});
    expect(patch).toEqual({ account_type: "member", lab_id: "L2" });
  });
});
