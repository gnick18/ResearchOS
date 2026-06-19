// Tests for the lab-as-folder branch in lib/lab/lab-member-activation.ts
//
// The activation functions (checkAndEnterLab / enterLabViaToken) must, once the
// member is cryptographically approved, RECORD membership differently per the
// NEXT_PUBLIC_LAB_AS_FOLDER flag:
//
//   flag OFF (default): BYTE-IDENTICAL to before. patchUserSettings sets lab_id
//     on the CURRENT folder and provisionMemberFolder is never called.
//   flag ON: provisionMemberFolder creates+switches to a managed member folder
//     and patchUserSettings is NOT called on the current folder (the Emile-test
//     bug fix). On a provisioning failure it FALLS BACK to the legacy write so the
//     member is never left un-activated.
//
// The flag is read at module-eval time, so each flag state is exercised in its
// own test file run via vi.stubEnv + vi.resetModules + dynamic import.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Crypto / relay deps are stubbed so the "approved + sealed" gate passes and the
// test focuses on the post-approval record branch.
vi.mock("../lab-do-client", () => ({
  getLabRemote: vi.fn(async () => ({
    record: {
      head: { username: "manny" },
      members: [{ username: "dana" }],
    },
    envelopes: [{ generation: 0 }],
  })),
}));

vi.mock("../lab-key", () => ({
  openLabKeyCopy: vi.fn(() => undefined), // success = no throw
}));

vi.mock("@/lib/settings/user-settings", () => ({
  patchUserSettings: vi.fn(async () => ({})),
}));

vi.mock("../provision-member-folder", () => ({
  provisionMemberFolder: vi.fn(async () => ({ ok: true, folderId: "f1" })),
}));

const identity = {
  keys: { encryption: { privateKey: new Uint8Array(32) } },
} as unknown as import("@/lib/sharing/identity/storage").StoredIdentity;

async function loadWithFlag(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) vi.stubEnv("NEXT_PUBLIC_LAB_AS_FOLDER", "");
  else vi.stubEnv("NEXT_PUBLIC_LAB_AS_FOLDER", value);

  const activation = await import("../lab-member-activation");
  const settings = await import("@/lib/settings/user-settings");
  const provision = await import("../provision-member-folder");
  return {
    checkAndEnterLab: activation.checkAndEnterLab,
    enterLabViaToken: activation.enterLabViaToken,
    patchUserSettings: vi.mocked(settings.patchUserSettings),
    provisionMemberFolder: vi.mocked(provision.provisionMemberFolder),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkAndEnterLab flag-off (byte-identical legacy behavior)", () => {
  it("sets lab_id on the CURRENT folder and never provisions a member folder", async () => {
    const m = await loadWithFlag(undefined);

    const r = await m.checkAndEnterLab({
      labId: "LAB1",
      username: "dana",
      identity,
    });

    expect(r).toEqual({ entered: true, labId: "LAB1" });
    // Exactly the legacy write: lab_id only, on the current folder.
    expect(m.patchUserSettings).toHaveBeenCalledTimes(1);
    expect(m.patchUserSettings).toHaveBeenCalledWith("dana", { lab_id: "LAB1" });
    expect(m.provisionMemberFolder).not.toHaveBeenCalled();
  });
});

describe("checkAndEnterLab flag-on (managed member folder)", () => {
  it("provisions+switches to a member folder and does NOT write the current folder", async () => {
    const m = await loadWithFlag("1");

    const r = await m.checkAndEnterLab({
      labId: "LAB1",
      username: "dana",
      identity,
      labName: "Fungal Lab",
    });

    expect(r).toEqual({ entered: true, labId: "LAB1" });
    expect(m.provisionMemberFolder).toHaveBeenCalledWith({
      labId: "LAB1",
      username: "dana",
      labName: "Fungal Lab",
    });
    // The current folder's lab_id is NEVER overwritten on the happy path.
    expect(m.patchUserSettings).not.toHaveBeenCalled();
  });

  it("falls back to the legacy current-folder write when provisioning fails", async () => {
    const m = await loadWithFlag("1");
    m.provisionMemberFolder.mockResolvedValueOnce({
      ok: false,
      reason: "no-opfs",
      message: "no opfs",
    });

    const r = await m.checkAndEnterLab({
      labId: "LAB1",
      username: "dana",
      identity,
    });

    expect(r).toEqual({ entered: true, labId: "LAB1" });
    // Never trap the member: fall back to the legacy write.
    expect(m.patchUserSettings).toHaveBeenCalledWith("dana", { lab_id: "LAB1" });
  });
});

describe("enterLabViaToken flag parity", () => {
  it("flag-off sets lab_id on the current folder, no provisioning", async () => {
    const m = await loadWithFlag(undefined);

    const r = await m.enterLabViaToken({
      labId: "LAB9",
      username: "dana",
      oauthEmail: "dana@example.com",
      identity,
      hasPublishedKey: true,
    });

    expect(r).toEqual({ entered: true, labId: "LAB9" });
    expect(m.patchUserSettings).toHaveBeenCalledWith("dana", { lab_id: "LAB9" });
    expect(m.provisionMemberFolder).not.toHaveBeenCalled();
  });

  it("flag-on provisions a member folder and skips the current-folder write", async () => {
    const m = await loadWithFlag("1");

    const r = await m.enterLabViaToken({
      labId: "LAB9",
      username: "dana",
      oauthEmail: "dana@example.com",
      identity,
      hasPublishedKey: true,
      labName: "Token Lab",
    });

    expect(r).toEqual({ entered: true, labId: "LAB9" });
    expect(m.provisionMemberFolder).toHaveBeenCalledWith({
      labId: "LAB9",
      username: "dana",
      labName: "Token Lab",
    });
    expect(m.patchUserSettings).not.toHaveBeenCalled();
  });
});
