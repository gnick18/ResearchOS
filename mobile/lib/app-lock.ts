/**
 * App lock preferences and biometric helpers (device-local).
 *
 * An opt-in lock that asks for Face ID / fingerprint (or the device passcode as a
 * fallback) before the app opens. Default OFF, so current users see no change.
 * Captures, notes, and methods are unpublished research, so a real lock on the
 * companion is a genuine trust feature, not theater.
 *
 * Mirrors the interaction-prefs / mascot-prefs pattern: a synchronous cache backs
 * the root layout so it can decide whether to gate at first frame without awaiting
 * storage. Call loadAppLockPrefs() once at startup to hydrate it; updates go
 * through setAppLockPrefs and notify subscribers.
 *
 * expo-local-authentication is wrapped in a require guard so a missing native
 * module (web, an odd Expo Go build) never crashes startup. When the module is
 * unavailable the hardware/enrollment checks return false and the pref stays
 * unusable, the toggle disables itself with a one-line explanation.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Loaded lazily and guarded so a missing native module never breaks anything.
let LocalAuthentication: typeof import('expo-local-authentication') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  LocalAuthentication = require('expo-local-authentication');
} catch {
  LocalAuthentication = null;
}

export interface AppLockPrefs {
  /** Whether the biometric app lock is armed. Default false (off). */
  enabled: boolean;
}

const KEY = 'researchos.applock.v1';
const DEFAULT: AppLockPrefs = { enabled: false };

let cache: AppLockPrefs = DEFAULT;
const listeners = new Set<(p: AppLockPrefs) => void>();

export function getAppLockPrefs(): AppLockPrefs {
  return cache;
}

export async function loadAppLockPrefs(): Promise<AppLockPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppLockPrefs>;
      cache = { enabled: parsed.enabled === true };
    }
  } catch {
    // storage unavailable; keep defaults
  }
  listeners.forEach((fn) => fn(cache));
  return cache;
}

export async function setAppLockPrefs(patch: Partial<AppLockPrefs>): Promise<AppLockPrefs> {
  cache = { ...cache, ...patch };
  listeners.forEach((fn) => fn(cache));
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // best-effort persist
  }
  return cache;
}

export function subscribeAppLockPrefs(cb: (p: AppLockPrefs) => void): () => void {
  listeners.add(cb);
  cb(cache);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: current prefs + a setter that persists. */
export function useAppLockPrefs(): [AppLockPrefs, (patch: Partial<AppLockPrefs>) => void] {
  const [prefs, setPrefs] = useState<AppLockPrefs>(cache);
  useEffect(() => subscribeAppLockPrefs(setPrefs), []);
  useEffect(() => {
    void loadAppLockPrefs();
  }, []);
  return [prefs, (patch) => void setAppLockPrefs(patch)];
}

// ---- Biometric capability + authentication --------------------------------

export interface BiometricCapability {
  /** The device has biometric or passcode hardware the app can use. */
  hasHardware: boolean;
  /** The user has actually enrolled a biometric or a screen lock. */
  isEnrolled: boolean;
  /** Both of the above. Only then can the lock be armed and used. */
  canUse: boolean;
}

/**
 * Probe the device for biometric / device-credential capability. Never throws.
 * When the native module is missing everything is false, so the Settings toggle
 * disables itself.
 */
export async function getBiometricCapability(): Promise<BiometricCapability> {
  if (!LocalAuthentication) {
    return { hasHardware: false, isEnrolled: false, canUse: false };
  }
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return { hasHardware, isEnrolled, canUse: hasHardware && isEnrolled };
  } catch {
    return { hasHardware: false, isEnrolled: false, canUse: false };
  }
}

/**
 * Prompt for Face ID / fingerprint, allowing the device passcode as a fallback.
 * Returns true only on a confirmed success. Never throws; any error reads as a
 * failed unlock so the lock overlay stays put.
 */
export async function authenticateAppLock(): Promise<boolean> {
  if (!LocalAuthentication) return false;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock ResearchOS',
      // Let the user fall back to their phone passcode if biometrics fail or
      // are temporarily unavailable, so they are never hard-locked out.
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    return result.success === true;
  } catch {
    return false;
  }
}
