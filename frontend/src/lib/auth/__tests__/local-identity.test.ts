// Identity model simplification, the unified login rebuild, crypto core.
//
// Proves the core property, password / recovery code / recovery words are three
// doors to the same local keypair, and a wrong secret never unlocks. Uses fast
// Argon2id params, never the heavy production defaults.

import { describe, expect, it } from "vitest";

import { type KdfParams } from "@/lib/sharing/identity/backup";
import {
  changePassword,
  createLocalAccount,
  unlockWithPassword,
  unlockWithRecovery,
} from "../local-identity";

const FAST: KdfParams = { t: 1, m: 8, p: 1, dkLen: 32 };

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("local account, create and unlock", () => {
  it("creates a file with public keys, a fingerprint, and two wrapped blobs", () => {
    const acct = createLocalAccount("hunter2", FAST);
    expect(acct.file.version).toBe(1);
    expect(acct.file.x25519PublicKey).toMatch(/^[0-9a-f]+$/);
    expect(acct.file.ed25519PublicKey).toMatch(/^[0-9a-f]+$/);
    expect(acct.file.fingerprint).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);
    expect(acct.file.passwordBlob.alg).toBe("argon2id");
    expect(acct.file.recoveryBlob.alg).toBe("argon2id");
    // The two blobs wrap the same bundle under different secrets, so their
    // ciphertexts and salts differ.
    expect(acct.file.passwordBlob.ciphertext).not.toBe(
      acct.file.recoveryBlob.ciphertext,
    );
    expect(acct.recoveryWords.trim().split(/\s+/)).toHaveLength(12);
    expect(acct.recoveryCode).toContain("-");
  });

  it("unlocks with the correct password and returns the created keys", () => {
    const acct = createLocalAccount("hunter2", FAST);
    const unlocked = unlockWithPassword(acct.file, "hunter2");
    expect(unlocked).not.toBeNull();
    expect(unlocked!.ed25519PublicKey).toBe(acct.file.ed25519PublicKey);
    expect(hex(unlocked!.x25519PrivateKey)).toBe(hex(acct.keys.x25519PrivateKey));
    expect(hex(unlocked!.ed25519PrivateKey)).toBe(
      hex(acct.keys.ed25519PrivateKey),
    );
  });

  it("returns null for a wrong password", () => {
    const acct = createLocalAccount("hunter2", FAST);
    expect(unlockWithPassword(acct.file, "wrong")).toBeNull();
  });

  it("unlocks with the recovery code and with the recovery words", () => {
    const acct = createLocalAccount("hunter2", FAST);
    const viaCode = unlockWithRecovery(acct.file, acct.recoveryCode);
    const viaWords = unlockWithRecovery(acct.file, acct.recoveryWords);
    expect(viaCode).not.toBeNull();
    expect(viaWords).not.toBeNull();
    expect(hex(viaCode!.ed25519PrivateKey)).toBe(
      hex(acct.keys.ed25519PrivateKey),
    );
    expect(hex(viaWords!.ed25519PrivateKey)).toBe(
      hex(acct.keys.ed25519PrivateKey),
    );
  });

  it("returns null for an invalid or non-matching recovery secret", () => {
    const acct = createLocalAccount("hunter2", FAST);
    expect(unlockWithRecovery(acct.file, "not a real code")).toBeNull();
    // A valid-format but different code (a different account's).
    const other = createLocalAccount("other", FAST);
    expect(unlockWithRecovery(acct.file, other.recoveryCode)).toBeNull();
  });
});

describe("local account, change password", () => {
  it("re-wraps under a new password, old password stops working, recovery unchanged", () => {
    const acct = createLocalAccount("old-pw", FAST);
    const updated = changePassword(acct.file, "old-pw", "new-pw", FAST);
    expect(updated).not.toBeNull();

    expect(unlockWithPassword(updated!, "new-pw")).not.toBeNull();
    expect(unlockWithPassword(updated!, "old-pw")).toBeNull();
    // Same identity, recovery still opens it.
    const viaRecovery = unlockWithRecovery(updated!, acct.recoveryCode);
    expect(viaRecovery).not.toBeNull();
    expect(viaRecovery!.ed25519PublicKey).toBe(acct.file.ed25519PublicKey);
  });

  it("returns null when the current password is wrong", () => {
    const acct = createLocalAccount("old-pw", FAST);
    expect(changePassword(acct.file, "wrong", "new-pw", FAST)).toBeNull();
  });
});
