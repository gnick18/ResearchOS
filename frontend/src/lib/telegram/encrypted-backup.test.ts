// frontend/src/lib/telegram/encrypted-backup.test.ts
//
// Real-crypto unit tests for the encrypted-backup module. Uses node's global
// Web Crypto API (no mocking of subtle.crypto). The backup is keyed off the
// X25519 identity secret via HKDF now (not a password), so the tests pass a
// fixed 32-byte secret in place of the real keypair.
//
// Covers: round-trip, wrong-key rejection, tamper detection, fresh salt per
// encryption, empty token, malformed blobs, sidecar I/O, the botFirstName
// allow-list, the wrong-key (orphaned-after-reset) case, and delete.

import { beforeEach, describe, expect, it, vi } from "vitest";

const memFs = new Map<string, unknown>();
const existing = new Set<string>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
      existing.add(path);
    }),
    fileExists: vi.fn(async (path: string) => existing.has(path)),
    deleteFile: vi.fn(async (path: string) => {
      const had = existing.delete(path);
      memFs.delete(path);
      return had;
    }),
  },
}));

import {
  decryptEncryptedBackup,
  decryptToken,
  deleteEncryptedBackup,
  encryptToken,
  hasEncryptedBackup,
  readEncryptedBackup,
  writeEncryptedBackup,
  type EncryptedPairingPayload,
  type EncryptedTokenSidecar,
} from "./encrypted-backup";

const TOKEN = "1234567890:ABCDEFghijklmnopqrstuvwxyz-_0123456789AB";
// The backup is keyed off the X25519 identity secret (HKDF), not a password. A
// fixed 32-byte secret stands in for the real keypair.
const KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
const WRONG_KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 9));
const USER = "alex";
const SIDECAR_PATH = `users/${USER}/_telegram-encrypted.json`;
const PAYLOAD: EncryptedPairingPayload = {
  botToken: TOKEN,
  chatId: 123456789,
  botUsername: "my_lab_bot",
};

beforeEach(() => {
  memFs.clear();
  existing.clear();
});

describe("encrypted-backup", () => {
  it("round-trips a token through encrypt + decrypt with the same key", async () => {
    const blob = await encryptToken(TOKEN, KEY);
    expect(await decryptToken(blob, KEY)).toBe(TOKEN);
  });

  it("returns null when decrypting with the wrong identity key (no throw)", async () => {
    const blob = await encryptToken(TOKEN, KEY);
    expect(await decryptToken(blob, WRONG_KEY)).toBeNull();
  });

  it("returns null when ciphertext has been tampered with", async () => {
    const blob = await encryptToken(TOKEN, KEY);
    const parts = blob.split(":");
    const cipher = parts[2];
    const middle = Math.floor(cipher.length / 2);
    const ch = cipher[middle];
    const swapped =
      ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
    const tamperedCipher =
      cipher.slice(0, middle) +
      (swapped === ch ? "A" : swapped) +
      cipher.slice(middle + 1);
    const tamperedBlob = `${parts[0]}:${parts[1]}:${tamperedCipher}`;
    expect(await decryptToken(tamperedBlob, KEY)).toBeNull();
  });

  it("produces a different blob each time for the same (token, key)", async () => {
    const a = await encryptToken(TOKEN, KEY);
    const b = await encryptToken(TOKEN, KEY);
    expect(a).not.toBe(b);
    expect(await decryptToken(a, KEY)).toBe(TOKEN);
    expect(await decryptToken(b, KEY)).toBe(TOKEN);
  });

  it("handles an empty token end-to-end", async () => {
    const blob = await encryptToken("", KEY);
    expect(await decryptToken(blob, KEY)).toBe("");
  });

  it("returns null for malformed blobs", async () => {
    expect(await decryptToken("not-a-blob", KEY)).toBeNull();
    expect(await decryptToken("one:two", KEY)).toBeNull();
    expect(await decryptToken("::", KEY)).toBeNull();
    expect(await decryptToken("!!!:!!!:!!!", KEY)).toBeNull();
  });

  it("writes and reads a v1 sidecar at the per-user path", async () => {
    expect(await hasEncryptedBackup(USER)).toBe(false);
    await writeEncryptedBackup(USER, PAYLOAD, KEY);
    expect(await hasEncryptedBackup(USER)).toBe(true);
    const stored = memFs.get(SIDECAR_PATH) as EncryptedTokenSidecar;
    expect(stored.version).toBe(1);
    expect(typeof stored.encrypted_token).toBe("string");
    expect(stored.encrypted_token.split(":")).toHaveLength(3);
    const restored = await decryptEncryptedBackup(USER, KEY);
    expect(restored).not.toBeNull();
    expect(restored!.botToken).toBe(TOKEN);
    expect(restored!.chatId).toBe(PAYLOAD.chatId);
    expect(restored!.botUsername).toBe(PAYLOAD.botUsername);
  });

  it("does not persist botFirstName even when caller attempts to slip it in", async () => {
    const sneaky = {
      botToken: TOKEN,
      chatId: 123456789,
      botUsername: "my_lab_bot",
      botFirstName: "Should Not Survive",
    };
    await writeEncryptedBackup(
      USER,
      sneaky as unknown as EncryptedPairingPayload,
      KEY,
    );
    const restored = await decryptEncryptedBackup(USER, KEY);
    expect(restored).not.toBeNull();
    expect(
      (restored as unknown as { botFirstName?: unknown }).botFirstName,
    ).toBeUndefined();
    expect(Object.keys(restored!).sort()).toEqual([
      "botToken",
      "botUsername",
      "chatId",
    ]);
  });

  it("a different identity key cannot decrypt the backup (orphaned after reset)", async () => {
    await writeEncryptedBackup(USER, PAYLOAD, KEY);
    expect((await decryptEncryptedBackup(USER, KEY))?.botToken).toBe(TOKEN);
    expect(await decryptEncryptedBackup(USER, WRONG_KEY)).toBeNull();
  });

  it("decryptEncryptedBackup returns null when the sidecar is missing", async () => {
    expect(await decryptEncryptedBackup(USER, KEY)).toBeNull();
  });

  it("deleteEncryptedBackup removes the sidecar", async () => {
    await writeEncryptedBackup(USER, PAYLOAD, KEY);
    expect(await hasEncryptedBackup(USER)).toBe(true);
    await deleteEncryptedBackup(USER);
    expect(await hasEncryptedBackup(USER)).toBe(false);
    expect(await readEncryptedBackup(USER)).toBeNull();
  });

  it("readEncryptedBackup returns null for a malformed sidecar payload", async () => {
    memFs.set(SIDECAR_PATH, { version: 2, encrypted_token: "x", saved_at: "x" });
    existing.add(SIDECAR_PATH);
    expect(await readEncryptedBackup(USER)).toBeNull();
    memFs.set(SIDECAR_PATH, { version: 1, encrypted_token: 42, saved_at: "x" });
    expect(await readEncryptedBackup(USER)).toBeNull();
  });
});
