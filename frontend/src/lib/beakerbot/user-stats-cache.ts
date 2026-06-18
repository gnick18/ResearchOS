// frontend/src/lib/beakerbot/user-stats-cache.ts
//
// Browser-local per-user stats cache backed by localStorage.
// Keyed per user so two accounts on the same machine never share
// a snapshot. SSR-safe: all reads and writes no-op when `window`
// is not defined.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { UserStatsSummary } from "./entry-lines";

// Re-export so callers can import the type from this module if they
// prefer (one import site handles both the functions and the type).
export type { UserStatsSummary };

// ─── Storage key ─────────────────────────────────────────────────────────────

/** Returns the localStorage key for a given user identifier. */
function storageKey(user: string): string {
  return `ros:beakerbot-stats:${user}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Read the cached stats snapshot for a user.
 *
 * Returns null when:
 *   - called during SSR (no `window` object)
 *   - the key does not exist in localStorage
 *   - the stored value is not valid JSON (malformed or truncated)
 *   - any unexpected error occurs reading localStorage
 */
export function readUserStats(user: string): UserStatsSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(user));
    if (raw === null) return null;
    return JSON.parse(raw) as UserStatsSummary;
  } catch {
    // Malformed JSON or a quota/security error on getItem: treat as cache miss.
    return null;
  }
}

/**
 * Write a stats snapshot for a user.
 *
 * No-ops silently when:
 *   - called during SSR (no `window` object)
 *   - localStorage throws (private mode quota, serialization error, etc.)
 *
 * The caller is responsible for ensuring `summary` contains only the
 * fields that have meaningful (> 0) values; this function stores exactly
 * what it receives.
 */
export function writeUserStats(user: string, summary: UserStatsSummary): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(user), JSON.stringify(summary));
  } catch {
    // Quota exceeded or serialization error: silently swallow so the caller
    // never has to guard this write.
  }
}
