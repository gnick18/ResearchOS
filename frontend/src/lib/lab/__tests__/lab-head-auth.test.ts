import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the file-system service for hermetic tests.
const fakeFiles: Record<string, unknown> = {};
vi.mock("../../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => fakeFiles[path] ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fakeFiles[path] = data;
    }),
    fileExists: vi.fn(async (path: string) => path in fakeFiles),
    deleteFile: vi.fn(async (path: string) => {
      const had = path in fakeFiles;
      delete fakeFiles[path];
      return had;
    }),
    isConnected: vi.fn(() => true),
  },
}));

// Mock the account-password verify so the fallback path is testable in
// isolation. The real verify hits PBKDF2 + the same file service.
const verifyAccountPasswordMock = vi.fn(async (_u: string, _p: string) =>
  fakeFiles[`__account__/${_u}`] === _p,
);
vi.mock("../../auth/password", () => ({
  verifyPassword: (u: string, p: string) => verifyAccountPasswordMock(u, p),
}));

import {
  hasLabHeadPassword,
  removeLabHeadPassword,
  setLabHeadPassword,
  verifyLabHeadPassword,
} from "../lab-head-auth";

describe("lab-head-auth", () => {
  beforeEach(() => {
    for (const k of Object.keys(fakeFiles)) delete fakeFiles[k];
    verifyAccountPasswordMock.mockClear();
  });

  it("hasLabHeadPassword false on fresh user", async () => {
    expect(await hasLabHeadPassword("mira")).toBe(false);
  });

  it("setLabHeadPassword persists, hasLabHeadPassword flips true", async () => {
    await setLabHeadPassword("mira", "topsecret");
    expect(await hasLabHeadPassword("mira")).toBe(true);
  });

  it("verifyLabHeadPassword returns true on correct password", async () => {
    await setLabHeadPassword("mira", "topsecret");
    expect(await verifyLabHeadPassword("mira", "topsecret")).toBe(true);
  });

  it("verifyLabHeadPassword returns false on wrong password (constant-time)", async () => {
    await setLabHeadPassword("mira", "topsecret");
    expect(await verifyLabHeadPassword("mira", "wrong")).toBe(false);
    // sanity: also false for a totally different string with same prefix
    expect(await verifyLabHeadPassword("mira", "topsecre0")).toBe(false);
  });

  it("first-use bootstraps from the account password and persists a hash", async () => {
    // No lab-head file yet. Seed the account-password mock.
    fakeFiles[`__account__/mira`] = "accountpw";
    expect(await hasLabHeadPassword("mira")).toBe(false);

    const ok = await verifyLabHeadPassword("mira", "accountpw");
    expect(ok).toBe(true);
    // Fallback path consulted the account-password verify exactly once.
    expect(verifyAccountPasswordMock).toHaveBeenCalledTimes(1);
    // The bootstrap should have persisted a dedicated hash.
    expect(await hasLabHeadPassword("mira")).toBe(true);

    // Subsequent unlock should NOT hit the account-password fallback.
    verifyAccountPasswordMock.mockClear();
    expect(await verifyLabHeadPassword("mira", "accountpw")).toBe(true);
    expect(verifyAccountPasswordMock).not.toHaveBeenCalled();
  });

  it("first-use returns false when account password is wrong (no bootstrap)", async () => {
    fakeFiles[`__account__/mira`] = "accountpw";
    expect(await verifyLabHeadPassword("mira", "wrongpw")).toBe(false);
    expect(await hasLabHeadPassword("mira")).toBe(false);
  });

  it("removeLabHeadPassword clears the persisted hash", async () => {
    await setLabHeadPassword("mira", "topsecret");
    expect(await hasLabHeadPassword("mira")).toBe(true);
    await removeLabHeadPassword("mira");
    expect(await hasLabHeadPassword("mira")).toBe(false);
  });

  it("setLabHeadPassword(change) writes a new hash with the same created_at", async () => {
    await setLabHeadPassword("mira", "topsecret");
    const first = fakeFiles["users/mira/_lab_head_auth.json"] as {
      created_at: string;
      hash: string;
      updated_at: string;
    };
    // Advance a tick so updated_at can plausibly differ.
    await new Promise((r) => setTimeout(r, 5));
    await setLabHeadPassword("mira", "newpw");
    const second = fakeFiles["users/mira/_lab_head_auth.json"] as {
      created_at: string;
      hash: string;
      updated_at: string;
    };
    expect(second.created_at).toBe(first.created_at);
    expect(second.hash).not.toBe(first.hash);
  });

  it("co-PI scenario — two PIs each have their own gate file", async () => {
    await setLabHeadPassword("mira", "miraspw");
    await setLabHeadPassword("alex", "alexspw");
    expect(await verifyLabHeadPassword("mira", "miraspw")).toBe(true);
    expect(await verifyLabHeadPassword("alex", "alexspw")).toBe(true);
    // Cross-check: mira's password does NOT unlock alex's.
    expect(await verifyLabHeadPassword("alex", "miraspw")).toBe(false);
  });
});
