"use client";

import { useEffect, useState } from "react";
import {
  onSidecarWritten,
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
 * Live reactivity (top-nav visibility fix manager, 2026-05-27): the
 * hook subscribes to `onSidecarWritten` so any successful
 * `patchOnboarding` / `writeOnboarding` for the active user pushes the
 * fresh `feature_picks` into local state without a page reload. This
 * closes the previously-documented "tabs appear after refresh" gap a
 * fresh user hit on first completion of the setup wizard: AppShell
 * mounts before Q1-Q7 run, so the initial `readOnboarding` returns
 * `feature_picks: null`; without the bus the value stayed null forever
 * even after the user picked calendar=no, leaving the default tab set
 * (which includes /calendar) on screen until refresh. Writes for OTHER
 * users are ignored so a multi-tab session doesn't cross-pollute. The
 * bus payload carries the full next sidecar so we skip a redundant
 * `readOnboarding` round-trip.
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

    // Live-update on successful sidecar writes for THIS user. Writes
    // for other usernames (multi-tab / user-switch race) are ignored;
    // the username-dep effect re-fires its own initial read on switch.
    const unsubscribe = onSidecarWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      setPicks(event.next.feature_picks);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  return picks;
}
