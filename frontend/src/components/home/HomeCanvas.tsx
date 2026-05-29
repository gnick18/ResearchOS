"use client";

import SnapshotCanvas from "@/components/lab-overview/SnapshotCanvas";
import ToolsLauncher from "@/components/lab-overview/ToolsLauncher";
import { dashboardSurfaceFor } from "@/lib/lab-overview/layout-persistence";
import { useAccountType } from "@/hooks/useAccountType";

/**
 * Dashboard unification (dashboard-unification build, 2026-05-29): the
 * unified per-user widget dashboard mounted at "/". Home (members + solo)
 * and Lab Overview (lab_head) collapsed into this ONE surface. It reads /
 * writes the single `dashboard_layout` field via `surface="dashboard"`
 * and filters the catalog by an account-aware key (lab_head sees the
 * dense lab widgets, member/solo see the personal set). The previously
 * hardcoded Home project grid is gone — the seeded Projects Overview
 * widget covers it.
 *
 * (Historically this file was `HomeCanvas`, the /home-only widget canvas
 * that sat below the hardcoded project grid; the export name is kept and
 * page.tsx imports it as `DashboardCanvas`.)
 *
 * Reuses `<SnapshotCanvas>` so the drag-and-drop / palette / reset
 * mechanics stay identical to the legacy /lab-overview canvas.
 */
export interface HomeCanvasProps {
  username: string;
}

export default function HomeCanvas({ username }: HomeCanvasProps) {
  // Resolve the active user's account_type so the catalog filter + Tools
  // launcher visibility match what the user is allowed to see. `undefined`
  // = still loading; render a tiny skeleton so the area doesn't snap-in
  // once the read resolves. `useAccountType` re-subscribes to the
  // user-settings write bus, so a wizard answer (Q1c) that commits a PI
  // role propagates here immediately.
  const accountType = useAccountType(username);

  if (accountType === undefined) {
    return (
      <div>
        <div className="h-6 w-40 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="h-44 bg-gray-50 rounded-lg animate-pulse" />
          <div className="h-44 bg-gray-50 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }
  if (!accountType) return null;

  // The section heading is account-aware to match the nav label: "Lab
  // Overview" for a PI, "Home" for everyone else. Mirrors the AppShell
  // nav-label pattern.
  const heading = accountType === "lab_head" ? "Lab Overview" : "Home";

  return (
    <section data-tour-target="home-widget-canvas" aria-label="Dashboard widgets">
      <SnapshotCanvas
        username={username}
        accountType={accountType}
        surface="dashboard"
        resetConfirmMessage="Reset your dashboard to default? Your widget order will be lost."
        emptyStateMessage="No widgets pinned. Use Add widget or Tools to bring some back."
        toolbarLeft={
          <h2 className="text-2xl font-bold text-gray-900">{heading}</h2>
        }
        toolbarExtras={
          <ToolsLauncher
            accountType={accountType}
            surface={dashboardSurfaceFor(accountType)}
          />
        }
      />
    </section>
  );
}
