"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import LabInboxComments from "@/components/lab-inbox/LabInboxComments";
import LabInboxMetrics from "@/components/lab-inbox/LabInboxMetrics";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { readUserSettings } from "@/lib/settings/user-settings";

/**
 * Lab Inbox — the principal investigator's surface (Lab Head Phase 1
 * 2026-05-23 — lab head Phase 1 manager).
 *
 * Phase 1 shipped the shell. Phase 2 fills it with the cross-lab comment
 * feed (mentions, replies, threads on the PI's lab's records). Phase 4
 * adds the metrics dashboard (Gantt overlay tinted by owner, funding
 * rollup, roadmap aggregation). Phase 3 will add the announcement composer
 * + action queue.
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
      {/* Phase 4 widened the container to 6xl so the Gantt overlay has room
       *  to breathe without horizontal-scrolling at typical laptop widths.
       *  Phase 2's comment feed renders fine inside the wider column. */}
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-gray-900">Lab Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            Comments and audit notifications across your lab&apos;s shared
            content. Phase 3 will add the announcement composer + action queue.
          </p>
        </header>

        {/* Phase 2: cross-lab comment feed with source-surface links,
         *  threaded replies, @mention chips, bell notifications. */}
        <LabInboxComments />

        {/* Phase 4: cross-lab metrics dashboard — tabbed view across the
         *  Gantt overlay (every member's tasks tinted by owner), funding
         *  rollup (lab-wide spend), and roadmap aggregation (all high-level
         *  goals with progress). All three read existing data — no new
         *  sidecars. */}
        <LabInboxMetrics />
      </div>
    </div>
  );
}
