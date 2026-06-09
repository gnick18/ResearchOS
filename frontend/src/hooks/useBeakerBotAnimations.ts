"use client";

import { useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";

/**
 * Read the active user's `settings.beakerBotAnimations` preference
 * (beakerbot-joy manager). Mirrors `useAccountType`: reads on mount /
 * username change, then subscribes to `onUserSettingsWritten` so the
 * Settings page toggle propagates live without waiting for a route
 * change.
 *
 * Returns:
 *   - `undefined` while the settings read is in flight (or right after a
 *     username change). CelebrationManager treats this as "don't fire
 *     yet" so a user who turned the toggle OFF never sees a celebration
 *     fire on a slow disk read before the preference resolves.
 *   - `true` when animations are enabled (the default for every existing
 *     user — see DEFAULT_SETTINGS; this is an opt-OUT setting).
 *   - `false` once a read resolves to a user who turned the toggle off.
 *
 * Used by CelebrationManager to suppress the BeakerBot streak-celebration
 * scenes when the user opts out.
 */
export function useBeakerBotAnimations(
  username: string | null,
): boolean | undefined {
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: clear back to the loading state, no I/O involved.
      setEnabled(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) setEnabled(settings.beakerBotAnimations);
      } catch (err) {
        // Don't suppress on a failed read: treat as enabled (the default).
        console.warn("[useBeakerBotAnimations] readUserSettings failed", err);
        if (!cancelled) setEnabled(true);
      }
    })();

    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      setEnabled(event.next.beakerBotAnimations);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  return enabled;
}
