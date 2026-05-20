"use client";

import { useEffect, useState } from "react";
import {
  readOnboarding,
  type FeaturePicks,
} from "@/lib/onboarding/sidecar";

/**
 * Read the active user's Phase 1 `feature_picks` from the onboarding
 * sidecar. The result is the primary tab-visibility signal for AppShell
 * (Onboarding v3, §10): the chrome composes `feature_picks` with
 * settings.json's `visibleTabs` via `deriveVisibleTabs()` in
 * `feature-picks-tabs.ts`.
 *
 * Return shape:
 *   - `undefined` while the sidecar read is in flight on first mount
 *     (or right after a username change). Treated by `deriveVisibleTabs`
 *     as "fall back to settings.json visibleTabs as-is" — the same
 *     existing-user path L1/L22 demands — so the initial paint sees no
 *     tab flicker for users who never made it through Phase 1.
 *   - `null` when the sidecar's `feature_picks` is null. Same fallback
 *     behavior as above; this is the canonical existing-user state.
 *   - `FeaturePicks` object when Phase 1 has populated it.
 *
 * Reactivity gap (deliberate, flagged for a polish chip):
 *   This hook re-reads on mount and on `username` change. It does NOT
 *   currently react to mid-wizard `patchOnboarding` writes — the
 *   wizard's Next-button writes land on disk via WizardMount's
 *   `handlePatch`, but there's no broadcast channel that this hook
 *   can subscribe to without touching WizardMount.tsx (out of safe
 *   surface for this chip; flagged in the report). Net effect: tabs
 *   the user just picked appear after the next page reload, not the
 *   instant the wizard advances. A follow-up polish chip can add a
 *   zustand mini-store + a `bump()` call after each `patchOnboarding`
 *   write to close this gap without changing the read contract here.
 *
 * The hook itself signs in as the AppShell visible-tabs read; callers
 * outside AppShell may end up reading the same sidecar twice
 * (`WizardMount` already reads it for its own decision tree). That
 * duplication is fine — `readOnboarding` is a single FS read each,
 * no shared cache yet, and the wizard surface is rare.
 */
export function useFeaturePicks(
  username: string | null,
): FeaturePicks | null | undefined {
  const [picks, setPicks] = useState<FeaturePicks | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: the previous user's picks must clear immediately, no I/O involved, so the synchronous setState is the correct shape here.
      setPicks(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sidecar = await readOnboarding(username);
        if (!cancelled) setPicks(sidecar.feature_picks);
      } catch (err) {
        // Don't gate AppShell rendering on a failed sidecar read; treat
        // it as the existing-user fallback so settings.json.visibleTabs
        // remains authoritative. The error is logged so the failure is
        // diagnosable.
        console.warn("[useFeaturePicks] readOnboarding failed", err);
        if (!cancelled) setPicks(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  return picks;
}
