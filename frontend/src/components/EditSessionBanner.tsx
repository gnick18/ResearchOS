"use client";

import { endEditSession, formatRemaining } from "@/lib/lab/edit-session";
import { useEditSession } from "@/hooks/useEditSession";

interface EditSessionBannerProps {
  /** Optional label describing what's being edited. Shown next to the
   *  timer so the PI knows which record is unlocked. */
  contextLabel?: string;
  /** Optional callback fired when the user clicks "End session." Most
   *  callers don't need this — the banner already handles the call to
   *  `endEditSession()`. Provided so a popup can also flip its
   *  internal "editing" state. */
  onEnd?: () => void;
  /** Hide the banner when the active session doesn't belong to this
   *  username. Used by per-record popups so one PI's session on a
   *  different record doesn't put a banner on top of every other
   *  read-only view. When omitted, the banner shows whenever a session
   *  is active (used by global surfaces like AppShell). */
  scopedToUsername?: string;
}

/**
 * Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): amber timer
 * banner shown at the top of an unlocked record popup.
 *
 * Renders nothing when the session is not "unlocked." On unlock, shows:
 *   "Editing as PI — [contextLabel] — M:SS remaining. End session."
 *
 * Subscribes to the module-scoped session via `useEditSession`, so the
 * countdown ticks once per second without the parent needing to re-
 * render. End-session button calls `endEditSession()` which transitions
 * the state machine to "locked" — the popup's gate will re-engage on
 * the next render.
 */
export default function EditSessionBanner({
  contextLabel,
  onEnd,
  scopedToUsername,
}: EditSessionBannerProps) {
  const session = useEditSession();
  if (session.state !== "unlocked" || !session.active) return null;
  if (scopedToUsername && session.active.username !== scopedToUsername) {
    // A session is unlocked for a different user — don't decorate this
    // popup. (Rare in practice; happens if a PI opens member A's record,
    // unlocks, then opens member B's record without ending the session.)
    return null;
  }

  const remaining = formatRemaining(session.remainingMs);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs"
      data-testid="edit-session-banner"
    >
      <div className="flex items-center gap-2 min-w-0">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="flex-shrink-0"
        >
          <path d="M12 2a10 10 0 1 0 10 10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span className="font-medium">Editing as Lab Head</span>
        {contextLabel && (
          <>
            <span className="text-amber-700">—</span>
            <span className="truncate">{contextLabel}</span>
          </>
        )}
        <span className="text-amber-700">—</span>
        <span
          className="font-mono tabular-nums"
          data-testid="edit-session-banner-remaining"
        >
          {remaining} remaining
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          endEditSession();
          onEnd?.();
        }}
        className="flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium text-amber-900 hover:bg-amber-100 border border-amber-300"
      >
        End session
      </button>
    </div>
  );
}
