"use client";

// usePiContextMismatch (Owen pilot stopgap banner, A7 Part 1).
//
// Detects the exact PI-context-lost case so the shell can warn a lab head that
// the folder they are looking at is not set up as their lab. The mismatch is
//   account_type is NOT "lab_head" for the active folder AND that folder has no
//   lab_id, BUT the signed-in account IS confirmed as the head of a known lab.
//
// "Known lab" comes from the folder switcher's cached head meta (labRole "head"
// or "class" + a labId), and we never trust that cache alone (M5): we validate
// the head match against the signed lab record via confirmAccountIsHead before
// the banner shows. That keeps a real solo user from ever seeing the banner.
//
// The durable fix (seed-on-connect) repairs most of these silently; this banner
// is the visible escape for the new-folder / unvalidatable cases so the user is
// never soft-locked out of their PI tools.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";
import {
  getActiveFolderId,
  listRememberedFolders,
} from "@/lib/file-system/indexeddb-store";
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";
import {
  confirmAccountIsHead,
  isHeadCapableRole,
} from "@/lib/lab/pi-context-seed";

export interface PiContextMismatch {
  /** The lab the account heads but this folder is not bound to. */
  labId: string;
  /** Cosmetic lab name for the banner copy, when the switcher cached one. */
  labName?: string;
}

/**
 * Returns a mismatch descriptor when the active folder hides the account's PI
 * context, or null otherwise (the common case). Re-runs on user change and on
 * any user-settings write (so the banner clears the instant the user marks the
 * folder as their lab via Settings). Best-effort and fail-closed: any error
 * resolves to null, so the banner never shows spuriously.
 */
export function usePiContextMismatch(
  username: string | null,
): PiContextMismatch | null {
  const [mismatch, setMismatch] = useState<PiContextMismatch | null>(null);

  useEffect(() => {
    if (!MULTI_FOLDER_ENABLED || !username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out / flag-off transition: the prior user's mismatch must clear immediately, no I/O involved, so the synchronous setState is the correct shape here (mirrors useAccountType).
      setMismatch(null);
      return;
    }
    let cancelled = false;

    const evaluate = async () => {
      try {
        const settings = await readUserSettings(username);
        // Already a PI on this folder, or the folder is bound to a lab. Nothing
        // to warn about.
        if (settings.account_type === "lab_head" || settings.lab_id) {
          if (!cancelled) setMismatch(null);
          return;
        }

        const activeId = await getActiveFolderId();
        if (!activeId) {
          if (!cancelled) setMismatch(null);
          return;
        }
        const meta = (await listRememberedFolders()).find(
          (f) => f.id === activeId,
        );
        if (!meta || !isHeadCapableRole(meta.labRole) || !meta.labId) {
          if (!cancelled) setMismatch(null);
          return;
        }

        // M5: confirm the head match against the signed lab record before
        // claiming a mismatch. A stale cached labRole must not surface the
        // banner on a folder the account does not actually head.
        const confirmed = await confirmAccountIsHead(meta.labId, username);
        if (cancelled) return;
        setMismatch(
          confirmed
            ? { labId: meta.labId, labName: meta.labName }
            : null,
        );
      } catch {
        if (!cancelled) setMismatch(null);
      }
    };

    void evaluate();

    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled || event.username !== username) return;
      // A settings write may have just bound the folder (the seed, or the user
      // accepting the banner). Re-evaluate rather than trusting the snapshot.
      void evaluate();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  return mismatch;
}
