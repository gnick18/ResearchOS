/**
 * Live polling-health signal for the Telegram pipeline. Updated by the
 * polling hook, observed by the header status badge so the dot color
 * mirrors what's actually happening to the connection.
 */

export type PollingHealth =
  | "idle"        // not running (no pairing, or another tab holds the lock)
  | "ok"          // last poll succeeded
  | "retrying"    // transient errors, backing off
  | "auth_error"  // 401 from Telegram — token revoked, user must re-pair
  | "conflict";   // 409 from Telegram — another client is polling the same bot

let current: PollingHealth = "idle";
const listeners = new Set<(h: PollingHealth) => void>();

export function setPollingHealth(next: PollingHealth): void {
  if (current === next) return;
  current = next;
  for (const fn of listeners) fn(next);
}

export function getPollingHealth(): PollingHealth {
  return current;
}

export function subscribePollingHealth(fn: (h: PollingHealth) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
