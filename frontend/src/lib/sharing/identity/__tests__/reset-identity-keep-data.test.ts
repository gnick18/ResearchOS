// Phase C (recovery): resetIdentityKeepData is the lockout escape. It replaces
// the cryptographic identity (a fresh keypair + sidecar + new recovery code)
// while leaving the user's notebook data untouched. We assert the keypair is
// genuinely NEW (different from the prior one) and a fresh recovery code is
// handed back. Same faithful in-memory pattern as create-local-identity.test.ts.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();
const setSessionIdentity = vi.fn();
const clearSessionIdentity = vi.fn();
const clearKeysAtRest = vi.fn(async () => {});

vi.mock("../../../file-system/file-service", () => ({
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

vi.mock("../../../file-system/gitignore", () => ({
  ensureGitignoreEntries: vi.fn(async () => {}),
}));

vi.mock("../session-key", () => ({
  setSessionIdentity: (...args: unknown[]) => setSessionIdentity(...args),
  getSessionIdentity: vi.fn(() => null),
  clearSessionIdentity: (...args: unknown[]) => clearSessionIdentity(...args),
}));

vi.mock("../device-vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../device-vault")>();
  return { ...actual, clearKeysAtRest: () => clearKeysAtRest() };
});

// Imports after the mocks.
import { createLocalIdentity, resetIdentityKeepData } from "../storage";
import { readSharingIdentity } from "../sidecar";

const FAST = { t: 1, m: 256, p: 1, dkLen: 32 } as const;

describe("resetIdentityKeepData", () => {
  beforeEach(() => {
    memFs.clear();
    setSessionIdentity.mockClear();
    clearSessionIdentity.mockClear();
    clearKeysAtRest.mockClear();
  });

  it("replaces the identity with a genuinely NEW keypair + fresh recovery code", async () => {
    await createLocalIdentity("alex", FAST);
    const before = await readSharingIdentity("alex");
    const oldPub = before!.ed25519PublicKey;

    const { recoveryCode } = await resetIdentityKeepData("alex", FAST);

    const after = await readSharingIdentity("alex");
    // Same user, but a brand-new signing key (provenance orphans by design).
    expect(after!.ed25519PublicKey).not.toBe(oldPub);
    expect(after!.recoveryBlob).toBeTruthy();
    expect(typeof recoveryCode).toBe("string");
    expect(recoveryCode.length).toBeGreaterThan(0);
  });

  it("drops the stale identity from the session + at-rest vault first", async () => {
    await createLocalIdentity("alex", FAST);
    clearSessionIdentity.mockClear();
    clearKeysAtRest.mockClear();

    await resetIdentityKeepData("alex", FAST);

    // clearIdentity ran (session lock + vault clear) before the fresh mint.
    expect(clearSessionIdentity).toHaveBeenCalled();
    expect(clearKeysAtRest).toHaveBeenCalled();
  });
});
