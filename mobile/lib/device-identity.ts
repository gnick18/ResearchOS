// Device identity for the capture relay (pieces B and C). The phone holds its
// OWN Ed25519 signing keypair AND an X25519 sealing keypair, both separate from
// the user's lab identity. Captures and snapshot reads are signed with the
// Ed25519 device key so the relay can bind and later revoke a single phone. The
// X25519 key is the recipient the laptop seals E2E snapshots to, so only this
// phone can open them (the relay never sees a plaintext). Secret bytes come from
// expo-crypto getRandomBytes (32 bytes, native CSPRNG, well under the 0-1024
// limit), so we never need a crypto.getRandomValues polyfill. Each keypair is
// generated once and persisted in expo-secure-store under its own key, distinct
// from the pairing record. House style: no em-dashes, no emojis, no mid-sentence
// colons.
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/curves/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

const DEVICE_KEY = 'researchos.device.key.v1';
// X25519 sealing key, persisted alongside the Ed25519 signing key but under a
// distinct secure-store entry so each can rotate independently.
const DEVICE_X25519_KEY = 'researchos.device.x25519.v1';

type DeviceKey = {
  devicePrivHex: string;
  devicePubHex: string;
};

type DeviceX25519Key = {
  x25519PrivHex: string;
  x25519PubHex: string;
};

const enc = new TextEncoder();

// In-memory caches so repeated reads in one app run skip the secure-store read.
let cached: DeviceKey | null = null;
let cachedX25519: DeviceX25519Key | null = null;

function isDeviceKey(value: unknown): value is DeviceKey {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as DeviceKey).devicePrivHex === 'string' &&
    typeof (value as DeviceKey).devicePubHex === 'string'
  );
}

function isDeviceX25519Key(value: unknown): value is DeviceX25519Key {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as DeviceX25519Key).x25519PrivHex === 'string' &&
    typeof (value as DeviceX25519Key).x25519PubHex === 'string'
  );
}

// Load the stored device key, or generate + persist a fresh one the first time.
// The secret is 32 random bytes from the native CSPRNG; the public key is
// derived from it. Both are stored as lowercase hex.
export async function getOrCreateDeviceKey(): Promise<DeviceKey> {
  if (cached) return cached;

  const stored = await SecureStore.getItemAsync(DEVICE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (isDeviceKey(parsed)) {
        cached = parsed;
        return parsed;
      }
    } catch {
      // Corrupt record, fall through and regenerate.
    }
  }

  const sk = Crypto.getRandomBytes(32);
  const pk = ed25519.getPublicKey(sk);
  const key: DeviceKey = {
    devicePrivHex: bytesToHex(sk),
    devicePubHex: bytesToHex(pk),
  };
  await SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(key));
  cached = key;
  // Make sure the sealing key exists too so a freshly paired phone registers
  // both pubkeys in one go.
  await getOrCreateDeviceX25519Key();
  return key;
}

// Load the stored X25519 sealing key, or generate + persist a fresh one the
// first time. The secret is 32 random bytes from the native CSPRNG, mirroring
// the Ed25519 creation above; the public key is x25519.getPublicKey of it. Both
// are stored as lowercase hex.
export async function getOrCreateDeviceX25519Key(): Promise<DeviceX25519Key> {
  if (cachedX25519) return cachedX25519;

  const stored = await SecureStore.getItemAsync(DEVICE_X25519_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (isDeviceX25519Key(parsed)) {
        cachedX25519 = parsed;
        return parsed;
      }
    } catch {
      // Corrupt record, fall through and regenerate.
    }
  }

  const sk = Crypto.getRandomBytes(32);
  const pk = x25519.getPublicKey(sk);
  const key: DeviceX25519Key = {
    x25519PrivHex: bytesToHex(sk),
    x25519PubHex: bytesToHex(pk),
  };
  await SecureStore.setItemAsync(DEVICE_X25519_KEY, JSON.stringify(key));
  cachedX25519 = key;
  return key;
}

// Sign a canonical UTF-8 message string with the device secret key. Returns a
// lowercase hex signature, matching the relay contract.
export async function signWithDevice(message: string): Promise<string> {
  const key = await getOrCreateDeviceKey();
  const sig = ed25519.sign(enc.encode(message), hexToBytes(key.devicePrivHex));
  return bytesToHex(sig);
}

// The device public key in hex, generating the keypair if needed.
export async function getDevicePubHex(): Promise<string> {
  const key = await getOrCreateDeviceKey();
  return key.devicePubHex;
}

// The device X25519 sealing public key in hex, generating it if needed. This is
// the recipient the laptop seals snapshots to.
export async function getDeviceX25519PubHex(): Promise<string> {
  const key = await getOrCreateDeviceX25519Key();
  return key.x25519PubHex;
}

// ---- E2E unseal (VERBATIM port of frontend/src/lib/sharing/encryption.ts
// openSealed). The construction MUST stay byte-identical to what the laptop
// seals with: HKDF-SHA256 with salt = epk || rpk and info
// "researchos.sharing.seal.v1", XChaCha20-Poly1305, input epk(32)||nonce(24)||ct.
// If you change one, change both. ---------------------------------------------

// HKDF info string, versioned so a future construction change is unambiguous.
const SEAL_INFO = utf8ToBytes('researchos.sharing.seal.v1');

// X25519 public/secret keys and the XChaCha20-Poly1305 nonce are all fixed
// length. Naming them keeps the parsing self-documenting.
const X25519_KEY_LENGTH = 32;
const NONCE_LENGTH = 24;
const DERIVED_KEY_LENGTH = 32;
const HEADER_LENGTH = X25519_KEY_LENGTH + NONCE_LENGTH; // epk || nonce

// Derives the per-message AEAD key from an ECDH shared secret. The salt binds
// the ephemeral public key and the recipient public key, identical to the seal
// side, so the key is unique to this exact (ephemeral, recipient) pair.
function deriveKey(
  shared: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): Uint8Array {
  const salt = concatBytes(ephemeralPublicKey, recipientPublicKey);
  return hkdf(sha256, shared, salt, SEAL_INFO, DERIVED_KEY_LENGTH);
}

// Open a sealed snapshot blob with this phone's X25519 private key. Parses
// epk(32) || nonce(24) || ct, rebuilds the recipient public key to reconstruct
// the HKDF salt, redoes the ECDH, and decrypts. The AEAD verifies the tag, so a
// tampered blob or a wrong key throws.
export async function unsealSnapshot(sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < HEADER_LENGTH) {
    throw new Error(
      `unsealSnapshot: input too short, need at least ${HEADER_LENGTH} bytes, got ${sealed.length}`,
    );
  }
  const key = await getOrCreateDeviceX25519Key();
  const recipientX25519PrivateKey = hexToBytes(key.x25519PrivHex);

  const ephemeralPublicKey = sealed.subarray(0, X25519_KEY_LENGTH);
  const nonce = sealed.subarray(X25519_KEY_LENGTH, HEADER_LENGTH);
  const ciphertext = sealed.subarray(HEADER_LENGTH);

  const recipientPublicKey = x25519.getPublicKey(recipientX25519PrivateKey);
  const shared = x25519.getSharedSecret(
    recipientX25519PrivateKey,
    ephemeralPublicKey,
  );
  const derived = deriveKey(shared, ephemeralPublicKey, recipientPublicKey);
  return xchacha20poly1305(derived, nonce).decrypt(ciphertext);
}
