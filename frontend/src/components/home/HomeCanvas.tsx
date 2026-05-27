"use client";

import SnapshotCanvas from "@/components/lab-overview/SnapshotCanvas";
import ToolsLauncher from "@/components/lab-overview/ToolsLauncher";
import { useAccountType } from "@/hooks/useAccountType";

/**
 * Home canvas migration (Home canvas migration manager, 2026-05-23):
 * the /home page's customizable widget canvas. Mounts below the
 * existing project snapshots, scoped to the new `home` surface in the
 * widget catalog (announcements + comments + lab activity + today's
 * announcements by default). Reuses `<SnapshotCanvas surface="home">`
 * so the drag-and-drop / palette / reset mechanics stay identical to
 * the /lab-overview canvas.
 *
 * Why a wrapper instead of a direct mount in `app/page.tsx`:
 *   - keeps the home page top-level component focused on project
 *     rendering (which is already 800+ lines)
 *   - lets the canvas resolve `accountType` async without that loading
 *     state polluting the project-snapshot render
 *   - mirrors the `<LabOverviewBody>` pattern in
 *     `app/lab-overview/page.tsx` for visual parity
 *
 * Grant's brief, decoded: "the home page already has snapshots for the
 * projects. why not build these widgets into that existing thing and
 * do a full canvas like page on the home page with the projects + other
 * widgets that can be added by the users".
 */
export interface HomeCanvasProps {
  username: string;
}

export default function HomeCanvas({ username }: HomeCanvasProps) {
  // Resolve the active user's account_type so the catalog filter +
  // Tools launcher visibility match what the user is allowed to see.
  // `undefined` = still loading; we render a tiny skeleton so the
  // empty area doesn't snap-in once the read resolves.
  //
  // setup-q feature-gating audit manager (2026-05-27): switched from a
  // local `readUserSettings + useState` snapshot to the shared
  // `useAccountType` hook so Q1c's `_user_settings.account_type` bridge
  // (which writes via patchUserSettings + dispatches the
  // `onUserSettingsWritten` bus) propagates to HomeCanvas the moment the
  // wizard answer commits. Without the hook, the prior local read fired
  // once on mount and never re-subscribed; a fresh PI who finished Q1c
  // saw the member-only widget catalog on the home page until they
  // navigated away and back. The hook also handles the signed-out
  // transition (returns null), matching the local read's prior shape.
  const accountType = useAccountType(username);

  if (accountType === undefined) {
    return (
      <div className="mt-12">
        <div className="h-6 w-40 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="h-44 bg-gray-50 rounded-lg animate-pulse" />
          <div className="h-44 bg-gray-50 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }
  if (!accountType) return null;

  return (
    <section
      data-tour-target="home-widget-canvas"
      className="mt-12"
      aria-label="Home widgets"
    >
      {/* No stacked header: the section title rides inside the canvas
          toolbar's `toolbarLeft` slot so the title + action buttons sit
          on one row instead of two (per Grant 2026-05-24 polish). Tools
          launcher rides in `toolbarExtras` alongside Add widget / Edit
          layout / Reset. */}
      <SnapshotCanvas
        username={username}
        accountType={accountType}
        surface="home"
        resetConfirmMessage="Reset Home widgets to default? Your widget order will be lost."
        emptyStateMessage="No widgets pinned. Use Add widget or Tools to bring some back."
        toolbarLeft={
          <h3 className="text-lg font-semibold text-gray-700">Widgets</h3>
        }
        toolbarExtras={
          <ToolsLauncher accountType={accountType} surface="home" />
        }
      />
    </section>
  );
}
