"use client";

// lib/ui/use-nudge.ts
//
// The shared "shimmer to nudge discovery" hook. A nudge is a gentle, never-nagging
// cue that lights a target (a rail op, a button) to invite a click when, and only
// when, the moment is right. This hook OWNS the anti-annoyance rules so call sites
// just pass the deliberate-trigger condition and render the shimmer class on the
// boolean it gets back.
//
// Anti-annoyance contract.
//   - The target shimmers ONLY while `eligible` is true. The caller supplies the
//     deliberate-trigger condition (for example "a gene is selected and its panel
//     is not open"), so the cue tracks intent rather than firing on mount.
//   - THROTTLE. A per-key seen counter persists in localStorage under
//     "ros.nudge.seen.<key>". One distinct nudge EPISODE is counted each time
//     `eligible` transitions false to true. Once the seen count exceeds `maxSeen`
//     (default 4) the key stops shimmering forever, so a power user is never
//     nagged indefinitely.
//   - Engagement. When the user engages the target, `eligible` naturally goes
//     false at the call site (the panel opens) and the episode ends. A deliberate
//     use should retire the cue outright, so callers invoke `markNudgeUsed(key)`
//     on click, which pushes the seen counter past maxSeen.
//
// SSR-safe. localStorage and window are read lazily inside an effect, never during
// render, so the server never touches them. Reduced motion is handled by the CSS
// fallback on .ros-nudge-shimmer, not here.
//
// Pure-ish and unit tested. The throttle decision lives in the pure helper
// `shouldNudge`, and persistence goes through an injectable `NudgeStore`, so the
// tests in lib/ui/__tests__/use-nudge.test.ts can cover the behavior without a DOM.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";

/** Default cap on how many episodes a single key may shimmer before retiring. */
export const DEFAULT_MAX_SEEN = 4;

const KEY_PREFIX = "ros.nudge.seen.";

/** A minimal persistence surface so tests can inject an in-memory store. */
export interface NudgeStore {
  getSeen(key: string): number;
  setSeen(key: string, value: number): void;
}

function storageKey(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

/** The real, localStorage-backed store (best effort, SSR-safe). */
export const localStorageNudgeStore: NudgeStore = {
  getSeen(key: string): number {
    if (typeof window === "undefined") return 0;
    try {
      const raw = window.localStorage.getItem(storageKey(key));
      if (!raw) return 0;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  },
  setSeen(key: string, value: number): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey(key), String(value));
    } catch {
      // best effort, a blocked or full store just means the cue is not throttled
    }
  },
};

/**
 * The pure throttle decision. The target shimmers when the moment is eligible and
 * the key has not yet exceeded its cap. Once `seen` is greater than `maxSeen` the
 * key is retired and never shimmers again.
 */
export function shouldNudge(
  seen: number,
  maxSeen: number,
  eligible: boolean,
): boolean {
  if (!eligible) return false;
  return seen <= maxSeen;
}

/**
 * Retire a nudge for good by pushing its seen counter past the cap. Callers invoke
 * this on a deliberate engagement (for example a click on the nudged target), so
 * the cue never returns once the user has used the feature. Exported standalone so
 * it can be called from an event handler without re-rendering through the hook.
 */
export function markNudgeUsed(
  key: string,
  maxSeen: number = DEFAULT_MAX_SEEN,
  store: NudgeStore = localStorageNudgeStore,
): void {
  store.setSeen(key, maxSeen + 1);
}

/**
 * Whether the target for `key` should shimmer right now. Pass the deliberate
 * trigger as `opts.eligible`. The hook counts one episode per false to true
 * transition and stops once the cap is exceeded.
 */
export function useNudge(
  key: string,
  opts: { eligible: boolean; maxSeen?: number; store?: NudgeStore },
): boolean {
  const maxSeen = opts.maxSeen ?? DEFAULT_MAX_SEEN;
  const store = opts.store ?? localStorageNudgeStore;
  const { eligible } = opts;

  // Seen count is read lazily in an effect so the server render never touches
  // localStorage. Until it is known we treat the count as 0, which is fine, an
  // unknown key has not been seen yet.
  const [seen, setSeen] = useState(0);
  const prevEligibleRef = useRef(false);
  const hydratedRef = useRef(false);

  // Hydrate the persisted count once on mount (client only).
  useEffect(() => {
    setSeen(store.getSeen(key));
    hydratedRef.current = true;
    // Re-hydrate if the key itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Count one episode on each false to true transition of `eligible`.
  useEffect(() => {
    const prev = prevEligibleRef.current;
    prevEligibleRef.current = eligible;
    if (!hydratedRef.current) return;
    if (eligible && !prev) {
      const next = store.getSeen(key) + 1;
      store.setSeen(key, next);
      setSeen(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, key]);

  return shouldNudge(seen, maxSeen, eligible);
}
