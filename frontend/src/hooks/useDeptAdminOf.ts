"use client";

import { useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";

/**
 * Read the active user's `settings.dept_admin_of` (Department tier Phase 1) -- the
 * dept_id they administer, or null/absent. Mirrors useAccountType: live-reactive
 * via onUserSettingsWritten so the Department nav entry appears the moment they
 * create a department, and ignores writes for other users.
 *
 * Returns:
 *   - `undefined` while the settings read is in flight (treat as "not a dept
 *     admin yet" to avoid flicker),
 *   - `null` when signed out or not a dept admin,
 *   - the dept_id string once resolved.
 */
export function useDeptAdminOf(
  username: string | null,
): string | null | undefined {
  const [deptId, setDeptId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: clear immediately, no I/O.
      setDeptId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) setDeptId(settings.dept_admin_of ?? null);
      } catch {
        if (!cancelled) setDeptId(null);
      }
    })();
    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      setDeptId(event.next.dept_admin_of ?? null);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  return deptId;
}
