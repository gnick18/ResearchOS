"use client";

// PiContextBanner (Owen pilot stopgap, A7 Part 1).
//
// Shown when the active folder hides the signed-in account's PI context, which
// happens when a lab head connects a folder that was never set up as their lab
// (most often a brand-new empty folder with no settings.json). The durable fix
// (seed-on-connect, pi-context-seed.ts) repairs the validatable cases silently;
// this banner is the visible escape for the rest, so a PI is never soft-locked
// out of their lab tools with no way back in.
//
// The copy states the WHY (this folder is not bound to your lab, so your PI
// tools are hidden) and links straight to the Settings account-type control so
// the user can mark the folder as their lab. The mismatch is validated against
// the signed lab record by usePiContextMismatch (M5), so a real solo user never
// sees this.
//
// No emojis, no em-dashes, no mid-sentence colons.

import Link from "@/components/FixtureLink";
import { Icon } from "@/components/icons";
import { usePiContextMismatch } from "@/hooks/usePiContextMismatch";

/** The Settings deep-link that opens the account-type (role) control. The
 *  AccountTypeSection lives in the "labsettings" section and is rendered for
 *  every account, not just existing heads, so a member-looking folder can be
 *  flipped to lab_head from here. */
const ACCOUNT_TYPE_SETTINGS_HREF = "/settings?section=labsettings";

export default function PiContextBanner({
  username,
}: {
  username: string | null;
}) {
  const mismatch = usePiContextMismatch(username);
  if (!mismatch) return null;

  const labLabel = mismatch.labName?.trim();

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pi-context-banner"
      className="flex items-start justify-between gap-3 px-3 py-2 m-3 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200 text-meta"
    >
      <div className="flex items-start gap-2 min-w-0">
        <Icon
          name="alert"
          className="flex-shrink-0 mt-0.5 h-3.5 w-3.5"
        />
        <div className="min-w-0">
          <p className="font-medium">
            This folder is not set up as your lab
            {labLabel ? <span> ({labLabel})</span> : null}.
          </p>
          <p className="mt-0.5 text-amber-800/90 dark:text-amber-200/80">
            You head this lab, but this folder has no lab identity, so your PI
            tools stay hidden here. Mark it as your lab to restore them.
          </p>
        </div>
      </div>
      <Link
        href={ACCOUNT_TYPE_SETTINGS_HREF}
        data-testid="pi-context-banner-fix"
        className="flex-shrink-0 px-2.5 py-1 rounded-md text-meta font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-300 dark:border-amber-500/30"
      >
        Mark as my lab
      </Link>
    </div>
  );
}
