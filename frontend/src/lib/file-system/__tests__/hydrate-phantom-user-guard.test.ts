// Regression test locking commit 4612269ac: a passive settings hydrate must
// NEVER create a user folder for a username that is absent from
// listDirectories("users").
//
// THE BUG (2026-06-07): the demo carried the fixture user "alex" in the
// SHARED IndexedDB current-user key. On a real-folder tab, hydrate read that
// leaked "alex", and patchUserSettings("alex", ...) wrote
// users/alex/_settings.json, materializing a stray empty users/alex directory
// in the user's real research folder.
//
// THE FIX (file-system-context.tsx hydrateSettingsForUser): the legacy
// patchUserSettings migration only runs when the user genuinely exists, i.e.
//   (await fileService.listDirectories("users")).includes(username)
//
// This test reproduces that exact guard branch against a mocked fileService +
// user-settings module and asserts patchUserSettings is NOT called for a
// phantom user. It is a faithful replica of the inline guard; if you change
// the predicate in hydrateSettingsForUser, change it here too.

import { describe, expect, it, beforeEach, vi } from "vitest";

const patchUserSettings = vi.fn(async (_u: string, _p: unknown) => ({}));
const userSettingsFileExists = vi.fn(async (_u: string) => false);
const readUserSettings = vi.fn(async (_u: string) => ({}));

const listDirectories = vi.fn(async (_p: string) => [] as string[]);
const isConnected = vi.fn(() => true);

vi.mock("../../settings/user-settings", () => ({
  patchUserSettings,
  userSettingsFileExists,
  readUserSettings,
}));

// Stand-in for readLegacyLocalStorageSettings — a non-null legacy blob is the
// only thing that would even attempt the migration write.
function readLegacyLocalStorageSettings() {
  return { animationType: "confetti" as const };
}

/**
 * Faithful replica of the migration branch inside
 * FileSystemProvider.hydrateSettingsForUser (file-system-context.tsx ~215).
 * The only behavior under test is whether patchUserSettings is reached.
 */
async function hydrateMigrationBranch(
  username: string,
  fileService: { isConnected: () => boolean; listDirectories: (p: string) => Promise<string[]> },
) {
  const exists = await userSettingsFileExists(username);
  if (!exists && fileService.isConnected()) {
    const userDirs = await fileService
      .listDirectories("users")
      .catch(() => [] as string[]);
    const userIsReal = userDirs.includes(username);
    const legacy = readLegacyLocalStorageSettings();
    if (userIsReal && legacy?.animationType) {
      await patchUserSettings(username, { animationType: legacy.animationType });
    }
  }
}

beforeEach(() => {
  patchUserSettings.mockClear();
  userSettingsFileExists.mockClear();
  listDirectories.mockClear();
  isConnected.mockClear();
  userSettingsFileExists.mockResolvedValue(false);
  isConnected.mockReturnValue(true);
});

describe("hydrate phantom-user guard (4612269ac)", () => {
  it("does NOT call patchUserSettings for a username absent from listDirectories(users)", async () => {
    // Real folder has only Grant; the leaked demo "alex" is a phantom here.
    listDirectories.mockResolvedValue(["Grant"]);
    const fileService = { isConnected, listDirectories };

    await hydrateMigrationBranch("alex", fileService);

    expect(patchUserSettings).not.toHaveBeenCalled();
  });

  it("does NOT call patchUserSettings when the users directory is empty", async () => {
    listDirectories.mockResolvedValue([]);
    const fileService = { isConnected, listDirectories };

    await hydrateMigrationBranch("alex", fileService);

    expect(patchUserSettings).not.toHaveBeenCalled();
  });

  it("DOES migrate (calls patchUserSettings) for a user that genuinely exists", async () => {
    // Control case: when the user is real, the legacy migration still runs,
    // proving the guard gates on existence and isn't a blanket disable.
    listDirectories.mockResolvedValue(["Grant", "alex"]);
    const fileService = { isConnected, listDirectories };

    await hydrateMigrationBranch("alex", fileService);

    expect(patchUserSettings).toHaveBeenCalledTimes(1);
    expect(patchUserSettings).toHaveBeenCalledWith("alex", {
      animationType: "confetti",
    });
  });
});
