// Device identity for the capture relay (piece C). The phone holds its OWN
// Ed25519 keypair, separate from the user's lab identity. Captures are signed
// with this device key so the relay can bind and later revoke a single phone.
// Secret bytes come from expo-crypto getRandomBytes (32 bytes, native CSPRNG,
// well under the 0-1024 limit), so we never need a crypto.getRandomValues
// polyfill. The keypair is generated once and persisted in expo-secure-store
// under a key distinct from the pairing record. House style: no em-dashes, no
// emojis, no mid-sentence colons.
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';

const DEVICE_KEY = 'researchos.device.key.v1';

type DeviceKey = {
  devicePrivHex: string;
  devicePubHex: string;
};

const enc = new TextEncoder();

// In-memory cache so repeated signs in one app run skip the secure-store read.
let cached: DeviceKey | null = null;

function isDeviceKey(value: unknown): value is DeviceKey {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as DeviceKey).devicePrivHex === 'string' &&
    typeof (value as DeviceKey).devicePubHex === 'string'
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
