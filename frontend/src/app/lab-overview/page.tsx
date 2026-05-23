"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import LabInboxAnnouncements from "@/components/lab-inbox/LabInboxAnnouncements";
import LabInboxComments from "@/components/lab-inbox/LabInboxComments";
import LabInboxMetrics from "@/components/lab-inbox/LabInboxMetrics";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { readUserSettings } from "@/lib/settings/user-settings";
import { readOnboarding } from "@/lib/onboarding/sidecar";

/**
 * Lab Overview — Lab Head Phase 1 shipped the shell (originally "Lab
 * Inbox"), Phase 2 added the comment feed, Phase 4 added cross-lab
 * metrics, Phase 3 (lab head Phase 3 manager, 2026-05-23) added the
 * announcement composer, and Phase 6 added the Lab Roster. The
 * 2026-05-23 rename (lab overview rename manager) promoted the surface
 * from "Lab Inbox" to "Lab Overview" because it now hosts
 * announcements + comments + metrics + roster + audit notices rather
 * than just an inbox of comments. The legacy `/lab-inbox` URL still
 * redirects here for bookmark / external-link back-compat.
 *
 * Phase 3 visibility shift: every lab member now lands on this surface
 * to SEE pinned announcements (the brief explicitly calls for "Members
 * CAN see them but cannot post"). Lab-head-only sections (composer
 * controls, cross-lab metrics) gate themselves internally on
 * `account_type === "lab_head"`. The comments feed renders for everyone
 * — its "Only on my records" toggle was added in Phase 2 for non-PIs
 * who land here via a bell-row click.
 *
 * The previous "bounce non-lab_head to Home" guard was relaxed in
 * Phase 3. Non-lab-mode users (solo accounts with no lab folder) still
 * shouldn't land here — they have no lab to read. We gate on
 * `isConnected` (= a lab folder is opened) instead of account_type.
 */
export default function LabOverviewPage() {
  return (
    <AppShell>
      <LabOverviewBody />
    </AppShell>
  );
}

function LabOverviewBody() {
  const router = useRouter();
  const { currentUser, isConnected } = useFileSystem();
  // `undefined` = still loading, `null` = no lab access, `true` = ok.
  const [allowed, setAllowed] = useState<boolean | null | undefined>(undefined);
  const [accountType, setAccountType] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isConnected || !currentUser) {
        if (!cancelled) setAllowed(null);
        return;
      }
      try {
        const [settings, onboarding] = await Promise.all([
          readUserSettings(currentUser),
          readOnboarding(currentUser),
        ]);
        if (!cancelled) {
          const at = settings.account_type;
          setAccountType(at);
          // Phase 3 relaxes the Phase 1 lab_head-only guard so ordinary
          // lab members can see PI announcements. Solo accounts (no lab
          // workspace) still bounce — they have no lab to display.
          const inLab = onboarding.feature_picks?.account_type === "lab";
          setAllowed(at === "lab_head" || (at === "member" && inLab) ? true : null);
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
    // Bounce solo users — no lab folder, nothing to render.
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
    return null;
  }

  const isLabHead = accountType === "lab_head";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-gray-900">Lab Overview</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isLabHead
              ? "Announcements, lab-wide comments, cross-lab metrics, and the lab roster. The composer below posts to everyone in the lab."
              : "Announcements from your lab head, recent comments across the lab, and the lab roster."}
          </p>
        </header>

        {/* Phase 3: PI-posted announcements visible to everyone; composer
         *  gated on Phase 5 edit-mode session. */}
        <LabInboxAnnouncements />

        {/* Phase 2: cross-lab comment feed with source-surface links,
         *  threaded replies, @mention chips, bell notifications. */}
        <LabInboxComments />

        {/* Phase 4: cross-lab metrics dashboard — lab-head-only signal.
         *  Members don't see other members' aggregated workload. */}
        {isLabHead && <LabInboxMetrics />}
      </div>
    </div>
  );
}
