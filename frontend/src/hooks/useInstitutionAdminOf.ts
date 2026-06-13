"use client";

import { useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";

/**
 * Read the active user's `settings.institution_admin_of` (Institution tier Phase
 * 4). Mirrors useDeptAdminOf: undefined while loading, null when not an
 * institution admin, the institution_id once resolved; live-reactive.
 */
export function useInstitutionAdminOf(
  username: string | null,
): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: clear immediately, no I/O.
      setId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) setId(settings.institution_admin_of ?? null);
      } catch {
        if (!cancelled) setId(null);
      }
    })();
    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      setId(event.next.institution_admin_of ?? null);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  return id;
}
