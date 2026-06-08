// Identity model simplification, the unified login rebuild, I/O layer.
//
// Runs the real account-store over an in-memory fileService, the faithful
// pattern used elsewhere. Uses fast Argon2id params, never the heavy defaults.

import { describe, expect, it, vi, beforeEach } from "vitest";

import { type KdfParams } from "@/lib/sharing/identity/backup";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
  },
}));

import {
  changeAccountPassword,
  createAndPersistAccount,
  hasLocalAccount,
  loginWithPassword,
  loginWithRecovery,
} from "../account-store";

const FAST: KdfParams = { t: 1, m: 8, p: 1, dkLen: 32 };

describe("account-store", () => {
  beforeEach(() => {
    memFs.clear();
  });

  it("creates, persists, and reports existence", async () => {
    expect(await hasLocalAccount("alex")).toBe(false);
    const created = await createAndPersistAccount("alex", "hunter2", FAST);
    expect(await hasLocalAccount("alex")).toBe(true);
    expect(created.recoveryCode).toContain("-");
    // Persisted at the per-user path.
    expect(memFs.has("users/alex/_account.json")).toBe(true);
  });

  it("logs in with the correct password, rejects a wrong one", async () => {
    const created = await createAndPersistAccount("alex", "hunter2", FAST);
    const ok = await loginWithPassword("alex", "hunter2");
    expect(ok).not.toBeNull();
    expect(ok!.ed25519PublicKey).toBe(created.file.ed25519PublicKey);
    expect(await loginWithPassword("alex", "wrong")).toBeNull();
  });

  it("returns null logging into a user with no account", async () => {
    expect(await loginWithPassword("nobody", "x")).toBeNull();
    expect(await loginWithRecovery("nobody", "x")).toBeNull();
  });

  it("logs in with the recovery code", async () => {
    const created = await createAndPersistAccount("alex", "hunter2", FAST);
    const viaRecovery = await loginWithRecovery("alex", created.recoveryCode);
    expect(viaRecovery).not.toBeNull();
    expect(viaRecovery!.ed25519PublicKey).toBe(created.file.ed25519PublicKey);
  });

  it("changes the password, persists it, old stops working, recovery still works", async () => {
    const created = await createAndPersistAccount("alex", "old-pw", FAST);
    expect(await changeAccountPassword("alex", "old-pw", "new-pw", FAST)).toBe(
      true,
    );
    expect(await loginWithPassword("alex", "new-pw")).not.toBeNull();
    expect(await loginWithPassword("alex", "old-pw")).toBeNull();
    expect(await loginWithRecovery("alex", created.recoveryCode)).not.toBeNull();
  });

  it("change password fails on a wrong current password", async () => {
    await createAndPersistAccount("alex", "old-pw", FAST);
    expect(await changeAccountPassword("alex", "wrong", "new-pw", FAST)).toBe(
      false,
    );
  });
});
