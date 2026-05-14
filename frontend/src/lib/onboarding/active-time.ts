import { patchOnboarding, readOnboarding } from "./sidecar";

/**
 * Cumulative active-engagement tracker. The orchestrator consults
 * `getActiveSeconds()` on its roll tick — when (active_seconds -
 * last_tip_at) crosses the min-gap threshold, the user has earned a
 * tip-fire eligibility.
 *
 * Counter rules (proposal §"Trigger pattern"):
 *  - Ticks at +1 every 1000ms while `document.visibilityState ===
 *    "visible" && document.hasFocus()`. Tab in background, tab without
 *    focus (clicked another window), and tab unloaded all stop the
 *    counter.
 *  - In-memory value is the source of truth during a session; sidecar
 *    flushes at most every 30s and on `visibilitychange` to hidden.
 *  - A crash mid-session loses at most 30s of count.
 *
 * Consumers do NOT need a reactive value — the orchestrator reads
 * `getActiveSeconds()` on its 5s roll tick. `subscribeActiveSeconds()`
 * is provided for the (probable, future) Settings debug surface.
 */

const TICK_MS = 1000;
const FLUSH_MS = 30_000;

let active = 0;
let username: string | null = null;
let lastFlushedActive = 0;
let tickHandle: ReturnType<typeof setInterval> | null = null;
let flushHandle: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<(active: number) => void>();

function isEngaged(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb(active);
    } catch {
      // best-effort; don't let a subscriber take the ticker down
    }
  }
}

function tick(): void {
  if (!isEngaged()) return;
  active += 1;
  notify();
}

async function flush(): Promise<void> {
  if (!username) return;
  if (active === lastFlushedActive) return;
  const snapshot = active;
  try {
    await patchOnboarding(username, (cur) => ({
      ...cur,
      active_seconds: Math.max(cur.active_seconds, snapshot),
    }));
    lastFlushedActive = snapshot;
  } catch (err) {
    console.warn("[onboarding/active-time] flush failed", err);
  }
}

function onVisibilityChange(): void {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") {
    void flush();
  }
}

function onBeforeUnload(): void {
  // Synchronous best-effort — fileService writes are async so we don't
  // get a guarantee here, but kicking off the write is better than
  // silently dropping the last <30s of count.
  void flush();
}

/** Initialize the tracker for the signed-in user. Idempotent: if the
 *  tracker is already running for the same user the call is a no-op.
 *  If a different user is now active, the previous user's count is
 *  flushed first and the in-memory counter is reset. */
export async function initActiveTime(currentUser: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (username === currentUser && tickHandle !== null) return;

  // User change — flush old, reset.
  if (username && username !== currentUser) {
    await flush();
    active = 0;
    lastFlushedActive = 0;
  }

  username = currentUser;

  // Seed from on-disk so the cumulative count survives reloads.
  try {
    const stored = await readOnboarding(currentUser);
    active = stored.active_seconds;
    lastFlushedActive = stored.active_seconds;
  } catch (err) {
    console.warn("[onboarding/active-time] seed read failed", err);
  }

  if (tickHandle === null) {
    tickHandle = setInterval(tick, TICK_MS);
  }
  if (flushHandle === null) {
    flushHandle = setInterval(() => void flush(), FLUSH_MS);
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("beforeunload", onBeforeUnload);
}

/** Tear down the tracker. Used when the user signs out or the provider
 *  unmounts (HMR, user switch). Flushes any pending count first. */
export async function stopActiveTime(): Promise<void> {
  if (typeof window === "undefined") return;
  await flush();
  if (tickHandle !== null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  if (flushHandle !== null) {
    clearInterval(flushHandle);
    flushHandle = null;
  }
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("beforeunload", onBeforeUnload);
  username = null;
  active = 0;
  lastFlushedActive = 0;
}

/** Current in-memory active-seconds counter. Always >= the value
 *  most-recently flushed to disk. */
export function getActiveSeconds(): number {
  return active;
}

/** Bump the in-memory counter and notify subscribers. Test-only helper
 *  — production code should never need this. */
export function __setActiveSecondsForTest(value: number): void {
  active = value;
  notify();
}

/** Subscribe to per-second active-seconds ticks. Returns an unsubscribe
 *  fn. Not currently used by the orchestrator (it polls on the 5s roll
 *  tick), but exposed for any future per-tick UI affordances. */
export function subscribeActiveSeconds(
  cb: (active: number) => void,
): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
