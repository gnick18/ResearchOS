"use client";

// A permanent, always-visible sign-out for the login / gate screens.
//
// Every gate (welcome-back, folder-connect, account chooser, ...) carries its
// own "Sign out" only as a small underlined link in the footer's thin bar,
// below the fold. A signed-in person who lands on a gate (e.g. after a reload,
// before reconnecting a folder) could scroll and never find it, a soft-lock with
// no visible way out. This single control fixes that for every gate at once.
//
// Mounted ONCE at the Providers level above AppContent (alongside the other
// pre-login global hosts), so it overlays EVERY gate state by construction and
// any gate added later inherits it for free, no per-screen wiring.
//
// Shown only when there IS an account to sign out of (a cloud session) AND no
// folder is connected, i.e. the user is on a gate/login screen. That condition
// also keeps it off the public surfaces (marketing, wiki, public lab sites),
// where the viewer has no session, and off the full app (a connected folder),
// which has its own account menu.

import { fullSignOut } from "@/lib/auth/full-sign-out";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useHasCloudSession } from "@/components/account/AccountFirstRedirect";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

export default function PersistentGateSignOut() {
  const { isConnected, disconnect } = useFileSystem();
  const hasCloudSession = useHasCloudSession();

  if (isConnected || !hasCloudSession) return null;

  return (
    <div className="fixed right-4 top-4 z-[600] pointer-events-auto">
      <Tooltip label="Sign out of your account and return to the landing page">
        <button
          type="button"
          data-testid="persistent-gate-sign-out"
          onClick={() => void fullSignOut({ disconnect })}
          className="flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-overlay px-3 py-1.5 text-meta font-medium text-foreground-muted shadow-sm transition-colors hover:border-brand-action hover:text-foreground"
        >
          <Icon name="logout" className="h-3.5 w-3.5" />
          Sign out
        </button>
      </Tooltip>
    </div>
  );
}
