/**
 * Stale-polling detection for the Telegram long-poll loop.
 *
 * Telegram's long-poll can drift quietly stale: the HTTPS request keeps
 * returning empty 200s, the polling-health badge stays green, but the
 * bot's session-side cursor has shifted and new messages from the user
 * never arrive. The recovery is trivial — send any message to the bot
 * and the next long-poll refreshes — but the user has no signal that
 * recovery is needed.
 *
 * `isStaleState` is the conjunction of three independent conditions, so
 * each one rules out a class of false positives:
 *
 * 1. N consecutive empty long-polls. Empty alone is normal (most polls
 *    return empty), so we require a run before flagging.
 * 2. M minutes since the last update (or since hook mount if we've
 *    never seen one). Time alone could just mean the user hasn't sent
 *    anything yet.
 * 3. Sidecar exists. Missing sidecar is the unpaired case; that's
 *    handled separately (the future IDB-recovery banner).
 *
 * The pub/sub below mirrors `telegram-runtime`'s pattern: a module-level
 * signal so the polling hook can broadcast and any component (settings,
 * shell, badge) can subscribe without a Provider.
 */

export const STALE_EMPTY_POLLS = 3;
export const STALE_TIME_MS = 7 * 60_000;

export interface StaleStateInput {
  consecutiveEmptyPolls: number;
  /** Timestamp (ms) of the last non-empty update, or null if we've never
   *  received one in this hook's lifetime. */
  lastUpdateAt: number | null;
  /** Timestamp (ms) of when the polling hook started. Used as the
   *  fallback reference when `lastUpdateAt` is null — without it a freshly
   *  mounted hook with no updates would look stale instantly. */
  mountedAt: number;
  sidecarExists: boolean;
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number;
}

export function isStaleState(input: StaleStateInput): boolean {
  if (!input.sidecarExists) return false;
  if (input.consecutiveEmptyPolls < STALE_EMPTY_POLLS) return false;
  const now = input.now ?? Date.now();
  const reference = input.lastUpdateAt ?? input.mountedAt;
  return now - reference > STALE_TIME_MS;
}

export interface StaleSignal {
  isStale: boolean;
  /** Bot username to interpolate in the banner copy. Null when not paired. */
  botUsername: string | null;
}

let current: StaleSignal = { isStale: false, botUsername: null };
const listeners = new Set<(s: StaleSignal) => void>();

export function setStaleSignal(next: StaleSignal): void {
  if (
    current.isStale === next.isStale &&
    current.botUsername === next.botUsername
  ) {
    return;
  }
  current = next;
  for (const fn of listeners) fn(current);
}

export function getStaleSignal(): StaleSignal {
  return current;
}

export function subscribeStaleSignal(
  fn: (s: StaleSignal) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
