"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import SnapshotCanvas from "@/components/lab-overview/SnapshotCanvas";
import SidebarWidgetRail from "@/components/lab-overview/SidebarWidgetRail";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { readUserSettings, type AccountType } from "@/lib/settings/user-settings";
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
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * the page body is now `<WidgetCanvas />` + a customizable sidebar via
 * `<SidebarWidgetRail />`. The hard-coded vertical stack of the three
 * lab-inbox sections is gone — each section became a `WidgetDefinition`
 * in `frontend/src/components/lab-overview/widgets/registry.ts`. The
 * default lab_head layout reproduces the previous vertical stack so
 * existing PIs see no visual change on first run (proposal §3c).
 *
 * Phase 3 visibility shift: every lab member now lands on this surface
 * to SEE pinned announcements (the brief explicitly calls for "Members
 * CAN see them but cannot post"). Lab-head-only widgets (metrics, PI
 * actions, member workload) are filtered out of the member catalog by
 * the `visibleCatalog` helper in `widgets/types.ts`, so they never
 * appear for non-PIs.
 *
 * The previous "bounce non-lab_head to Home" guard was relaxed in
 * Phase 3. Non-lab-mode users (solo accounts with no lab folder) still
 * shouldn't land here — they have no lab to read. We gate on
 * `isConnected` (= a lab folder is opened) + the in-lab feature pick.
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
  const [accountType, setAccountType] = useState<AccountType | null>(null);

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

  if (!allowed || !currentUser || !accountType) {
    return null;
  }

  const isLabHead = accountType === "lab_head";

  // R2: the sidebar widget rail mounts INSIDE the lab-overview body so
  // it replaces the AppShell-level `DailyTasksSidebar` only on this
  // route. AppShell already routes the global sidebar by pathname
  // (`/calendar` → CalendarSidebar, everything else → DailyTasksSidebar);
  // we let AppShell's DailyTasksSidebar render on the left as before
  // AND nest our customizable rail on the right of the global sidebar.
  // The R2 layout therefore is: [global sidebar | rail | canvas]. The
  // R3-or-later move is to teach AppShell to swap DailyTasksSidebar
  // for SidebarWidgetRail on /lab-overview — out of R2 scope to avoid
  // breaking every other page.
  return (
    <div className="flex-1 flex overflow-hidden">
      <SidebarWidgetRail username={currentUser} accountType={accountType} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
          <header>
            <h1 className="text-2xl font-bold text-gray-900">Lab Overview</h1>
            <p className="text-sm text-gray-500 mt-1">
              {isLabHead
                ? "Your customizable canvas of lab-wide widgets. Click Edit layout to drag, resize, and add."
                : "Announcements, recent comments, and lab activity. Customize your sidebar with the gear."}
            </p>
          </header>

          <SnapshotCanvas username={currentUser} accountType={accountType} />
        </div>
      </div>
    </div>
  );
}
