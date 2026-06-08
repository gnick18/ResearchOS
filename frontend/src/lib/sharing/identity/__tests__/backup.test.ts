// Phase 1a backup and recovery, wrap/unwrap, wrong passphrase, mnemonic path,
// device-salt property, and Recovery Words validation.
//
// FAST PARAMS ONLY. Every derive in this file uses tiny Argon2id params so the
// suite stays quick. Never use PROD_KDF_PARAMS here, the 64 MiB cost would make
// the suite unbearably slow.

import { concatBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import {
  deriveWrappingKey,
  generateDeviceSalt,
  generateRecoveryWords,
  generateSalt,
  makeBackupBlob,
  openBackupBlob,
  unwrapKeys,
  validateRecoveryWords,
  wrapKeys,
  type KdfParams,
} from "../backup";
import { generateIdentityKeys } from "../keys";

const FAST: KdfParams = { t: 1, m: 8192, p: 1, dkLen: 32 };

/** Concatenates an identity's two private keys into one bundle to wrap. */
function privateBundle(): Uint8Array {
  const id = generateIdentityKeys();
  return concatBytes(id.encryption.privateKey, id.signing.privateKey);
}

describe("wrap / unwrap", () => {
  it("recovers the bundle when the wrapping key matches", () => {
    const bundle = privateBundle();
    const salt = generateSalt();
    const key = deriveWrappingKey("correct horse battery", salt, null, FAST);

    const wrapped = wrapKeys(bundle, key);
    const recovered = unwrapKeys(wrapped.ciphertext, wrapped.nonce, key);

    expect(Array.from(recovered)).toEqual(Array.from(bundle));
  });

  it("throws when the passphrase is wrong", () => {
    const bundle = privateBundle();
    const salt = generateSalt();
    const rightKey = deriveWrappingKey("right pass", salt, null, FAST);
    const wrongKey = deriveWrappingKey("wrong pass", salt, null, FAST);

    const wrapped = wrapKeys(bundle, rightKey);
    expect(() =>
      unwrapKeys(wrapped.ciphertext, wrapped.nonce, wrongKey),
    ).toThrow();
  });
});

describe("mnemonic (Recovery Words) path", () => {
  it("generates 12 valid Recovery Words", () => {
    const words = generateRecoveryWords();
    expect(words.split(" ")).toHaveLength(12);
    expect(validateRecoveryWords(words)).toBe(true);
  });

  it("rejects tampered Recovery Words", () => {
    const words = generateRecoveryWords();
    const broken = `zzzz ${words.split(" ").slice(1).join(" ")}`;
    expect(validateRecoveryWords(broken)).toBe(false);
  });

  it("round-trips the bundle using the mnemonic verbatim as the passphrase", () => {
    const bundle = privateBundle();
    const words = generateRecoveryWords();
    const salt = generateSalt();

    // No device salt on the mnemonic blob, it is the cross-device rescue path.
    const key = deriveWrappingKey(words, salt, null, FAST);
    const wrapped = wrapKeys(bundle, key);

    const blob = makeBackupBlob(wrapped, salt, FAST);
    const opened = openBackupBlob(blob);
    const rederived = deriveWrappingKey(words, opened.salt, null, FAST);
    const recovered = unwrapKeys(
      opened.ciphertext,
      opened.nonce,
      rederived,
    );

    expect(Array.from(recovered)).toEqual(Array.from(bundle));
  });
});

describe("device-salt property", () => {
  it("unwraps WITH the device salt and fails WITHOUT it", () => {
    const bundle = privateBundle();
    const salt = generateSalt();
    const deviceSalt = generateDeviceSalt();

    // Wrap using a key derived WITH the device salt.
    const boundKey = deriveWrappingKey("user pass", salt, deviceSalt, FAST);
    const wrapped = wrapKeys(bundle, boundKey);

    // WITH the device salt, the same key reproduces and unwrap succeeds.
    const withDevice = deriveWrappingKey("user pass", salt, deviceSalt, FAST);
    const recovered = unwrapKeys(
      wrapped.ciphertext,
      wrapped.nonce,
      withDevice,
    );
    expect(Array.from(recovered)).toEqual(Array.from(bundle));

    // WITHOUT the device salt (same passphrase, same salt), the key differs and
    // authentication fails. This is the directory-breach protection.
    const withoutDevice = deriveWrappingKey("user pass", salt, null, FAST);
    expect(() =>
      unwrapKeys(wrapped.ciphertext, wrapped.nonce, withoutDevice),
    ).toThrow();
  });

  it("derives a different key with vs without the device salt", () => {
    const salt = generateSalt();
    const deviceSalt = generateDeviceSalt();
    const a = deriveWrappingKey("p", salt, deviceSalt, FAST);
    const b = deriveWrappingKey("p", salt, null, FAST);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("backup blob serialization", () => {
  it("round-trips a blob through make / open", () => {
    const bundle = privateBundle();
    const salt = generateSalt();
    const key = deriveWrappingKey("pp", salt, null, FAST);
    const wrapped = wrapKeys(bundle, key);

    const blob = makeBackupBlob(wrapped, salt, FAST);
    expect(blob.v).toBe(1);
    expect(blob.alg).toBe("argon2id");

    // Survives a JSON trip (the directory stores it as an opaque string field).
    const reparsed = JSON.parse(JSON.stringify(blob));
    const opened = openBackupBlob(reparsed);

    expect(Array.from(opened.salt)).toEqual(Array.from(salt));
    expect(Array.from(opened.nonce)).toEqual(Array.from(wrapped.nonce));
    expect(Array.from(opened.ciphertext)).toEqual(
      Array.from(wrapped.ciphertext),
    );

    const rederived = deriveWrappingKey("pp", opened.salt, null, FAST);
    const recovered = unwrapKeys(
      opened.ciphertext,
      opened.nonce,
      rederived,
    );
    expect(Array.from(recovered)).toEqual(Array.from(bundle));
  });

  it("rejects an unsupported blob version", () => {
    const bundle = privateBundle();
    const salt = generateSalt();
    const key = deriveWrappingKey("pp", salt, null, FAST);
    const blob = makeBackupBlob(wrapKeys(bundle, key), salt, FAST);
    const bad = { ...blob, v: 2 as unknown as 1 };
    expect(() => openBackupBlob(bad)).toThrow();
  });

  it("persists dkLen and round-trips it instead of hardcoding 32", () => {
    const bundle = privateBundle();
    const salt = generateSalt();
    const key = deriveWrappingKey("pp", salt, null, FAST);
    const blob = makeBackupBlob(wrapKeys(bundle, key), salt, FAST);
    // The blob now carries the dkLen it was sealed under...
    expect(blob.dkLen).toBe(FAST.dkLen);
    // ...and openBackupBlob round-trips it (not a hardcoded constant).
    expect(openBackupBlob(blob).params.dkLen).toBe(FAST.dkLen);
  });

  it("falls back to 32 for a legacy blob that predates the dkLen field", () => {
    const bundle = privateBundle();
    const salt = generateSalt();
    const key = deriveWrappingKey("pp", salt, null, FAST);
    const blob = makeBackupBlob(wrapKeys(bundle, key), salt, FAST);
    // Simulate an older on-disk blob with no dkLen (the field did not exist).
    const legacy = { ...blob };
    delete (legacy as { dkLen?: number }).dkLen;
    expect(openBackupBlob(legacy).params.dkLen).toBe(32);
  });
});
