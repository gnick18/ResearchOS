// Persisted method checklist ticks (companion, 2026-06-13). Reagent and material
// checks in read mode are ticked off as they are gathered at the bench, so they
// must survive a reload while a protocol is in progress (not reset on every
// app refresh). Stored per method in AsyncStorage, keyed by method identity.
//
// This is the LOCAL persistence layer. Syncing the gathered state to the laptop
// rides the command outbox separately (a method-check command), once the laptop
// has somewhere to record it.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'ros.method.checks.';

// Map of `${stepIndex}:${checkIndex}` -> ticked. A flat map keeps it cheap to
// read and write the whole method's state in one AsyncStorage entry.
export type CheckMap = Record<string, boolean>;

export function checkKey(stepIndex: number, checkIndex: number): string {
  return `${stepIndex}:${checkIndex}`;
}

export async function loadMethodChecks(methodKey: string): Promise<CheckMap> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + methodKey);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? (obj as CheckMap) : {};
  } catch {
    return {};
  }
}

export async function saveMethodChecks(methodKey: string, map: CheckMap): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + methodKey, JSON.stringify(map));
  } catch {
    // Best-effort; a failed save just means the ticks are not persisted yet.
  }
}
