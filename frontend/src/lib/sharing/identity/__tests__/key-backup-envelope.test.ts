// Passkey identity unlock, chunk 1 crypto core. Key-backup envelope.
//
// Confirms the v2 envelope parses, a legacy bare BackupBlob still parses as the
// mnemonic blob (backward compatibility for existing directory rows), and the
// serialize round-trip holds.

import { describe, expect, it } from "vitest";

import { type BackupBlob } from "../backup";
import { type PrfBackupBlob } from "../passkey";
import {
  buildKeyBackupEnvelope,
  parseKeyBackupField,
  serializeKeyBackupEnvelope,
  type KeyBackupEnvelope,
} from "../key-backup-envelope";

const MNEMONIC_BLOB: BackupBlob = {
  v: 1,
  alg: "argon2id",
  t: 3,
  m: 65536,
  p: 1,
  salt: "c2FsdA==",
  nonce: "bm9uY2U=",
  ciphertext: "Y2lwaGVy",
};

const PRF_BLOB: PrfBackupBlob = {
  v: 1,
  alg: "webauthn-prf",
  hkdfSalt: "aGtkZg==",
  nonce: "bm9uY2U=",
  ciphertext: "Y2lwaGVy",
};

describe("key-backup envelope", () => {
  it("parses a legacy bare BackupBlob as the mnemonic blob", () => {
    const legacy = JSON.stringify(MNEMONIC_BLOB);
    const env = parseKeyBackupField(legacy);
    expect(env).not.toBeNull();
    expect(env?.v).toBe(2);
    expect(env?.mnemonic).toEqual(MNEMONIC_BLOB);
    expect(env?.passkeyPrf).toBeUndefined();
  });

  it("parses a v2 envelope with both blobs", () => {
    const env: KeyBackupEnvelope = {
      v: 2,
      mnemonic: MNEMONIC_BLOB,
      passkeyPrf: PRF_BLOB,
    };
    const parsed = parseKeyBackupField(JSON.stringify(env));
    expect(parsed).toEqual(env);
  });

  it("round-trips serialize then parse", () => {
    const env = buildKeyBackupEnvelope(MNEMONIC_BLOB, PRF_BLOB);
    expect(parseKeyBackupField(serializeKeyBackupEnvelope(env))).toEqual(env);
  });

  it("buildKeyBackupEnvelope omits passkeyPrf when not enrolled", () => {
    const env = buildKeyBackupEnvelope(MNEMONIC_BLOB);
    expect(env).toEqual({ v: 2, mnemonic: MNEMONIC_BLOB });
    expect("passkeyPrf" in env).toBe(false);
  });

  it("returns null for absent or unparseable input", () => {
    expect(parseKeyBackupField(null)).toBeNull();
    expect(parseKeyBackupField(undefined)).toBeNull();
    expect(parseKeyBackupField("")).toBeNull();
    expect(parseKeyBackupField("not json")).toBeNull();
    expect(parseKeyBackupField("[1,2,3]")).toBeNull();
    expect(parseKeyBackupField(JSON.stringify({ v: 9, foo: 1 }))).toBeNull();
  });
});
