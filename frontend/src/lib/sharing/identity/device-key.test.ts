import { describe, expect, it } from "vitest";

import { generateIdentityKeys, type IdentityKeys } from "./keys";
import { type KdfParams } from "./backup";
import {
  unlockDeviceKeyWithRecovery,
  wrapDeviceKey,
  type WrappedDeviceKey,
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

  it("migration: old JSON with extra passkey fields still unlocks via recovery (P3b)", () => {
    // Simulate a pre-P3b sidecar that was serialised with passkeyBlob and
    // passkeyCredentialId. Those fields are now absent from the type but may
    // exist at runtime on JSON that was written before the upgrade. The recovery
    // path must be completely unaffected.
    const keys = generateIdentityKeys();
    const { wrapped, recoveryCode } = wrapDeviceKey(keys, FAST);

    // Cast through unknown to inject the legacy runtime-only fields.
    const legacyWrapped = {
      ...wrapped,
      passkeyBlob: { ct: new Uint8Array(48), nonce: new Uint8Array(12) },
      passkeyCredentialId: "legacy-cred-id",
    } as unknown as WrappedDeviceKey;

    // The recovery unlock reads only recoveryBlob; the extra fields are ignored.
    const recovered = unlockDeviceKeyWithRecovery(legacyWrapped, recoveryCode);
    expect(recovered).not.toBeNull();
    expect(sameKeys(recovered as IdentityKeys, keys)).toBe(true);
  });
});
