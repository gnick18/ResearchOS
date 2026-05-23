"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import LabInboxComments from "@/components/lab-inbox/LabInboxComments";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { readUserSettings } from "@/lib/settings/user-settings";

/**
 * Lab Inbox — the principal investigator's surface (Lab Head Phase 1
 * 2026-05-23 — lab head Phase 1 manager).
 *
 * Phase 1 ships only the shell. Phase 2 fills it with comment notifications
 * (mentions, replies, threads on the PI's lab's records), Phase 3 adds the
 * announcement composer + action queue (purchase approvals, flag-for-review,
 * task-assignment confirmations), Phase 4 the lab-overview metrics.
 *
 * Visibility: gated by `UserSettings.account_type === "lab_head"`. A regular
 * member who navigates here directly (typed URL, stale bookmark) is bounced
 * to Home — the sidebar nav entry only renders for lab heads, so the only
 * way to land here as a member is intentional.
 */
export default function LabInboxPage() {
  return (
    <AppShell>
      <LabInboxBody />
    </AppShell>
  );
}

function LabInboxBody() {
  const router = useRouter();
  const { currentUser, isConnected } = useFileSystem();
  // `undefined` = still loading, `null` = no lab_head access, `true` = ok.
  const [allowed, setAllowed] = useState<boolean | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isConnected || !currentUser) {
        if (!cancelled) setAllowed(null);
        return;
      }
      try {
        const settings = await readUserSettings(currentUser);
        if (!cancelled) {
          setAllowed(settings.account_type === "lab_head" ? true : null);
        }
      } catch {
        if (!cancelled) setAllowed(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isConnected]);

  useEffect(() => {
    // Bounce regular members back to Home — they shouldn't be here. We do
    // this client-side (no server) since the gate lives in settings.json
    // which is also read client-side. The redirect waits until the
    // settings read resolves so we don't bounce mid-load.
    if (allowed === null) router.replace("/");
  }, [allowed, router]);

  if (allowed === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!allowed) {
    // The redirect effect above handles navigation; render nothing in the
    // intermediate frame to avoid flashing a forbidden-style message at
    // someone we're about to bounce.
    return null;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-gray-900">Lab Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            Comments and audit notifications across your lab&apos;s shared
            content. Phase 2+ fills this surface in.
          </p>
        </header>

        {/* Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23): the
            Phase 1 placeholder section is replaced by the live
            <LabInboxComments /> feed. Phase 4 will mount its
            <LabInboxMetrics /> sibling around this — keep the wrapper div
            shallow so the page edit stays minimal and avoids cherry-pick
            conflicts. */}
        <div>
          <LabInboxComments />
        </div>
      </div>
    </div>
  );
}
