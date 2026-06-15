/**
 * Global Today store. Holds the one shared "Today" snapshot plus the open state
 * for the Today dropdown, so the notif / Today / settings header trio can open
 * Today from ANY tab root (not just Notebook). A single TodayHost (mounted in
 * app/_layout) owns the fetch and renders the panel; the header just toggles
 * `open` here, and any screen can read the snapshot.
 *
 * Plain module singleton + useSyncExternalStore (matches lib/mascot-avoid and
 * the other device-local stores). getSnapshot returns the same object reference
 * between mutations so useSyncExternalStore stays stable.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import { useSyncExternalStore } from 'react';
import type { TodaySnapshot } from './snapshots';

export interface TodayState {
  /** Whether the Today dropdown panel is showing. */
  open: boolean;
  snapshot: TodaySnapshot | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Bumped to ask the host to re-fetch (pull-to-refresh / sync / on open). */
  reloadNonce: number;
}

let state: TodayState = {
  open: false,
  snapshot: null,
  loading: false,
  loaded: false,
  error: null,
  reloadNonce: 0,
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}

export function getTodayState(): TodayState {
  return state;
}

export function subscribeToday(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Merge a partial update (used by the host as the fetch progresses). */
export function setTodayData(patch: Partial<TodayState>): void {
  state = { ...state, ...patch };
  emit();
}

export function openToday(): void {
  // Opening also asks the host for a fresh pull so the panel is never stale.
  state = { ...state, open: true, reloadNonce: state.reloadNonce + 1 };
  emit();
}

export function closeToday(): void {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

export function toggleToday(): void {
  if (state.open) closeToday();
  else openToday();
}

/** Pull-to-refresh / sync hook: ask the host to re-fetch without opening. */
export function requestTodayReload(): void {
  state = { ...state, reloadNonce: state.reloadNonce + 1 };
  emit();
}

/** Full state (the host reads this). */
export function useTodayState(): TodayState {
  return useSyncExternalStore(subscribeToday, getTodayState, getTodayState);
}

/** Count of tasks due today, for the header Today badge. */
export function useTodayBadgeCount(): number {
  const s = useSyncExternalStore(subscribeToday, getTodayState, getTodayState);
  return Array.isArray(s.snapshot?.tasks) ? s.snapshot!.tasks!.length : 0;
}
