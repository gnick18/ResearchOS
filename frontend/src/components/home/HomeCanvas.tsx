"use client";

import { useEffect, useState } from "react";
import SnapshotCanvas from "@/components/lab-overview/SnapshotCanvas";
import ToolsLauncher from "@/components/lab-overview/ToolsLauncher";
import { readUserSettings, type AccountType } from "@/lib/settings/user-settings";

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
  const [accountType, setAccountType] = useState<AccountType | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: clear cached account_type immediately so a stale value can't leak between users on the home page. Same shape used by useAccountType for the same reason.
      setAccountType(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) setAccountType(settings.account_type);
      } catch (err) {
        // Defensive: never crash the home page on a settings read failure.
        // Falling back to `member` errs on the side of fewer widgets being
        // visible (members can't see PI-only catalog entries).
        console.warn("[HomeCanvas] readUserSettings failed", err);
        if (!cancelled) setAccountType("member");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

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
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-700">Widgets</h3>
          <span className="text-xs text-gray-400">
            Pin lab signals to your home page
          </span>
        </div>
        {/* Tools launcher scoped to home-eligible Tools so members
            don't see options that would open into a popup with no
            corresponding widget they can pin from /home. */}
        <ToolsLauncher accountType={accountType} surface="home" />
      </header>

      <SnapshotCanvas
        username={username}
        accountType={accountType}
        surface="home"
        resetConfirmMessage="Reset Home widgets to default? Your widget order will be lost."
        emptyStateMessage="No widgets pinned. Use Add widget or Tools to bring some back."
      />
    </section>
  );
}
