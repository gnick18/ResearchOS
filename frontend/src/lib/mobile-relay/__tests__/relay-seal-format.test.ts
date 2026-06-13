import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

import { openSealed } from "@/lib/sharing/encryption";

// Phone push P2 relies on the RELAY sealing a notifications-pending snapshot to a
// recipient device's X25519 key, which the phone then opens with openSealed (via
// mobile/lib/snapshots.ts unsealSnapshot). The relay cannot import the frontend
// encryption module, so its seal is a hand-port in relay/src/worker.ts. A single
// byte difference (wrong salt, info string, nonce length, or field order) would
// make every P2 push undecryptable on the phone with no error until a device
// test. This locks the format: the block below is copied VERBATIM from
// relay/src/worker.ts sealToRecipient. If it drifts from the worker, this test is
// lying; keep them identical.

const SEAL_INFO = utf8ToBytes("researchos.sharing.seal.v1");

function workerSeal(
  plaintext: Uint8Array,
  recipientX25519PublicKey: Uint8Array,
): Uint8Array {
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(
    ephemeral.secretKey,
    recipientX25519PublicKey,
  );
  const salt = concatBytes(ephemeral.publicKey, recipientX25519PublicKey);
  const key = hkdf(sha256, shared, salt, SEAL_INFO, 32);
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return concatBytes(ephemeral.publicKey, nonce, ciphertext);
}

describe("relay worker seal format (phone push P2)", () => {
  it("a worker-sealed pending snapshot opens with the recipient device key", () => {
    const device = x25519.keygen();
    const snap = {
      kind: "notifications",
      version: 1,
      notifications: [
        {
          id: "relay-shared-2026-06-13T00:00:00.000Z",
          category: "shared",
          title: "ResearchOS",
          body: "Something new was shared with you",
          createdAt: "2026-06-13T00:00:00.000Z",
          read: false,
        },
      ],
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(snap));

    const sealed = workerSeal(plaintext, device.publicKey);
    const opened = openSealed(sealed, device.secretKey);

    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual(snap);
  });

  it("two seals of the same plaintext differ (fresh ephemeral + nonce)", () => {
    const device = x25519.keygen();
    const pt = new TextEncoder().encode("buzz");
    const a = workerSeal(pt, device.publicKey);
    const b = workerSeal(pt, device.publicKey);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    // Both still open to the same plaintext.
    expect(new TextDecoder().decode(openSealed(a, device.secretKey))).toBe("buzz");
    expect(new TextDecoder().decode(openSealed(b, device.secretKey))).toBe("buzz");
  });

  it("the wrong device key cannot open it (AEAD tag fails)", () => {
    const device = x25519.keygen();
    const other = x25519.keygen();
    const sealed = workerSeal(new TextEncoder().encode("secret"), device.publicKey);
    expect(() => openSealed(sealed, other.secretKey)).toThrow();
  });
});
