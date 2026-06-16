// Phone pairing storage (piece C). After the phone verifies a scanned grant and
// registers its device key with the relay, we persist the bound relation: which
// user this phone reports to, the relay base url to upload against, and this
// phone's own device public key. No raw payload is kept; the verified, parsed
// values are the record. House style: no em-dashes, no emojis, no mid-sentence
// colons.
import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { clearAllCaptures } from '@/lib/captures';

const PAIRING_KEY = 'researchos.pairing.v1';

export type Pairing = {
  // The lab user's identity public key (hex), from the verified grant.
  u: string;
  // The relay base url taken from the grant, never hardcoded.
  relayUrl: string;
  // This phone's device public key (hex), registered with the relay.
  devicePubkey: string;
  // ISO timestamp of when the pairing was saved.
  pairedAt: string;
  // Optional human label carried by the grant, shown on the home tab.
  labName?: string;
  // Optional display name of the paired lab user, carried by the grant. Used to
  // greet them by name on the home tab. Presentation only and not part of the
  // grant signature, so pairings made before this field existed still load and
  // simply greet by time of day with no name.
  userName?: string;
  // The lab user's X25519 encryption public key (hex), their identity sealing
  // key. The phone seals route-capture commands to this key so only the laptop
  // can open them. Optional so pairings made before this field existed still
  // load; when absent the phone falls back to inbox routing.
  userX25519PubHex?: string;
  // Set to true for the reviewer demo pairing. When present, all relay calls
  // are short-circuited to fixtures so no real network traffic ever goes out
  // against the placeholder keys. Optional + back-compatible: all real pairings
  // omit this field entirely.
  demo?: boolean;
};

function isPairing(value: unknown): value is Pairing {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Pairing).u === 'string' &&
    typeof (value as Pairing).relayUrl === 'string' &&
    typeof (value as Pairing).devicePubkey === 'string' &&
    typeof (value as Pairing).pairedAt === 'string'
  );
}

export async function getPairing(): Promise<Pairing | null> {
  const stored = await SecureStore.getItemAsync(PAIRING_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (isPairing(parsed)) {
      return {
        u: parsed.u,
        relayUrl: parsed.relayUrl,
        devicePubkey: parsed.devicePubkey,
        pairedAt: parsed.pairedAt,
        labName: typeof parsed.labName === 'string' ? parsed.labName : undefined,
        userName: typeof parsed.userName === 'string' ? parsed.userName : undefined,
        userX25519PubHex:
          typeof parsed.userX25519PubHex === 'string'
            ? parsed.userX25519PubHex
            : undefined,
        demo: parsed.demo === true ? true : undefined,
      };
    }
  } catch {
    // Corrupt record, treat as not paired.
  }
  return null;
}

export async function setPairing(p: {
  u: string;
  relayUrl: string;
  devicePubkey: string;
  pairedAt?: string;
  labName?: string;
  userName?: string;
  userX25519PubHex?: string;
  demo?: boolean;
}): Promise<Pairing> {
  // A deliberate (re-)pair starts with a clean outbox, so captures sent to a
  // previous lab / dev server / folder never leak into the new connection's
  // "recently sent". This clears on the IDENTITY of the pairing action, not the
  // u: a fresh dev server can hand the phone the same u while pointing at a
  // brand-new (empty) folder, and the phone cannot see that, so keying off u was
  // too narrow. setPairing is the only path a deliberate QR scan takes (auto
  // reconnect just reads the stored record and does NOT call this), so normal
  // use keeps the outbox and only a fresh pair clears it. Demo seeds + manages
  // its own captures, so it is exempt.
  if (!p.demo) {
    try {
      await clearAllCaptures();
    } catch {
      // Best-effort; a clear failure should never block pairing.
    }
  }
  const pairing: Pairing = {
    u: p.u,
    relayUrl: p.relayUrl,
    devicePubkey: p.devicePubkey,
    pairedAt: p.pairedAt ?? new Date().toISOString(),
    labName: p.labName,
    userName: p.userName,
    userX25519PubHex: p.userX25519PubHex,
    demo: p.demo === true ? true : undefined,
  };
  await SecureStore.setItemAsync(PAIRING_KEY, JSON.stringify(pairing));
  // Push the new pairing into the shared store so EVERY mounted consumer (Home,
  // TodayHost, Notebook, etc.) flips to the new connection immediately, with no
  // app restart. A deliberate pair on any screen propagates everywhere.
  setStorePairing(pairing);
  return pairing;
}

// Write a fake pairing record so the reviewer demo mode can exercise the full
// app without a real laptop or relay. The placeholder keys are intentionally
// non-functional; the demo guard in fetchSnapshot and sendCapture ensures they
// never reach the network.
export async function setDemoPairing(): Promise<Pairing> {
  return setPairing({
    u: 'demo0000000000000000000000000000000000000000000000000000000000000000',
    relayUrl: 'https://demo.researchos.app',
    devicePubkey: 'demo0000000000000000000000000000000000000000000000000000000000000000',
    labName: 'Demo Lab',
    demo: true,
  });
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(PAIRING_KEY);
  // Clear the shared store too so an unpair on any screen drops every consumer
  // back to "not connected" right away (otherwise an already-mounted Home /
  // TodayHost keeps fetching with the stale pairing until the app restarts).
  setStorePairing(null);
}

// ---- Shared reactive store ------------------------------------------------
//
// usePairing must be a single shared store, not per-instance state. Each screen
// or host that calls usePairing() previously held its OWN copy loaded on mount,
// so an unpair/pair on one screen left the others (Home, TodayHost) holding a
// stale pairing and fetching against it (still showing demo data after pairing a
// real lab) until the app restarted. A module singleton + useSyncExternalStore
// fixes that: a write anywhere notifies every consumer. Mirrors the pattern in
// lib/today-store.ts.

interface PairingStoreState {
  pairing: Pairing | null;
  loaded: boolean;
}

let storeState: PairingStoreState = { pairing: null, loaded: false };
const pairingListeners = new Set<() => void>();

function emitPairing(): void {
  pairingListeners.forEach((fn) => fn());
}

// Replace the whole state object on each change so getSnapshot returns a stable
// reference between emits (required by useSyncExternalStore).
function setStorePairing(pairing: Pairing | null): void {
  storeState = { pairing, loaded: true };
  emitPairing();
}

// Exported so a non-React consumer (or a test) can read the shared store without
// going through the hook. getPairingSnapshot returns a stable reference between
// emits, as useSyncExternalStore requires.
export function getPairingSnapshot(): PairingStoreState {
  return storeState;
}

export function subscribePairing(listener: () => void): () => void {
  pairingListeners.add(listener);
  return () => {
    pairingListeners.delete(listener);
  };
}

/** Re-read the persisted pairing into the shared store and notify all listeners.
 *  Used for the initial load and by usePairing().refresh (back-compat). */
export async function reloadPairing(): Promise<Pairing | null> {
  const current = await getPairing();
  setStorePairing(current);
  return current;
}

// Guard so concurrent mounts trigger the one-time initial load exactly once.
let initialLoadStarted = false;
function ensureInitialLoad(): void {
  if (initialLoadStarted) return;
  initialLoadStarted = true;
  void reloadPairing();
}

// React hook so screens react to pair/unpair. Reads the shared store, so a
// pair/unpair on ANY screen propagates to every consumer immediately. Same shape
// as before (pairing, loading, refresh) so existing callers are unchanged.
export function usePairing() {
  ensureInitialLoad();
  const { pairing, loaded } = useSyncExternalStore(
    subscribePairing,
    getPairingSnapshot,
    getPairingSnapshot,
  );
  return { pairing, loading: !loaded, refresh: () => reloadPairing() };
}
