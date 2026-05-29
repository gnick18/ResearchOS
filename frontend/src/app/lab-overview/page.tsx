"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Dashboard unification (dashboard-unification build, 2026-05-29):
 * `/lab-overview` is now a permanent redirect to "/", the single unified
 * dashboard for every account type. Lab Overview and Home collapsed into
 * one widget canvas; a lab_head's dense lab widgets and a member's
 * personal set both live at "/" now (account-aware catalog + nav label).
 *
 * The route directory is kept (rather than deleted) so existing bookmarks
 * and any in-app `/lab-overview` link land on the dashboard instead of a
 * 404 — the same precedent the 2026-05-23 `/lab-inbox` -> `/lab-overview`
 * rename set. The `?from=lab-overview` sentinel suppresses the dashboard's
 * one-shot default-landing bounce so a follower of a /lab-overview link
 * stays squarely on the dashboard.
 */
export default function LabOverviewRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/?from=lab-overview");
  }, [router]);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
    </div>
  );
}
