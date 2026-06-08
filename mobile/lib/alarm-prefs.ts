/**
 * Alarm preferences (device-local). Controls how the lab alarm announces itself
 * when a timer finishes: which sound, and whether sound / vibration play. The
 * animation always shows. Defaults to the full experience (sound + vibration +
 * animation) with the softer "chime" sound.
 *
 * A synchronous cache (getAlarmPrefs) backs the alarm overlay so it can pick the
 * sound at mount without awaiting storage. Call loadAlarmPrefs() once at startup
 * to hydrate it; updates go through setAlarmPrefs and notify subscribers.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AlarmSound = 'chime' | 'digital';

// Bundled alarm audio, shared by the alarm overlay and the settings preview.
/* eslint-disable @typescript-eslint/no-require-imports */
export const ALARM_SOURCES: Record<AlarmSound, number> = {
  chime: require('@/assets/sounds/chime.mp3'),
  digital: require('@/assets/sounds/digital.mp3'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

export interface AlarmPrefs {
  sound: AlarmSound;
  soundOn: boolean;
  vibrateOn: boolean;
}

const KEY = 'researchos.alarmPrefs.v1';
const DEFAULT: AlarmPrefs = { sound: 'chime', soundOn: true, vibrateOn: true };

let cache: AlarmPrefs = DEFAULT;
const listeners = new Set<(p: AlarmPrefs) => void>();

export function getAlarmPrefs(): AlarmPrefs {
  return cache;
}

export async function loadAlarmPrefs(): Promise<AlarmPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AlarmPrefs>;
      cache = {
        sound: parsed.sound === 'digital' ? 'digital' : 'chime',
        soundOn: parsed.soundOn !== false,
        vibrateOn: parsed.vibrateOn !== false,
      };
    }
  } catch {
    // storage unavailable; keep defaults
  }
  listeners.forEach((fn) => fn(cache));
  return cache;
}

export async function setAlarmPrefs(patch: Partial<AlarmPrefs>): Promise<AlarmPrefs> {
  cache = { ...cache, ...patch };
  listeners.forEach((fn) => fn(cache));
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // best-effort persist
  }
  return cache;
}

export function subscribeAlarmPrefs(cb: (p: AlarmPrefs) => void): () => void {
  listeners.add(cb);
  cb(cache);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: current prefs + a setter that persists. */
export function useAlarmPrefs(): [AlarmPrefs, (patch: Partial<AlarmPrefs>) => void] {
  const [prefs, setPrefs] = useState<AlarmPrefs>(cache);
  useEffect(() => subscribeAlarmPrefs(setPrefs), []);
  useEffect(() => {
    void loadAlarmPrefs();
  }, []);
  return [prefs, (patch) => void setAlarmPrefs(patch)];
}

/** Human label for a sound choice. */
export function alarmSoundLabel(sound: AlarmSound): string {
  return sound === 'digital' ? 'Digital' : 'Chime';
}
