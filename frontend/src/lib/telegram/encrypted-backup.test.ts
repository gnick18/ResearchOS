// frontend/src/lib/telegram/encrypted-backup.test.ts
//
// Real-crypto unit tests for the encrypted-backup module. Uses node's
// global Web Crypto API (no mocking of subtle.crypto). KDF iteration count
// is the production 600k so any wrong-password / tamper detection that
// passes here matches the real behavior — slow, but each test only does
// 1–2 encrypt + decrypt pairs.
//
// Covers:
//   1. Round-trip — encrypt + decrypt with same password returns the
//      original token.
//   2. Wrong password — decrypt returns null (no throw).
//   3. Tampered ciphertext — flipping a byte in the encrypted blob causes
//      decrypt to return null (GCM auth-tag verification).
//   4. Different salts per encryption — same (token, password) twice
//      produces different blobs (random salt + IV).
//   5. Empty token — encrypt + decrypt of "" returns "".
//   6. Malformed blob — wrong segment count / non-base64 → null.
//   7. Sidecar I/O — writeEncryptedBackup writes a v1 sidecar that
//      readEncryptedBackup can round-trip and decrypt.

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
const PASSWORD = "correct horse battery staple";
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
  it("round-trips a token through encrypt + decrypt with the same password", async () => {
    const blob = await encryptToken(TOKEN, PASSWORD);
    const decrypted = await decryptToken(blob, PASSWORD);
    expect(decrypted).toBe(TOKEN);
  });

  it("returns null when decrypting with the wrong password (no throw)", async () => {
    const blob = await encryptToken(TOKEN, PASSWORD);
    const decrypted = await decryptToken(blob, "not-the-password");
    expect(decrypted).toBeNull();
  });

  it("returns null when ciphertext has been tampered with", async () => {
    const blob = await encryptToken(TOKEN, PASSWORD);
    const parts = blob.split(":");
    // Flip a character inside the ciphertext segment. Base64 alphabet is
    // [A-Za-z0-9+/=]; toggling case is safe (still valid base64) but
    // changes the underlying bytes for GCM auth-tag verification.
    const cipher = parts[2];
    const middle = Math.floor(cipher.length / 2);
    const ch = cipher[middle];
    const swapped =
      ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
    const tamperedCipher =
      cipher.slice(0, middle) + (swapped === ch ? "A" : swapped) + cipher.slice(middle + 1);
    const tamperedBlob = `${parts[0]}:${parts[1]}:${tamperedCipher}`;
    const decrypted = await decryptToken(tamperedBlob, PASSWORD);
    expect(decrypted).toBeNull();
  });

  it("produces a different blob each time for the same (token, password)", async () => {
    const a = await encryptToken(TOKEN, PASSWORD);
    const b = await encryptToken(TOKEN, PASSWORD);
    expect(a).not.toBe(b);
    // Sanity: both still decrypt to the same plaintext.
    expect(await decryptToken(a, PASSWORD)).toBe(TOKEN);
    expect(await decryptToken(b, PASSWORD)).toBe(TOKEN);
  });

  it("handles an empty token end-to-end", async () => {
    const blob = await encryptToken("", PASSWORD);
    expect(await decryptToken(blob, PASSWORD)).toBe("");
  });

  it("returns null for malformed blobs", async () => {
    expect(await decryptToken("not-a-blob", PASSWORD)).toBeNull();
    expect(await decryptToken("one:two", PASSWORD)).toBeNull();
    expect(await decryptToken("::", PASSWORD)).toBeNull();
    expect(await decryptToken("!!!:!!!:!!!", PASSWORD)).toBeNull();
  });

  it("writes and reads a v1 sidecar at the per-user path", async () => {
    expect(await hasEncryptedBackup(USER)).toBe(false);
    await writeEncryptedBackup(USER, PAYLOAD, PASSWORD);
    expect(await hasEncryptedBackup(USER)).toBe(true);
    const stored = memFs.get(SIDECAR_PATH) as EncryptedTokenSidecar;
    expect(stored.version).toBe(1);
    expect(typeof stored.encrypted_token).toBe("string");
    expect(stored.encrypted_token.split(":")).toHaveLength(3);
    expect(typeof stored.saved_at).toBe("string");
    const restored = await decryptEncryptedBackup(USER, PASSWORD);
    expect(restored).not.toBeNull();
    expect(restored!.botToken).toBe(TOKEN);
    expect(restored!.chatId).toBe(PAYLOAD.chatId);
    expect(restored!.botUsername).toBe(PAYLOAD.botUsername);
  });

  it("does not persist botFirstName even when caller attempts to slip it in", async () => {
    // Security-manager constraint #6: botFirstName must not be in the
    // encrypted payload. The interface excludes it at compile time, but
    // we also assert at runtime that an as-cast attempt to include it
    // doesn't round-trip through the decrypt path.
    const sneaky = {
      botToken: TOKEN,
      chatId: 123456789,
      botUsername: "my_lab_bot",
      botFirstName: "Should Not Survive",
    };
    await writeEncryptedBackup(USER, sneaky as unknown as EncryptedPairingPayload, PASSWORD);
    const restored = await decryptEncryptedBackup(USER, PASSWORD);
    expect(restored).not.toBeNull();
    expect(restored!.botToken).toBe(TOKEN);
    expect(restored!.chatId).toBe(123456789);
    expect(restored!.botUsername).toBe("my_lab_bot");
    // The decrypt path narrows to the typed contract — botFirstName is
    // not in the returned object even if it was somehow written into the
    // ciphertext payload.
    expect((restored as unknown as { botFirstName?: unknown }).botFirstName).toBeUndefined();
    expect(Object.keys(restored!).sort()).toEqual(["botToken", "botUsername", "chatId"]);
  });

  it("password-change re-encrypt: new password decrypts, old does not", async () => {
    // Security-manager constraints #7+8: when the user changes their
    // _auth.json password, the encrypted backup must be re-encrypted so
    // the old password no longer unlocks it.
    const OLD = "old-password";
    const NEW = "new-password";
    await writeEncryptedBackup(USER, PAYLOAD, OLD);
    expect((await decryptEncryptedBackup(USER, OLD))?.botToken).toBe(TOKEN);

    // Simulate the re-encrypt flow: decrypt with OLD, write with NEW.
    const decrypted = await decryptEncryptedBackup(USER, OLD);
    expect(decrypted).not.toBeNull();
    await writeEncryptedBackup(USER, decrypted!, NEW);

    expect(await decryptEncryptedBackup(USER, NEW)).not.toBeNull();
    expect(await decryptEncryptedBackup(USER, OLD)).toBeNull();
  });

  it("decryptEncryptedBackup returns null with wrong password", async () => {
    await writeEncryptedBackup(USER, PAYLOAD, PASSWORD);
    expect(await decryptEncryptedBackup(USER, "wrong")).toBeNull();
  });

  it("decryptEncryptedBackup returns null when the sidecar is missing", async () => {
    expect(await decryptEncryptedBackup(USER, PASSWORD)).toBeNull();
  });

  it("deleteEncryptedBackup removes the sidecar", async () => {
    await writeEncryptedBackup(USER, PAYLOAD, PASSWORD);
    expect(await hasEncryptedBackup(USER)).toBe(true);
    await deleteEncryptedBackup(USER);
    expect(await hasEncryptedBackup(USER)).toBe(false);
    expect(await readEncryptedBackup(USER)).toBeNull();
  });

  it("readEncryptedBackup returns null for a malformed sidecar payload", async () => {
    memFs.set(SIDECAR_PATH, { version: 2, encrypted_token: "anything", saved_at: "x" });
    existing.add(SIDECAR_PATH);
    expect(await readEncryptedBackup(USER)).toBeNull();

    memFs.set(SIDECAR_PATH, { version: 1, encrypted_token: 42, saved_at: "x" });
    expect(await readEncryptedBackup(USER)).toBeNull();
  });
});
