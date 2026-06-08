// Lab timer store. Start a countdown at the bench (PCR step, incubation), watch
// it tick down live, and get an OS notification when it fires even if the app
// is backgrounded. Fully on-device, no network. AsyncStorage persists the list
// across app restarts. The in-app countdown is the source of truth, the OS
// notification (see lib/notifications.ts) is a bonus that fails soft.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  cancelTimerNotification,
  scheduleTimerNotification,
} from './notifications';

const TIMERS_KEY = 'researchos.timers.v1';

export type TimerStatus = 'running' | 'done' | 'cancelled';

export type Timer = {
  // Stable row id, generated at call time (see makeId).
  id: string;
  // Optional label the user typed. Empty string when none was given.
  label: string;
  // Total duration in seconds.
  durationSec: number;
  // Epoch ms when the timer started.
  startedAt: number;
  // Epoch ms when the timer should finish (startedAt + durationSec * 1000).
  endsAt: number;
  // The scheduled OS notification id, or null when one could not be scheduled
  // (permission denied or module unavailable). Cleared on cancel.
  notificationId?: string | null;
  status: TimerStatus;
};

// Per-process counter so two timers made in the same millisecond still get
// distinct ids. Kept at module scope on purpose, it only needs to be unique
// within a single app run, the timestamp prefix handles uniqueness across runs.
let idCounter = 0;

function makeId(): string {
  idCounter += 1;
  return `tmr_${Date.now().toString(36)}_${idCounter}`;
}

function isStatus(value: unknown): value is TimerStatus {
  return value === 'running' || value === 'done' || value === 'cancelled';
}

// Type guard so a corrupt or partial entry never crashes a screen.
function isTimer(value: unknown): value is Timer {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Timer).id === 'string' &&
    typeof (value as Timer).label === 'string' &&
    typeof (value as Timer).durationSec === 'number' &&
    typeof (value as Timer).startedAt === 'number' &&
    typeof (value as Timer).endsAt === 'number' &&
    isStatus((value as Timer).status)
  );
}

// Read the list back, newest first. Tolerates a missing or corrupt record by
// returning an empty list rather than throwing.
export async function listTimers(): Promise<Timer[]> {
  const stored = await AsyncStorage.getItem(TIMERS_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTimer);
  } catch {
    return [];
  }
}

async function writeAll(timers: Timer[]): Promise<void> {
  await AsyncStorage.setItem(TIMERS_KEY, JSON.stringify(timers));
}

// Start a new timer. Computes endsAt, schedules the OS notification (best
// effort), and persists. Returns the stored Timer so the screen can update
// without a re-read.
export async function addTimer(input: {
  label?: string;
  durationSec: number;
}): Promise<Timer> {
  const label = (input.label ?? '').trim();
  const durationSec = Math.max(1, Math.round(input.durationSec));
  const startedAt = Date.now();
  const endsAt = startedAt + durationSec * 1000;

  // Schedule the OS alert for the full remaining duration. Null when it could
  // not be scheduled, the in-app countdown still works.
  const notificationId = await scheduleTimerNotification(label, durationSec);

  const timer: Timer = {
    id: makeId(),
    label,
    durationSec,
    startedAt,
    endsAt,
    notificationId,
    status: 'running',
  };
  const current = await listTimers();
  // Newest first so the freshest timer sits at the top of the list.
  await writeAll([timer, ...current]);
  return timer;
}

// Cancel a running timer. Cancels the scheduled notification and marks the row
// cancelled. A no-op if the timer is already gone.
export async function cancelTimer(id: string): Promise<Timer[]> {
  const current = await listTimers();
  const target = current.find((t) => t.id === id);
  if (target) {
    await cancelTimerNotification(target.notificationId);
  }
  const next = current.map((t) =>
    t.id === id ? { ...t, status: 'cancelled' as const, notificationId: null } : t,
  );
  await writeAll(next);
  return next;
}

// Remove every finished or cancelled timer, keeping only the running ones.
export async function clearFinished(): Promise<Timer[]> {
  const current = await listTimers();
  const next = current.filter((t) => t.status === 'running');
  await writeAll(next);
  return next;
}

// Walk the list and flip any running timer whose endsAt has passed to done.
// Returns the next list plus whether anything changed, so callers can avoid a
// needless write or re-render.
function reconcile(timers: Timer[], now: number): { next: Timer[]; changed: boolean } {
  let changed = false;
  const next = timers.map((t) => {
    if (t.status === 'running' && now >= t.endsAt) {
      changed = true;
      return { ...t, status: 'done' as const };
    }
    return t;
  });
  return { next, changed };
}

// React hook. Loads on mount, ticks every second so countdowns update, and
// flips elapsed running timers to done (persisting that flip so a relaunch keeps
// the done state). Exposes a refresh the caller runs after writing.
export function useTimers() {
  const [timers, setTimers] = useState<Timer[]>([]);
  const [loading, setLoading] = useState(true);
  // Hold the latest list in a ref so the 1s tick can reconcile without being a
  // dependency of the interval effect.
  const timersRef = useRef<Timer[]>([]);
  timersRef.current = timers;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const current = await listTimers();
      const { next, changed } = reconcile(current, Date.now());
      if (changed) await writeAll(next);
      setTimers(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 1s tick. Re-renders so the displayed countdown updates, and flips any timer
  // that just elapsed, persisting that one flip.
  useEffect(() => {
    const interval = setInterval(() => {
      const { next, changed } = reconcile(timersRef.current, Date.now());
      if (changed) {
        void writeAll(next);
        setTimers(next);
      } else {
        // No status change, but still re-render so live countdowns move. Reuse
        // the same array references inside a new outer array.
        setTimers((prev) => (prev.length > 0 ? [...prev] : prev));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return { timers, loading, refresh };
}
