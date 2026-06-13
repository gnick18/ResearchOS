/**
 * Connection / sync status. A small, app-wide cue for the one bench-critical
 * question: do I know whether this phone is air-gapped, and is the laptop
 * actually syncing? The companion is local-first, so captures always queue on
 * the phone; this hook just tells the user which world they are in.
 *
 * Three states, kept deliberately simple:
 *
 *   synced  - network is up AND we have a recent successful snapshot fetch (the
 *             laptop is publishing). The happy path.
 *   offline - NetInfo reports no network. Captures queue locally and send when
 *             the phone is back online. Nothing is lost.
 *   stale   - network is up but we have no fresh data (no recent successful
 *             fetch, or the last fetch failed). Usually the laptop is asleep or
 *             not publishing, so the relay has nothing new for this phone.
 *
 * Freshness is recorded by the snapshot fetch sites via recordSyncSuccess /
 * recordSyncFailure (best-effort, module-level, no storage). We treat a
 * successful fetch inside the freshness window as "fresh"; older than that, or
 * an unpaired phone with nothing to sync, reads as stale.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

// How long a successful snapshot fetch counts as "fresh". The laptop publishes
// on a short cadence while open, so a few minutes without a fresh fetch is a
// reliable "laptop is asleep / not publishing" signal without false alarms from
// ordinary polling gaps.
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

export type ConnectionState = 'synced' | 'offline' | 'stale';

// ---- Sync freshness (module-level, best-effort, no persistence) -----------
//
// The snapshot fetch sites call recordSyncSuccess on a 200 (or a fixture in
// demo mode) and recordSyncFailure on a thrown fetch. We keep the timestamp of
// the most recent SUCCESS and a flag for whether the last attempt failed, then
// derive freshness from those. Listeners are notified so the hook re-renders
// without polling.

let lastSuccessAt: number | null = null;
let lastAttemptFailed = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

/** Record a successful snapshot fetch (200 from the relay, or a demo fixture).
 *  Marks the data fresh and clears any prior failure flag. Best-effort. */
export function recordSyncSuccess(): void {
  lastSuccessAt = Date.now();
  lastAttemptFailed = false;
  notify();
}

/** Record a failed snapshot fetch (thrown error / non-200). Does not move the
 *  last-success timestamp, so freshness still ages out naturally. Best-effort. */
export function recordSyncFailure(): void {
  lastAttemptFailed = true;
  notify();
}

/** The most recent successful-fetch timestamp (ms epoch), or null if we have
 *  never synced this session. Exposed for the chip's relative-time line. */
export function getLastSyncAt(): number | null {
  return lastSuccessAt;
}

function isFresh(now: number): boolean {
  if (lastSuccessAt == null) return false;
  return now - lastSuccessAt <= FRESHNESS_WINDOW_MS;
}

export interface ConnectionStatus {
  state: ConnectionState;
  /** True when NetInfo reports the device is online (best-effort). */
  online: boolean;
  /** ms-epoch of the last successful snapshot fetch, or null. */
  lastSyncAt: number | null;
}

function derive(online: boolean, now: number): ConnectionState {
  // Offline wins: if there is no network, captures queue locally, full stop.
  if (!online) return 'offline';
  // Online but stale: no fresh data (laptop asleep / not publishing, or the
  // last fetch failed). lastAttemptFailed forces stale even inside the window
  // so a sudden relay outage is visible right away.
  if (!isFresh(now) || lastAttemptFailed) return 'stale';
  return 'synced';
}

/**
 * useConnectionStatus. Combines NetInfo online/offline with the recorded sync
 * freshness into one of three states. Re-renders on network changes and on
 * recordSyncSuccess / recordSyncFailure, plus a slow tick so a fresh sync ages
 * into "stale" on its own without any new event.
 */
export function useConnectionStatus(): ConnectionStatus {
  const [online, setOnline] = useState<boolean>(true);
  // A monotonically-bumped value used only to force a re-derive on sync events
  // and on the freshness tick.
  const [, setTick] = useState(0);

  // Network listener. NetInfo gives isConnected (may be null while unknown); we
  // treat null/undefined as online so a momentarily-unknown state never shows a
  // false "offline" on first paint.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setOnline(s.isConnected !== false);
    });
    // Prime once so we do not wait for the first change event.
    NetInfo.fetch()
      .then((s) => setOnline(s.isConnected !== false))
      .catch(() => {});
    return () => unsub();
  }, []);

  // Re-render on sync success/failure.
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  // Slow freshness tick so "synced" decays to "stale" once the window passes
  // even if no new fetch happens. 30s is fine for a 5-minute window.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const state = derive(online, Date.now());
  return { state, online, lastSyncAt: lastSuccessAt };
}

/** Human relative time for the chip, e.g. "just now", "3 min ago", "1 hr ago".
 *  Falls back to null when we have never synced. */
export function relativeSyncTime(at: number | null, now: number = Date.now()): string | null {
  if (at == null) return null;
  const diff = Math.max(0, now - at);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min === 1) return '1 min ago';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr === 1) return '1 hr ago';
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return day === 1 ? '1 day ago' : `${day} days ago`;
}
