"use client";

import { useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { isClassStudentFolder } from "@/lib/lab/lab-mode";
import { useAccountType } from "./useAccountType";

/**
 * Class Mode CT-2: the loading-aware "is the active folder a teaching class the
 * active user is a STUDENT in" hook. The student-side counterpart of
 * useIsClassMode (which is instructor-only), built on the same per-folder settings
 * source so a provisioner write propagates without a route change.
 *
 * A folder is a student class when `lab_kind === "class"` AND the active user is a
 * `member` (not the head), per the pure `isClassStudentFolder` predicate.
 *
 * Returns:
 *   - `undefined` while either read is in flight (or right after a username
 *     change), so callers can suppress class chrome until the answer settles.
 *   - `false` when there is no active user, the folder is a research lab, or the
 *     user is the instructor (head) of a class folder.
 *   - `true` once both reads resolve to a class folder the user is a member of.
 *
 * Flag note: like useIsClassMode this hook does not read CLASS_MODE_ENABLED. The
 * flag gates the WRITERS that ever set `lab_kind === "class"`; with class mode off
 * no folder carries that value, so the hook resolves to `false` everywhere.
 */
export function useIsClassStudent(
  username: string | null,
): boolean | undefined {
  const accountType = useAccountType(username);

  const [labKind, setLabKind] = useState<
    "lab" | "class" | undefined | null
  >(undefined);

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: the previous user's lab_kind must clear immediately, no I/O involved (mirrors useIsClassMode).
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
        // (the safe default, never spuriously enter class mode).
        console.warn("[useIsClassStudent] readUserSettings failed", err);
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

  if (accountType === undefined || labKind === undefined) return undefined;
  if (accountType === null || labKind === null) return false;
  return isClassStudentFolder({ accountType, labKind });
}
