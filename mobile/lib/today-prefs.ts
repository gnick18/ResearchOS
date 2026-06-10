/**
 * Today preferences (device-local). Controls whether the Today glance shows at
 * the top of the Notebook tab. Defaults to ON (shown), so existing users keep
 * the glanceable today they already had. Turning it off removes the surface
 * entirely so the bench stays lean for users who want the app minimal. The
 * today data still syncs from the laptop either way; this only gates the
 * render, not the sync.
 *
 * Mirrors the mascot-prefs / interaction-prefs pattern, a sync cache plus load
 * plus set plus subscribe plus a hook. DATA SHAPE: this introduces a new
 * device-local persisted key (researchos.todayPrefs.v1).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TodayPrefs {
  /** Whether the Today glance is shown on the Notebook tab. Default true. */
  showToday: boolean;
}

const KEY = 'researchos.todayPrefs.v1';
const DEFAULT: TodayPrefs = { showToday: true };

let cache: TodayPrefs = DEFAULT;
const listeners = new Set<(p: TodayPrefs) => void>();

export function getTodayPrefs(): TodayPrefs {
  return cache;
}

export async function loadTodayPrefs(): Promise<TodayPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TodayPrefs>;
      // Default-on, so only an explicit false hides it.
      cache = { showToday: parsed.showToday !== false };
    }
  } catch {
    // storage unavailable; keep defaults
  }
  listeners.forEach((fn) => fn(cache));
  return cache;
}

export async function setTodayPrefs(patch: Partial<TodayPrefs>): Promise<TodayPrefs> {
  cache = { ...cache, ...patch };
  listeners.forEach((fn) => fn(cache));
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // best-effort persist
  }
  return cache;
}

export function subscribeTodayPrefs(cb: (p: TodayPrefs) => void): () => void {
  listeners.add(cb);
  cb(cache);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: current prefs + a setter that persists. */
export function useTodayPrefs(): [TodayPrefs, (patch: Partial<TodayPrefs>) => void] {
  const [prefs, setPrefs] = useState<TodayPrefs>(cache);
  useEffect(() => subscribeTodayPrefs(setPrefs), []);
  useEffect(() => {
    void loadTodayPrefs();
  }, []);
  return [prefs, (patch) => void setTodayPrefs(patch)];
}
