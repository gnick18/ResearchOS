"use client";

// useLabSession — resolves the lab sign-in gate controller for the active user.
//
// Returns { controller, labId } when ALL THREE conditions hold:
//   1. LAB_TIER_ENABLED is true.
//   2. There is an active currentUser.
//   3. That user has a persisted lab_id in their settings.json.
//
// Returns { loading: true } while the settings read is in flight for a user
// who MIGHT be a lab member; the caller can block rendering until this resolves.
//
// Returns null in every other case (solo users, flag-off, signed-out).
// A null return means the gate is a permanent no-op for this user.
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

export type LabSessionResult =
  | { loading: true }
  | { loading: false; controller: LabSessionController; labId: string }
  | null;

/**
 * Resolves the lab session controller + labId for the active user.
 *
 * Returns `{ loading: true }` while settings are being read for a user who
 * may be a lab member. Returns `null` when the gate is a permanent no-op
 * (solo user, flag off, no active user). Returns `{ controller, labId }` when
 * the user is a confirmed lab member.
 */
export function useLabSession(): LabSessionResult {
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

  if (!LAB_TIER_ENABLED) return null;
  if (!currentUser) return null;

  // Settings read is still in flight: the user MIGHT be a lab member.
  if (labId === undefined) return { loading: true };

  // Confirmed solo (no lab_id in settings).
  if (!labId || !controller) return null;

  return { loading: false, controller, labId };
}
