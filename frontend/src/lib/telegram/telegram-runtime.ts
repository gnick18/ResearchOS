/**
 * Live polling-health signal for the Telegram pipeline. Updated by the
 * polling hook, observed by the header status badge so the dot color
 * mirrors what's actually happening to the connection.
 */

export type PollingHealth =
  | "idle"        // not running (no pairing)
  | "standby"     // paired, but another live tab holds the poll lock — this
                  //   tab is a quiet follower (no fighting over the cursor)
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

// --- "Use this tab" takeover request ---------------------------------------
// The standby badge lets the user promote THIS tab to the active poller. The
// request is a tab-local signal: the polling hook (same document) subscribes
// and force-claims the cross-tab lock. Kept as a typed module emitter (not a
// window CustomEvent) so it stays unit-testable and import-traceable.
const takeoverListeners = new Set<() => void>();

export function requestTakeover(): void {
  for (const fn of takeoverListeners) fn();
}

export function subscribeTakeoverRequests(fn: () => void): () => void {
  takeoverListeners.add(fn);
  return () => {
    takeoverListeners.delete(fn);
  };
}
