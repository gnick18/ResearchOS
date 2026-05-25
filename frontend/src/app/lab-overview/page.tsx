"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import SnapshotCanvas from "@/components/lab-overview/SnapshotCanvas";
import SidebarWidgetRail from "@/components/lab-overview/SidebarWidgetRail";
import ToolsLauncher from "@/components/lab-overview/ToolsLauncher";
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
  // `undefined` = still loading. `null` = solo (no lab → bounce to "/").
  // `"redirect-to-home"` = lab member, retired from /lab-overview →
  // bounce to /home. `true` = lab_head, render the page.
  //
  // Home canvas migration (Home canvas migration manager, 2026-05-23):
  // Grant 2026-05-23 decision: "im really just not convinced the lab
  // overview page is necessary for non lab heads." For lab members
  // we now redirect to the Home page (route "/" / HOME_HREF), where
  // the customizable widget canvas now surfaces the same
  // announcements + comments + lab-activity signals. Lab heads still
  // see /lab-overview as the PI dashboard.
  const [allowed, setAllowed] = useState<
    boolean | null | "redirect-to-home" | undefined
  >(undefined);
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
          const inLab = onboarding.feature_picks?.account_type === "lab";
          if (at === "lab_head") {
            setAllowed(true);
          } else if (at === "member" && inLab) {
            // Lab member who used to land here for announcements.
            // Redirect to /home where the home canvas now surfaces
            // the same widgets.
            setAllowed("redirect-to-home");
          } else {
            // Solo account (no lab workspace) — original bounce to "/".
            setAllowed(null);
          }
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
    if (allowed === null) {
      // Solo users — no lab folder, nothing to render. Bounce to root.
      // Tagged with `?from=lab-overview` so HomePage skips its one-shot
      // defaultLandingTab redirect; otherwise the visitor would compound
      // through "/" → defaultLandingTab and lose all signal that they
      // followed a /lab-overview link in the first place (routing+deep
      // link fix manager bug 4).
      router.replace("/?from=lab-overview");
    } else if (allowed === "redirect-to-home") {
      // Lab members — /lab-overview is retired for them; their lab
      // signals now live on the Home page (route "/", not "/home" —
      // HOME_HREF is "/"). `router.replace` (not `push`) so the back
      // button doesn't trap them in a redirect loop. Same `?from=`
      // sentinel: prevent the home page from compounding into another
      // tab via defaultLandingTab — alex followed a /lab-overview link
      // and should land squarely on Home, not bounce again.
      router.replace("/?from=lab-overview");
    }
  }, [allowed, router]);

  if (allowed === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    );
  }

  // For both the "/" bounce and the "/home" bounce, return null until
  // the router.replace lands. Avoids a flash of stale content during
  // the redirect tick.
  if (
    allowed === null ||
    allowed === "redirect-to-home" ||
    !currentUser ||
    !accountType
  ) {
    return null;
  }
  if (allowed !== true) return null;

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
          <header className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-gray-900">Lab Overview</h1>
              <p className="text-sm text-gray-500 mt-1">
                {isLabHead
                  ? "Your customizable canvas of lab-wide widgets. Click Edit layout to drag, resize, and add."
                  : "Announcements, recent comments, and lab activity. Customize your sidebar with the gear."}
              </p>
            </div>
            {/* Tools launcher (Phase C): every tool the viewer can open,
                independent of which widgets they have pinned. */}
            <div className="flex-shrink-0 pt-1">
              <ToolsLauncher accountType={accountType} />
            </div>
          </header>

          <SnapshotCanvas username={currentUser} accountType={accountType} />
        </div>
      </div>
    </div>
  );
}
