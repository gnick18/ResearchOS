// Directory key-backup envelope.
//
// Confirms the v2 envelope parses, a legacy bare BackupBlob still parses as the
// mnemonic blob (backward compatibility for existing directory rows), a legacy
// passkeyPrf field is ignored (the passkey was removed in P3b), and the
// serialize round-trip holds.

import { describe, expect, it } from "vitest";

import { type BackupBlob } from "../backup";
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

describe("key-backup envelope", () => {
  it("parses a legacy bare BackupBlob as the mnemonic blob", () => {
    const legacy = JSON.stringify(MNEMONIC_BLOB);
    const env = parseKeyBackupField(legacy);
    expect(env).not.toBeNull();
    expect(env?.v).toBe(2);
    expect(env?.mnemonic).toEqual(MNEMONIC_BLOB);
  });

  it("parses a v2 envelope, ignoring a legacy passkeyPrf field", () => {
    const stored = JSON.stringify({
      v: 2,
      mnemonic: MNEMONIC_BLOB,
      passkeyPrf: { v: 1, alg: "webauthn-prf", x: 1 },
    });
    const parsed = parseKeyBackupField(stored);
    expect(parsed).toEqual({ v: 2, mnemonic: MNEMONIC_BLOB });
  });

  it("round-trips serialize then parse", () => {
    const env: KeyBackupEnvelope = buildKeyBackupEnvelope(MNEMONIC_BLOB);
    expect(parseKeyBackupField(serializeKeyBackupEnvelope(env))).toEqual(env);
  });

  it("buildKeyBackupEnvelope produces a mnemonic-only v2 envelope", () => {
    const env = buildKeyBackupEnvelope(MNEMONIC_BLOB);
    expect(env).toEqual({ v: 2, mnemonic: MNEMONIC_BLOB });
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
