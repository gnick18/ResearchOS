import { describe, expect, it } from "vitest";

import { generateIdentityKeys, type IdentityKeys } from "./keys";
import { type KdfParams } from "./backup";
import {
  addPasskeyToDeviceKey,
  hasPasskeyDoor,
  removePasskeyFromDeviceKey,
  unlockDeviceKeyWithPasskey,
  unlockDeviceKeyWithRecovery,
  wrapDeviceKey,
} from "./device-key";

// Fast Argon2id params so the recovery-wrap path is quick in tests.
const FAST: KdfParams = { t: 1, m: 256, p: 1, dkLen: 32 };

function sameKeys(a: IdentityKeys, b: IdentityKeys): boolean {
  const eq = (x: Uint8Array, y: Uint8Array) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    eq(a.encryption.privateKey, b.encryption.privateKey) &&
    eq(a.encryption.publicKey, b.encryption.publicKey) &&
    eq(a.signing.privateKey, b.signing.privateKey) &&
    eq(a.signing.publicKey, b.signing.publicKey)
  );
}

describe("device-key at-rest envelope", () => {
  it("round-trips through the recovery door (code and words)", () => {
    const keys = generateIdentityKeys();
    const { wrapped, recoveryCode, recoveryWords } = wrapDeviceKey(keys, FAST);

    // No plaintext bundle on the wrapped record.
    expect(wrapped).not.toHaveProperty("privateKey");
    expect(wrapped.recoveryBlob).toBeTruthy();
    expect(hasPasskeyDoor(wrapped)).toBe(false);

    const byCode = unlockDeviceKeyWithRecovery(wrapped, recoveryCode);
    const byWords = unlockDeviceKeyWithRecovery(wrapped, recoveryWords);
    expect(byCode).not.toBeNull();
    expect(byWords).not.toBeNull();
    expect(sameKeys(byCode as IdentityKeys, keys)).toBe(true);
    expect(sameKeys(byWords as IdentityKeys, keys)).toBe(true);
  });

  it("rejects a wrong recovery secret", () => {
    const keys = generateIdentityKeys();
    const { wrapped } = wrapDeviceKey(keys, FAST);
    expect(unlockDeviceKeyWithRecovery(wrapped, "not-a-real-code")).toBeNull();
    // A valid-format but wrong code unwraps to a Poly1305 failure -> null.
    const other = wrapDeviceKey(generateIdentityKeys(), FAST);
    expect(
      unlockDeviceKeyWithRecovery(wrapped, other.recoveryCode),
    ).toBeNull();
  });

  it("adds a passkey door and unlocks with the PRF output", () => {
    const keys = generateIdentityKeys();
    const { wrapped } = wrapDeviceKey(keys, FAST);
    const prf = new Uint8Array(32).fill(7);

    const withPasskey = addPasskeyToDeviceKey(wrapped, keys, prf, "cred-1");
    expect(hasPasskeyDoor(withPasskey)).toBe(true);
    expect(withPasskey.passkeyCredentialId).toBe("cred-1");

    const unlocked = unlockDeviceKeyWithPasskey(withPasskey, prf);
    expect(unlocked).not.toBeNull();
    expect(sameKeys(unlocked as IdentityKeys, keys)).toBe(true);
  });

  it("rejects a wrong PRF output and a missing passkey door", () => {
    const keys = generateIdentityKeys();
    const { wrapped } = wrapDeviceKey(keys, FAST);
    // No passkey door yet.
    expect(unlockDeviceKeyWithPasskey(wrapped, new Uint8Array(32))).toBeNull();

    const withPasskey = addPasskeyToDeviceKey(
      wrapped,
      keys,
      new Uint8Array(32).fill(1),
      "cred-1",
    );
    expect(
      unlockDeviceKeyWithPasskey(withPasskey, new Uint8Array(32).fill(2)),
    ).toBeNull();
  });

  it("removes the passkey door but keeps recovery working", () => {
    const keys = generateIdentityKeys();
    const { wrapped, recoveryCode } = wrapDeviceKey(keys, FAST);
    const prf = new Uint8Array(32).fill(9);
    const withPasskey = addPasskeyToDeviceKey(wrapped, keys, prf, "cred-1");

    const stripped = removePasskeyFromDeviceKey(withPasskey);
    expect(hasPasskeyDoor(stripped)).toBe(false);
    expect(unlockDeviceKeyWithPasskey(stripped, prf)).toBeNull();
    // Recovery still unlocks.
    const byCode = unlockDeviceKeyWithRecovery(stripped, recoveryCode);
    expect(sameKeys(byCode as IdentityKeys, keys)).toBe(true);
  });
});
