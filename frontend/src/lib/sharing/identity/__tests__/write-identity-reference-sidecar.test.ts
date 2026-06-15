// Phase B (account/folder/identity redesign): writeIdentityReferenceSidecar
// REUSES an account's existing keypair in a folder instead of minting a new one.
// It must write a REFERENCE sidecar (public keys + fingerprint + createdAt, NO
// recoveryBlob) and park the already-owned keypair in the session. The keypair
// is anchored at the account level, NOT in this folder, so the folder sidecar
// carries no wrapped key. Same faithful in-memory pattern as
// create-local-identity.test.ts.

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
import { writeIdentityReferenceSidecar } from "../storage";
import { readSharingIdentity } from "../sidecar";
import { generateIdentityKeys } from "../keys";
import { encodePublicKey } from "../keys";

describe("writeIdentityReferenceSidecar", () => {
  beforeEach(() => {
    memFs.clear();
    setSessionIdentity.mockClear();
  });

  it("writes a reference sidecar with the SAME public keys and NO recoveryBlob", async () => {
    const keys = generateIdentityKeys();
    await writeIdentityReferenceSidecar("alex", keys);

    const sidecar = await readSharingIdentity("alex");
    expect(sidecar).not.toBeNull();
    expect(sidecar!.version).toBe(1);
    // The folder REFERENCES the account identity: public fields present...
    expect(sidecar!.x25519PublicKey).toBe(encodePublicKey(keys.encryption.publicKey));
    expect(sidecar!.ed25519PublicKey).toBe(encodePublicKey(keys.signing.publicKey));
    expect(typeof sidecar!.fingerprint).toBe("string");
    expect(typeof sidecar!.createdAt).toBe("string");
    // ...but NO wrapped key: recovery is account-level, not per-folder.
    expect(sidecar!.recoveryBlob).toBeUndefined();
    // And never an email / published marker (that is a separate publish step).
    expect(sidecar!.email).toBeUndefined();
    expect(sidecar!.claimedAt).toBeUndefined();
  });

  it("parks the reused keypair in the session", async () => {
    const keys = generateIdentityKeys();
    await writeIdentityReferenceSidecar("alex", keys);
    expect(setSessionIdentity).toHaveBeenCalledTimes(1);
  });

  it("reuses the SAME keypair across two folders (identity is stable)", async () => {
    const keys = generateIdentityKeys();
    await writeIdentityReferenceSidecar("labA_user", keys);
    await writeIdentityReferenceSidecar("labB_user", keys);

    const a = await readSharingIdentity("labA_user");
    const b = await readSharingIdentity("labB_user");
    // Same account opening two folders -> identical public identity in both.
    expect(a!.ed25519PublicKey).toBe(b!.ed25519PublicKey);
    expect(a!.x25519PublicKey).toBe(b!.x25519PublicKey);
    expect(a!.fingerprint).toBe(b!.fingerprint);
  });
});
