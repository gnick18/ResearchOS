"use client";

import { useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { isClassFolder } from "@/lib/lab/lab-mode";
import { useAccountType } from "./useAccountType";

/**
 * Class Mode (CM-P1): the loading-aware "is the active folder a teaching class
 * the active user instructs" hook. Mirrors useIsLabHead / useIsLabMode in shape.
 *
 * A folder is a class when `lab_kind === "class"` AND the active user is a
 * `lab_head` (the instructor), per the pure `isClassFolder` predicate. This hook
 * reads both inputs from the SAME per-folder settings source `useAccountType`
 * subscribes to (`readUserSettings(username)` plus the `onUserSettingsWritten`
 * bus), so a class provisioner write propagates without a route change.
 *
 * Returns:
 *   - `undefined` while either underlying read is in flight (or right after a
 *     username change), so callers can suppress class chrome until the answer
 *     settles, exactly like useIsLabHead.
 *   - `false` when there is no active user, the folder is a research lab, or the
 *     user is a student / member in a class folder (the instructor-only gate).
 *   - `true` once both reads resolve to a class folder headed by this user.
 *
 * NOT wired into AppShell or nav in this lane (that is a later, contended stage).
 * This ships only the predicate hook so downstream teaching chrome can consume it.
 *
 * Flag note: this hook does not read CLASS_MODE_ENABLED. The flag gates the
 * WRITERS that ever set `lab_kind === "class"`; with class mode off no folder
 * carries that value, so the hook resolves to `false` everywhere and is inert.
 */
export function useIsClassMode(
  username: string | null,
): boolean | undefined {
  const accountType = useAccountType(username);

  // The folder's lab_kind, read from the same per-folder settings source and kept
  // live on the same write bus as account_type. `undefined` = still loading;
  // `null` = no active user; otherwise the resolved "lab" | "class" | absent.
  const [labKind, setLabKind] = useState<
    "lab" | "class" | undefined | null
  >(undefined);

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: the previous user's lab_kind must clear immediately, no I/O involved, so the synchronous setState is the correct shape here (mirrors useAccountType).
      setLabKind(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) setLabKind(settings.lab_kind ?? "lab");
      } catch (err) {
        // Don't gate class chrome on a failed read; treat it as a research lab
        // (the safe default, never spuriously enter class mode). Logged so a
        // failure is diagnosable.
        console.warn("[useIsClassMode] readUserSettings failed", err);
        if (!cancelled) setLabKind("lab");
      }
    })();

    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      setLabKind(event.next.lab_kind ?? "lab");
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  // Preserve the loading signal: undefined in either input => undefined out.
  if (accountType === undefined || labKind === undefined) return undefined;
  // Signed-out (null on either) collapses to a definite "not a class".
  if (accountType === null || labKind === null) return false;
  return isClassFolder({ accountType, labKind });
}
