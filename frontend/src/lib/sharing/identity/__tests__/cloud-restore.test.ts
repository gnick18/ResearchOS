// Phase 2 Chunk 2A, folderless cross-device key restore.
//
// Two surfaces are tested here:
//   1. The public-key re-derivation in unlockKeysFromRecoveryBlob: the directory
//      blob carries only the wrapped PRIVATE bundle, so the matching public keys
//      must be re-derived from the privates and equal the originals.
//   2. recoverDeviceKeyFromCloud's typed-result mapping over a mocked fetch
//      (200 + blob, 401, 404, offline, wrong-words), with the at-rest persist
//      stubbed out (no IndexedDB in the node test env).
//
// Runs in the node-env vitest project (.test.ts), WebCrypto + Argon2id available.

import { afterEach, describe, expect, it, vi } from "vitest";

import { generateIdentityKeys } from "../keys";
import { wrapDeviceKey, unlockKeysFromRecoveryBlob } from "../device-key";
import { type KdfParams } from "../backup";
import { serializeKeyBackupEnvelope, buildKeyBackupEnvelope } from "../key-backup-envelope";

// Fast Argon2id params so the test does not pay the 64 MiB production cost.
const FAST: KdfParams = { t: 1, m: 256, p: 1, dkLen: 32 };

describe("unlockKeysFromRecoveryBlob", () => {
  it("re-derives the public keys from the wrapped privates and matches the original keypair", () => {
    const keys = generateIdentityKeys();
    const { wrapped, recoveryWords } = wrapDeviceKey(keys, FAST);

    const restored = unlockKeysFromRecoveryBlob(
      wrapped.recoveryBlob,
      recoveryWords,
    );
    expect(restored).not.toBeNull();
    expect(restored!.encryption.privateKey).toEqual(keys.encryption.privateKey);
    expect(restored!.signing.privateKey).toEqual(keys.signing.privateKey);
    // The headline assertion: publics are re-derived (not stored) and still match.
    expect(restored!.encryption.publicKey).toEqual(keys.encryption.publicKey);
    expect(restored!.signing.publicKey).toEqual(keys.signing.publicKey);
  });

  it("also unlocks with the base32 recovery code rendering", () => {
    const keys = generateIdentityKeys();
    const { wrapped, recoveryCode } = wrapDeviceKey(keys, FAST);
    const restored = unlockKeysFromRecoveryBlob(wrapped.recoveryBlob, recoveryCode);
    expect(restored).not.toBeNull();
    expect(restored!.signing.publicKey).toEqual(keys.signing.publicKey);
  });

  it("returns null on the wrong recovery words", () => {
    const keys = generateIdentityKeys();
    const { wrapped } = wrapDeviceKey(keys, FAST);
    const wrong = generateIdentityKeys();
    const wrongWords = wrapDeviceKey(wrong, FAST).recoveryWords;
    expect(unlockKeysFromRecoveryBlob(wrapped.recoveryBlob, wrongWords)).toBeNull();
  });

  it("returns null on malformed recovery input", () => {
    const keys = generateIdentityKeys();
    const { wrapped } = wrapDeviceKey(keys, FAST);
    expect(unlockKeysFromRecoveryBlob(wrapped.recoveryBlob, "not real words")).toBeNull();
  });
});

describe("recoverDeviceKeyFromCloud result mapping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // Import inside each test AFTER stubbing fetch + the at-rest vault, so the
  // module under test binds to our stubs (the vault has no IndexedDB in node).
  async function loadSubject() {
    vi.doMock("../device-vault", () => ({
      persistKeysAtRest: vi.fn(async () => {}),
    }));
    return await import("../cloud-restore");
  }

  it("returns ok on a 200 with a valid blob, persisting at rest", async () => {
    const keys = generateIdentityKeys();
    const { wrapped, recoveryWords } = wrapDeviceKey(keys, FAST);
    const blob = serializeKeyBackupEnvelope(
      buildKeyBackupEnvelope(wrapped.recoveryBlob),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ keyBackupBlob: blob }), { status: 200 }),
      ),
    );
    const { recoverDeviceKeyFromCloud } = await loadSubject();
    const res = await recoverDeviceKeyFromCloud(recoveryWords);
    expect(res).toEqual({ ok: true });
  });

  it("returns wrong-words on a valid blob with bad recovery input", async () => {
    const keys = generateIdentityKeys();
    const { wrapped } = wrapDeviceKey(keys, FAST);
    const blob = serializeKeyBackupEnvelope(
      buildKeyBackupEnvelope(wrapped.recoveryBlob),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ keyBackupBlob: blob }), { status: 200 }),
      ),
    );
    const { recoverDeviceKeyFromCloud } = await loadSubject();
    const res = await recoverDeviceKeyFromCloud("wrong wrong wrong");
    expect(res).toEqual({ ok: false, reason: "wrong-words" });
  });

  it("maps 401 to unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const { recoverDeviceKeyFromCloud } = await loadSubject();
    expect(await recoverDeviceKeyFromCloud("x")).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("maps 404 to no-blob", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    const { recoverDeviceKeyFromCloud } = await loadSubject();
    expect(await recoverDeviceKeyFromCloud("x")).toEqual({
      ok: false,
      reason: "no-blob",
    });
  });

  it("maps a thrown fetch (offline) to offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const { recoverDeviceKeyFromCloud } = await loadSubject();
    expect(await recoverDeviceKeyFromCloud("x")).toEqual({
      ok: false,
      reason: "offline",
    });
  });
});
