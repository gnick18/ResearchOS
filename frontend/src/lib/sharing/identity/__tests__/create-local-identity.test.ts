// Account creation, the LOCAL-identity path (IDENTITY_OAUTH_ONLY.md, revised
// 2026-06-06). createLocalIdentity must produce a self-contained LOCAL account
// with NO OAuth and NO network: a fresh keypair sealed into the sidecar under a
// fresh recovery code, public keys + fingerprint + createdAt recorded, and
// crucially NO email (publishing to the directory is a separate optional step).
//
// We run the real crypto (fast KDF params) over an in-memory fileService mock
// and stubbed session/gitignore side effects, the same faithful pattern
// sidecar.test.ts uses, so the test asserts the exact sidecar shape and that the
// returned recovery code actually unlocks the keypair back.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();
const setSessionIdentity = vi.fn();

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
  clearSessionIdentity: vi.fn(),
}));

// Imports after the mocks.
import { createLocalIdentity } from "../storage";
import { readSharingIdentity } from "../sidecar";
import { unlockDeviceKeyWithRecovery } from "../device-key";
import { encodePublicKey } from "../keys";

// Fast KDF so Argon2id does not dominate the test. NOT prod params.
const FAST = { t: 1, m: 256, p: 1, dkLen: 32 } as const;

describe("createLocalIdentity", () => {
  beforeEach(() => {
    memFs.clear();
    setSessionIdentity.mockClear();
  });

  it("writes a local-only sidecar (keys + fingerprint + createdAt + recoveryBlob, NO email)", async () => {
    const { recoveryCode } = await createLocalIdentity("alex", FAST);

    const sidecar = await readSharingIdentity("alex");
    expect(sidecar).not.toBeNull();
    expect(sidecar!.version).toBe(1);
    // Local-only: never an email or a published claimedAt.
    expect(sidecar!.email).toBeUndefined();
    expect(sidecar!.claimedAt).toBeUndefined();
    // The local-create marker + the public identity fields are present.
    expect(typeof sidecar!.createdAt).toBe("string");
    expect(typeof sidecar!.x25519PublicKey).toBe("string");
    expect(typeof sidecar!.ed25519PublicKey).toBe("string");
    expect(typeof sidecar!.fingerprint).toBe("string");
    // The keypair is sealed at rest (this is the "an account exists" signal).
    expect(sidecar!.recoveryBlob).toBeTruthy();

    // A real recovery code is handed back exactly once.
    expect(typeof recoveryCode).toBe("string");
    expect(recoveryCode.length).toBeGreaterThan(0);
  });

  it("parks the unlocked key in the session", async () => {
    await createLocalIdentity("alex", FAST);
    expect(setSessionIdentity).toHaveBeenCalledTimes(1);
  });

  it("returns a recovery code that unlocks the sealed keypair back to the published public key", async () => {
    const { recoveryCode } = await createLocalIdentity("alex", FAST);
    const sidecar = await readSharingIdentity("alex");

    const keys = unlockDeviceKeyWithRecovery(
      {
        version: 2,
        x25519PublicKey: sidecar!.x25519PublicKey,
        ed25519PublicKey: sidecar!.ed25519PublicKey,
        fingerprint: sidecar!.fingerprint,
        recoveryBlob: sidecar!.recoveryBlob!,
      },
      recoveryCode,
    );
    expect(keys).not.toBeNull();
    // The unwrapped keypair matches the sidecar's published Ed25519 key.
    expect(encodePublicKey(keys!.signing.publicKey)).toBe(
      sidecar!.ed25519PublicKey,
    );
  });
});
