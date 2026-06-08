"use client";

// useLabSession — resolves the lab sign-in gate controller for the active user.
//
// Returns { controller, labId } when ALL THREE conditions hold:
//   1. LAB_TIER_ENABLED is true.
//   2. There is an active currentUser.
//   3. That user has a persisted lab_id in their settings.json.
//
// Returns null in every other case (solo users, flag-off, loading, signed-out).
// A null return means the gate is a no-op for this user.
//
// The controller is stable across renders (useMemo on [labId, currentUser]) so
// it is not recreated on every parent re-render. lab_id is read reactively by
// mirroring the useAccountType pattern: read on mount, re-read on every
// onUserSettingsWritten event for THIS user only.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { createLabSessionController } from "@/lib/lab/lab-session";
import { createLabSessionEffects } from "@/lib/lab/lab-session-effects";
import type { LabSessionController } from "@/lib/lab/lab-session";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Resolves the lab session controller + labId for the active user.
 *
 * Returns `null` when the gate should be a no-op (solo user, flag off,
 * loading, or no active user). Returns `{ controller, labId }` when the user
 * is a lab member and the flag is on.
 */
export function useLabSession(): { controller: LabSessionController; labId: string } | null {
  const { currentUser } = useCurrentUser();

  // undefined = loading; null = no lab_id (solo); string = lab member
  const [labId, setLabId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!currentUser) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: lab_id must clear immediately, no I/O involved
      setLabId(null);
      return;
    }

    // Reset to loading state on user change before the async read resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- username change: clear stale lab_id immediately
    setLabId(undefined);

    let cancelled = false;

    (async () => {
      try {
        const settings = await readUserSettings(currentUser);
        if (!cancelled) setLabId(settings.lab_id ?? null);
      } catch (err) {
        console.warn("[useLabSession] readUserSettings failed", err);
        if (!cancelled) setLabId(null);
      }
    })();

    // Live-update whenever user settings are written for THIS user.
    // Mirrors the onUserSettingsWritten subscription in useAccountType.
    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== currentUser) return;
      setLabId(event.next.lab_id ?? null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentUser]);

  // Build a stable controller. useMemo is safe here because labId and
  // currentUser are both stable between writes; any change to either produces
  // a new controller instance (the old one has no persistent side effects).
  const controller = useMemo(() => {
    if (!LAB_TIER_ENABLED || !currentUser || !labId) return null;
    return createLabSessionController(
      createLabSessionEffects({ labId, username: currentUser }),
    );
  }, [labId, currentUser]);

  if (!LAB_TIER_ENABLED || !currentUser || !labId || !controller) return null;

  return { controller, labId };
}
