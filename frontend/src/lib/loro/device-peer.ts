/**
 * Stable per-device Loro peer id for live edits.
 *
 * Why per-device, not username-derived: two devices (or a reinstall) sharing
 * one username-derived peer id would produce the same Loro peer, causing two
 * independent edit streams to share operation ids. That corrupts CRDT merge in
 * collab. A random per-device peer avoids that; the actors map resolves it back
 * to the username for display.
 *
 * Why NOT BigInt(0): that value is reserved for the deterministic seed commit
 * (see seed.ts seedActorId). If a live edit peer happened to equal the seed peer,
 * the CRDT merge engine would interpret the edit as part of the original seed
 * rather than a new edit from this device.
 */

import { seedActorId } from "./seed";

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

// Cached within the module so repeated calls in one session are stable even
// when localStorage is absent (node test env, SSR, private-browsing incognito).
let _cachedPeer: bigint | null = null;

const STORAGE_KEY = "researchos.loro.device-peer";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return this device's stable Loro peer id.
 *
 * On first call, a random non-zero u64 is generated and persisted in
 * localStorage. Subsequent calls (same process OR same device after reload)
 * return the same value. The module-level cache makes repeated calls within
 * one session free of storage I/O.
 *
 * SSR / no-localStorage safe: if localStorage is unavailable the generated
 * value is still stable for the lifetime of this process (module cache), which
 * is enough for tests and server-rendered contexts.
 */
export function getDevicePeerId(): bigint {
  if (_cachedPeer !== null) return _cachedPeer;

  // Try to load a previously persisted peer id.
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage not available (node, SSR, private-browsing restrictions).
  }

  if (stored !== null) {
    try {
      const parsed = BigInt(stored);
      // Reject 0n -- reserved for the seed peer.
      if (parsed !== seedActorId) {
        _cachedPeer = parsed;
        return _cachedPeer;
      }
    } catch {
      // Corrupt stored value; generate a fresh one below.
    }
  }

  // Generate a fresh random non-zero u64.
  const peer = _generatePeer();

  // Persist best-effort; ignore failures (localStorage may be unavailable).
  try {
    localStorage.setItem(STORAGE_KEY, peer.toString());
  } catch {
    // Best-effort only.
  }

  _cachedPeer = peer;
  return _cachedPeer;
}

/**
 * Clear the module-level cache so the next getDevicePeerId() call exercises
 * the generate-and-persist path. For tests only; do not call in production.
 */
export function _resetDevicePeerCacheForTests(): void {
  _cachedPeer = null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a random non-zero u64 as a bigint.
 *
 * Uses crypto.getRandomValues for cryptographic-quality randomness. If the
 * generated value is 0n (probability 1/2^64, effectively never), bump to 1n
 * so the seed peer reservation is honoured.
 */
function _generatePeer(): bigint {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  // Combine 8 bytes into a u64 bigint (big-endian).
  let value = BigInt(0);
  for (let i = 0; i < 8; i++) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }

  // 0n is reserved for the seed peer.
  if (value === seedActorId) value = BigInt(1);

  return value;
}
