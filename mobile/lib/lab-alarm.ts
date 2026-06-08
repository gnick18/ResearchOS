/**
 * Lab alarm bus. A tiny pub/sub for a single active "alarm" (a timer that ran
 * out, today). Any source can raise an alarm with showAlarm(); the global
 * LabAlarm overlay (components/LabAlarm.tsx) subscribes and takes over the
 * screen until the user stops it. Kept framework-free so it is trivial to fire
 * from a watcher effect or any other code path.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

export interface ActiveAlarm {
  /** Stable id of the thing that fired (e.g. the timer id), for de-duping. */
  id: string;
  /** What to announce, e.g. the timer's label. */
  title: string;
  /** Optional second line, e.g. the total duration. */
  subtitle?: string;
}

let current: ActiveAlarm | null = null;
const listeners = new Set<(a: ActiveAlarm | null) => void>();

export function showAlarm(alarm: ActiveAlarm): void {
  current = alarm;
  listeners.forEach((fn) => fn(current));
}

export function clearAlarm(): void {
  if (!current) return;
  current = null;
  listeners.forEach((fn) => fn(null));
}

export function getAlarm(): ActiveAlarm | null {
  return current;
}

/** Subscribe to alarm changes. Fires immediately with the current value. */
export function subscribeAlarm(cb: (a: ActiveAlarm | null) => void): () => void {
  listeners.add(cb);
  cb(current);
  return () => {
    listeners.delete(cb);
  };
}
