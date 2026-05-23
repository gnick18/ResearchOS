"use client";

import { useEffect, useState } from "react";
import {
  readUserSettings,
  type AccountType,
} from "@/lib/settings/user-settings";

/**
 * Read the active user's `settings.account_type` (Lab Head Phase 1 —
 * `lab head Phase 1 manager`, 2026-05-23).
 *
 * Returns:
 *   - `undefined` while the settings read is in flight (or right after
 *     a username change). Callers should treat this as "don't show the
 *     lab-head-only chrome yet" to avoid flicker.
 *   - `null` when there's no active user (signed-out, pre-data-setup).
 *   - `"member"` (default for existing users — see `DEFAULT_SETTINGS`)
 *     or `"lab_head"` once the settings read resolves.
 *
 * AppShell consumes this to gate the Lab Overview top-nav entry
 * (renamed from "Lab Inbox" + promoted to top-nav 2026-05-23); the
 * Lab Overview page itself re-reads the settings authoritatively so a
 * URL-jump from a stale cache can't bypass the gate.
 *
 * Reactivity gap (matches `useFeaturePicks`): re-reads only on mount +
 * username change. The Settings page's own update path doesn't bump a
 * subscription channel for this hook today; the user's account-type
 * change takes effect after the next navigation/refresh. A future
 * polish chip could wire `patchUserSettings` through a tiny zustand
 * mini-store the way feature_picks should be (already flagged in
 * `useFeaturePicks.ts`).
 */
export function useAccountType(
  username: string | null,
): AccountType | null | undefined {
  const [accountType, setAccountType] = useState<
    AccountType | null | undefined
  >(undefined);

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: previous user's account_type must clear immediately, no I/O involved, so the synchronous setState is the correct shape here.
      setAccountType(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) setAccountType(settings.account_type);
      } catch (err) {
        // Don't gate AppShell rendering on a failed settings read; treat
        // it as `member` (the safe default — never accidentally elevate
        // someone to lab_head). Logged so failures are diagnosable.
        console.warn("[useAccountType] readUserSettings failed", err);
        if (!cancelled) setAccountType("member");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  return accountType;
}
