/**
 * Interaction preferences (device-local). Two app-wide toggles surfaced on the
 * Settings screen:
 *
 * haptics. Whether tap and alert haptics fire. Default on. Routed through the
 * hapticImpact / hapticNotify wrappers below so every call site honors the
 * toggle from one place.
 *
 * reduceMotion. An in-app override that reduces animation on top of the OS
 * setting. Default off, so useReduceMotion() returns exactly the OS value until
 * the user opts in, and existing animations behave unchanged.
 *
 * Mirrors the alarm-prefs pattern, sync cache + load + set + subscribe + a hook.
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface InteractionPrefs {
  haptics: boolean;
  reduceMotion: boolean;
}

const KEY = 'researchos.interactionPrefs.v1';
const DEFAULT: InteractionPrefs = { haptics: true, reduceMotion: false };

let cache: InteractionPrefs = DEFAULT;
const listeners = new Set<(p: InteractionPrefs) => void>();

export function getInteractionPrefs(): InteractionPrefs {
  return cache;
}

export async function loadInteractionPrefs(): Promise<InteractionPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<InteractionPrefs>;
      cache = {
        haptics: parsed.haptics !== false,
        reduceMotion: parsed.reduceMotion === true,
      };
    }
  } catch {
    // storage unavailable; keep defaults
  }
  listeners.forEach((fn) => fn(cache));
  return cache;
}

export async function setInteractionPrefs(
  patch: Partial<InteractionPrefs>,
): Promise<InteractionPrefs> {
  cache = { ...cache, ...patch };
  listeners.forEach((fn) => fn(cache));
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // best-effort persist
  }
  return cache;
}

export function subscribeInteractionPrefs(
  cb: (p: InteractionPrefs) => void,
): () => void {
  listeners.add(cb);
  cb(cache);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: current prefs + a setter that persists. */
export function useInteractionPrefs(): [
  InteractionPrefs,
  (patch: Partial<InteractionPrefs>) => void,
] {
  const [prefs, setPrefs] = useState<InteractionPrefs>(cache);
  useEffect(() => subscribeInteractionPrefs(setPrefs), []);
  useEffect(() => {
    void loadInteractionPrefs();
  }, []);
  return [prefs, (patch) => void setInteractionPrefs(patch)];
}

// ---- Haptics wrappers (honor the toggle from one place) -------------------

/** Light/medium impact tap. No-op when haptics are off. Best-effort. */
export function hapticImpact(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
): void {
  if (!cache.haptics) return;
  Haptics.impactAsync(style).catch(() => {});
}

/** Notification-style haptic (success/warning). No-op when haptics are off. */
export function hapticNotify(type: Haptics.NotificationFeedbackType): void {
  if (!cache.haptics) return;
  Haptics.notificationAsync(type).catch(() => {});
}

// ---- Reduce motion --------------------------------------------------------

/**
 * Effective reduce-motion = the OS setting OR the in-app override. Reads the OS
 * value once on mount (matching the prior per-component behavior) and tracks the
 * in-app pref live.
 */
export function useReduceMotion(): boolean {
  const [osReduce, setOsReduce] = useState(false);
  const [prefs, setPrefs] = useState<InteractionPrefs>(cache);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => active && setOsReduce(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      if (active) setOsReduce(on);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => subscribeInteractionPrefs(setPrefs), []);
  useEffect(() => {
    void loadInteractionPrefs();
  }, []);

  return osReduce || prefs.reduceMotion;
}

// Re-export the haptics enums so call sites can pass a style/type without
// importing expo-haptics directly.
export const ImpactStyle = Haptics.ImpactFeedbackStyle;
export const NotifyType = Haptics.NotificationFeedbackType;
