// Solo-deferred identity: the on-demand mint chokepoint
// (docs/proposals/2026-06-15-account-folder-identity-redesign.md §8).
//
// ensureLocalIdentity is get-or-mint: it mints a keypair the FIRST time a
// keyless solo user takes a sharing action, and is a no-op forever after (never
// forking the identity with a second mint). Same faithful in-memory fileService
// mock pattern as create-local-identity.test.ts.

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
import { ensureLocalIdentity } from "../ensure-identity";
import { readSharingIdentity, writeSharingIdentity } from "../sidecar";

// Fast KDF so Argon2id does not dominate the test. NOT prod params.
const FAST = { t: 1, m: 256, p: 1, dkLen: 32 } as const;

describe("ensureLocalIdentity", () => {
  beforeEach(() => {
    memFs.clear();
    setSessionIdentity.mockClear();
  });

  it("mints on demand for a keyless user and returns a recovery code", async () => {
    // A solo user with no sidecar yet.
    expect(await readSharingIdentity("alex")).toBeNull();

    const res = await ensureLocalIdentity("alex", FAST);

    expect(res.created).toBe(true);
    expect(typeof res.recoveryCode).toBe("string");
    expect(res.recoveryCode!.length).toBeGreaterThan(0);

    // The mint wrote a real local-only sidecar with a sealed keypair.
    const sidecar = await readSharingIdentity("alex");
    expect(sidecar).not.toBeNull();
    expect(sidecar!.recoveryBlob).toBeTruthy();
    expect(sidecar!.email).toBeUndefined();
    // And parked the unlocked key in the session.
    expect(setSessionIdentity).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when a full identity already exists (no second mint)", async () => {
    // First call mints.
    const first = await ensureLocalIdentity("alex", FAST);
    expect(first.created).toBe(true);
    const after = await readSharingIdentity("alex");

    setSessionIdentity.mockClear();

    // Second call must NOT mint or fork the identity.
    const second = await ensureLocalIdentity("alex", FAST);
    expect(second.created).toBe(false);
    expect(second.recoveryCode).toBeUndefined();
    // Sidecar unchanged (same fingerprint), and no new key parked.
    expect((await readSharingIdentity("alex"))!.fingerprint).toBe(
      after!.fingerprint,
    );
    expect(setSessionIdentity).not.toHaveBeenCalled();
  });

  it("is a no-op for a reference sidecar (account identity, no recoveryBlob)", async () => {
    // A reused-folder reference sidecar: public keys, NO recoveryBlob.
    await writeSharingIdentity("alex", {
      version: 1,
      x25519PublicKey: "aa",
      ed25519PublicKey: "bb",
      fingerprint: "cc",
      createdAt: "2026-06-15T00:00:00.000Z",
      recoveryConfirmedAt: null,
    });

    const res = await ensureLocalIdentity("alex", FAST);

    expect(res.created).toBe(false);
    expect(setSessionIdentity).not.toHaveBeenCalled();
    // The reference sidecar is left untouched (no recoveryBlob added).
    expect((await readSharingIdentity("alex"))!.recoveryBlob).toBeUndefined();
  });
});
