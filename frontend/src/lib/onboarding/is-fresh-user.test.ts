// frontend/src/lib/onboarding/is-fresh-user.test.ts
//
// Phase 5 audit: pins the three-signal invariant for
// `isFreshUserForWizard()`. The wizard should fire ONLY for genuinely
// fresh users, per Grant's master lock for Onboarding v2:
//
//   _onboarding.json absent
//     AND settings.json absent
//     AND no _user_metadata entry
//
// ANY present signal → existing user → wizard does NOT fire. The
// orchestrator's `showWizard` gate consults this predicate first, so
// these cases also act as the regression-trip for the orchestrator's
// existing-user-invisibility invariant.
//
// The mocks below shadow `@/lib/file-system/file-service`,
// `@/lib/settings/user-settings`, and `@/lib/file-system/user-metadata`
// so the predicate runs as a pure function against signal toggles
// without touching real disk or React state.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (must be declared before the import-under-test) ──────────────

const fileExistsMock = vi.fn<(path: string) => Promise<boolean>>();
const isConnectedMock = vi.fn<() => boolean>();
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    isConnected: () => isConnectedMock(),
    fileExists: (path: string) => fileExistsMock(path),
  },
}));

const userSettingsFileExistsMock =
  vi.fn<(username: string) => Promise<boolean>>();
vi.mock("@/lib/settings/user-settings", () => ({
  userSettingsFileExists: (username: string) =>
    userSettingsFileExistsMock(username),
}));

type UserMetadataEntry = {
  color: string;
  created_at: string;
  deleted_at?: string;
  hide_goals_from_lab?: boolean;
};
const getUserMetadataMock =
  vi.fn<(username: string) => Promise<UserMetadataEntry | null>>();
vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: (username: string) => getUserMetadataMock(username),
}));

// Import after the mocks are wired.
import { isFreshUserForWizard } from "./is-fresh-user";

const USER = "alice";
const SIDECAR_PATH = `users/${USER}/_onboarding.json`;

beforeEach(() => {
  // Default to "wide-open, connected, all-signals-absent" — each test
  // flips just the signal it cares about. This keeps the per-case
  // arrange block down to one line.
  isConnectedMock.mockReset().mockReturnValue(true);
  fileExistsMock.mockReset().mockResolvedValue(false);
  userSettingsFileExistsMock.mockReset().mockResolvedValue(false);
  getUserMetadataMock.mockReset().mockResolvedValue(null);
});

describe("isFreshUserForWizard — three-signal invariant", () => {
  it("returns true when all three signals are absent (genuinely fresh user)", async () => {
    // Defaults from beforeEach already encode this: connected,
    // no sidecar, no settings, no metadata.
    await expect(isFreshUserForWizard(USER)).resolves.toBe(true);
  });

  it("returns false when _onboarding.json exists (any shape)", async () => {
    // The sidecar's mere PRESENCE counts — its body might be a v1
    // record, a v2 record with `mode` set, a partial v3 record, or
    // even a corrupt `{ version: 3 }` stub. The predicate doesn't
    // care about the body; it asks fileExists() and that's it.
    fileExistsMock.mockImplementation(async (path) => path === SIDECAR_PATH);
    await expect(isFreshUserForWizard(USER)).resolves.toBe(false);
  });

  it("returns false when settings.json exists", async () => {
    userSettingsFileExistsMock.mockResolvedValue(true);
    await expect(isFreshUserForWizard(USER)).resolves.toBe(false);
  });

  it("returns false when the user has a _user_metadata entry", async () => {
    getUserMetadataMock.mockResolvedValue({
      color: "#abcdef",
      created_at: "2026-05-15T10:00:00.000Z",
    });
    await expect(isFreshUserForWizard(USER)).resolves.toBe(false);
  });

  it("returns false when fileService is not connected (no folder mounted)", async () => {
    // Defensive: even if (somehow) the other two signal-stub responses
    // say "absent", a not-connected fileService means we cannot make
    // any claim about the user's footprint on disk. Treat as existing.
    isConnectedMock.mockReturnValue(false);
    // Set the other signals to "false" too so we're not relying on a
    // short-circuit; the connection check is the load-bearing one.
    await expect(isFreshUserForWizard(USER)).resolves.toBe(false);
  });

  it("returns false when ALL three signals are present (defense in depth)", async () => {
    fileExistsMock.mockImplementation(async (path) => path === SIDECAR_PATH);
    userSettingsFileExistsMock.mockResolvedValue(true);
    getUserMetadataMock.mockResolvedValue({
      color: "#abcdef",
      created_at: "2026-05-15T10:00:00.000Z",
    });
    await expect(isFreshUserForWizard(USER)).resolves.toBe(false);
  });

  it("v1-holdover: sidecar with `mode` set but no wizard_completed/skipped → still returns false", async () => {
    // Realistic v1 → v2 migration scenario: the user picked a tip mode
    // (suggestions / tutorial / silenced) under the v1 welcome modal,
    // so their _onboarding.json exists with `mode` set but neither
    // `wizard_completed_at` nor `wizard_skipped_at` recorded yet.
    //
    // The wizard mount gate in orchestrator.tsx is:
    //
    //   sidecar !== null
    //     && isFreshUser === true                      ← THIS test
    //     && sidecar.wizard_completed_at === null
    //     && sidecar.wizard_skipped_at === null
    //     && activeTip === null
    //
    // isFreshUserForWizard short-circuits on `hasSidecar` BEFORE the
    // sidecar body is read. So the wizard_completed_at / skipped_at
    // checks downstream never see this user — the predicate already
    // says "not fresh", and the gate fails on the second clause.
    fileExistsMock.mockImplementation(async (path) => path === SIDECAR_PATH);
    // Settings + metadata absent — only the sidecar signals existing-ness.
    await expect(isFreshUserForWizard(USER)).resolves.toBe(false);
  });
});
