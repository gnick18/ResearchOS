// Offline method-library cache (offline method-library sync, 2026-06-13).
//
// The laptop publishes the user's WHOLE method library under the "library"
// snapshot (see frontend/src/lib/mobile-relay/library-snapshot.ts). This module
// caches that library locally so the phone can browse + read mode every method
// offline, with versioned updates: a fetch with a new content hash replaces the
// cache, an unchanged hash is a no-op, and a fetch failure falls back to the
// cache (offline).
//
// Device-local AsyncStorage keys (DATA SHAPE, all new + additive, no migration):
//   researchos.library.v1          the cached method entries (LibraryMethodEntry[])
//   researchos.library.version.v1  the cached content hash (string)
//   researchos.library.favorites.v1  local-only favorite uids (string[])
//   researchos.library.optin.v1    did the user opt into offline (boolean)
//
// Favorites + opt-in are PHONE-LOCAL, they never sync back to the laptop. The
// methods + version are a one-way cache of what the laptop published.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Pairing } from '@/lib/pairing';
import { fetchLibrarySnapshot, type LibraryMethodEntry } from '@/lib/snapshots';

const KEY_METHODS = 'researchos.library.v1';
const KEY_VERSION = 'researchos.library.version.v1';
const KEY_FAVORITES = 'researchos.library.favorites.v1';
const KEY_OPTIN = 'researchos.library.optin.v1';

// ---- Methods + version cache ------------------------------------------------

export type CachedLibrary = {
  methods: LibraryMethodEntry[];
  version: string | null;
};

const EMPTY: CachedLibrary = { methods: [], version: null };

/** Load the cached library (methods + version) from AsyncStorage. Returns an
 *  empty library when nothing is cached yet or on any parse failure, so the
 *  caller never has to special-case a cold cache. */
export async function loadCachedLibrary(): Promise<CachedLibrary> {
  try {
    const [rawMethods, version] = await Promise.all([
      AsyncStorage.getItem(KEY_METHODS),
      AsyncStorage.getItem(KEY_VERSION),
    ]);
    const methods = rawMethods ? (JSON.parse(rawMethods) as LibraryMethodEntry[]) : [];
    return {
      methods: Array.isArray(methods) ? methods : [],
      version: version ?? null,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Persist a fetched library snapshot's methods + version to the cache. */
export async function saveLibrary(snap: {
  methods?: LibraryMethodEntry[];
  version?: string;
}): Promise<void> {
  const methods = Array.isArray(snap.methods) ? snap.methods : [];
  await AsyncStorage.multiSet([
    [KEY_METHODS, JSON.stringify(methods)],
    [KEY_VERSION, snap.version ?? ''],
  ]);
}

// ---- Favorites (phone-local) ------------------------------------------------

let favoritesCache: Set<string> | null = null;

/** Load the local-only favorite uids. Cached in memory after the first read. */
export async function getFavorites(): Promise<Set<string>> {
  if (favoritesCache) return favoritesCache;
  try {
    const raw = await AsyncStorage.getItem(KEY_FAVORITES);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    favoritesCache = new Set(Array.isArray(arr) ? arr : []);
  } catch {
    favoritesCache = new Set();
  }
  return favoritesCache;
}

export async function isFavorite(uid: string): Promise<boolean> {
  return (await getFavorites()).has(uid);
}

/** Toggle a method's favorite state (phone-local). Returns the new state. */
export async function toggleFavorite(uid: string): Promise<boolean> {
  const favs = await getFavorites();
  let next: boolean;
  if (favs.has(uid)) {
    favs.delete(uid);
    next = false;
  } else {
    favs.add(uid);
    next = true;
  }
  try {
    await AsyncStorage.setItem(KEY_FAVORITES, JSON.stringify([...favs]));
  } catch {
    // Best-effort: a failed persist still updates the in-memory cache for this
    // session, it just will not survive a relaunch.
  }
  return next;
}

// ---- Opt-in (did the user choose to keep the library offline) ---------------

/** Whether the user opted into keeping the library on this phone for offline
 *  use. Off by default, so the download prompt is shown until they accept. */
export async function getOptIn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_OPTIN)) === 'true';
  } catch {
    return false;
  }
}

export async function setOptIn(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_OPTIN, value ? 'true' : 'false');
  } catch {
    // Best-effort, same rationale as favorites.
  }
}

// ---- Sync -------------------------------------------------------------------

export type SyncResult =
  | { ok: true; updated: boolean; version: string | null; methods: LibraryMethodEntry[] }
  | { ok: false; offline: true; methods: LibraryMethodEntry[]; version: string | null };

/**
 * Fetch the latest library from the laptop and reconcile it with the cache:
 *   - fetch succeeds + version differs from cached -> save + return updated:true
 *   - fetch succeeds + version matches cached       -> return updated:false
 *   - fetch returns null (laptop not published yet) -> treat as no update
 *   - fetch throws (offline / relay down)           -> fall back to cache
 *
 * Always returns the methods the caller should show (fresh on update, cached
 * otherwise) so the screen can render from one result.
 */
export async function syncLibrary(
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<SyncResult> {
  const cached = await loadCachedLibrary();
  try {
    const snap = await fetchLibrarySnapshot(pairing, deviceSign);
    // Laptop has not published a library yet: keep whatever is cached.
    if (!snap || !Array.isArray(snap.methods)) {
      return { ok: true, updated: false, version: cached.version, methods: cached.methods };
    }
    const fetchedVersion = snap.version ?? null;
    if (fetchedVersion && fetchedVersion === cached.version) {
      // Unchanged, no need to re-save the (identical) methods.
      return { ok: true, updated: false, version: cached.version, methods: cached.methods };
    }
    await saveLibrary(snap);
    return { ok: true, updated: true, version: fetchedVersion, methods: snap.methods };
  } catch {
    // Offline or relay error: the cache is the source of truth at the bench.
    return { ok: false, offline: true, methods: cached.methods, version: cached.version };
  }
}

/**
 * Peek at the laptop's current library version WITHOUT saving, so the UI can
 * show an "update available" chip (a fetched version that differs from the
 * cached one) without applying it until the user taps. Returns null on any
 * fetch failure (offline) so the caller treats it as "no update known".
 */
export async function checkLibraryUpdate(
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<{ cachedVersion: string | null; latestVersion: string | null } | null> {
  try {
    const [cached, snap] = await Promise.all([
      loadCachedLibrary(),
      fetchLibrarySnapshot(pairing, deviceSign),
    ]);
    return { cachedVersion: cached.version, latestVersion: snap?.version ?? null };
  } catch {
    return null;
  }
}

/** Resolve one cached method by its owner-namespaced uid (read mode offline). */
export async function getCachedMethod(uid: string): Promise<LibraryMethodEntry | null> {
  const { methods } = await loadCachedLibrary();
  return methods.find((m) => m.uid === uid) ?? null;
}
