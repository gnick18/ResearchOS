/**
 * Mascot preferences (device-local). Controls whether the floating BeakerBot
 * mascot shows in the corner of every screen. Defaults to OFF (hidden), so the
 * mascot is opt-in via the Settings screen. The code stays in place; this just
 * gates the mount.
 *
 * A synchronous cache (getMascotPrefs) backs the root layout so it can decide
 * whether to mount the mascot at first frame without awaiting storage. Call
 * loadMascotPrefs() once at startup to hydrate it; updates go through
 * setMascotPrefs and notify subscribers.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface MascotPrefs {
  /** Whether the floating mascot is shown. Default false (hidden). */
  visible: boolean;
}

const KEY = 'researchos.mascotPrefs.v1';
const DEFAULT: MascotPrefs = { visible: false };

let cache: MascotPrefs = DEFAULT;
const listeners = new Set<(p: MascotPrefs) => void>();

export function getMascotPrefs(): MascotPrefs {
  return cache;
}

export async function loadMascotPrefs(): Promise<MascotPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MascotPrefs>;
      cache = { visible: parsed.visible === true };
    }
  } catch {
    // storage unavailable; keep defaults
  }
  listeners.forEach((fn) => fn(cache));
  return cache;
}

export async function setMascotPrefs(patch: Partial<MascotPrefs>): Promise<MascotPrefs> {
  cache = { ...cache, ...patch };
  listeners.forEach((fn) => fn(cache));
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // best-effort persist
  }
  return cache;
}

export function subscribeMascotPrefs(cb: (p: MascotPrefs) => void): () => void {
  listeners.add(cb);
  cb(cache);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: current prefs + a setter that persists. */
export function useMascotPrefs(): [MascotPrefs, (patch: Partial<MascotPrefs>) => void] {
  const [prefs, setPrefs] = useState<MascotPrefs>(cache);
  useEffect(() => subscribeMascotPrefs(setPrefs), []);
  useEffect(() => {
    void loadMascotPrefs();
  }, []);
  return [prefs, (patch) => void setMascotPrefs(patch)];
}
