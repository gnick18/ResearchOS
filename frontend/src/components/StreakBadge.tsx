"use client";

import { useEffect, useRef, useState } from "react";
import {
  onStreakSidecarChanged,
  readStreak,
  type StreakSidecar,
} from "@/lib/streak/streak-sidecar";
import { onStreakMilestoneCrossed } from "@/lib/streak/streak-activity-tracker";
import Tooltip from "./Tooltip";

/**
 * Phase S2 of the Streak-and-Milestones arc (see
 * STREAK_AND_MILESTONES_PROPOSAL.md §6.1, locks L4 + L5 + L6).
 *
 * Top-nav badge that surfaces the active user's current streak count.
 * Renders as a small sky-blue flame pill between the BeakerBot brand
 * mark and the wordmark in AppShell. The badge HIDES entirely when:
 *  - there is no active user (signed-out, demo, fixture-no-user)
 *  - the user has turned streaks off in Settings (`enabled === false`)
 *  - the current streak is zero
 *
 * Re-render strategy: subscribe to `onStreakSidecarChanged` (the S0
 * change event that fires after every `patchStreak`) plus
 * `onStreakMilestoneCrossed` (S1's milestone signal). One read on
 * mount, then event-driven updates with no polling. This is the
 * Option-C approach from the S2 brief: the badge does not need a
 * timer because every state change flows through `patchStreak`, which
 * always emits the change event.
 */

interface StreakBadgeProps {
  /** Active user; null hides the badge entirely. */
  username: string | null;
}

export default function StreakBadge({ username }: StreakBadgeProps) {
  const [sidecar, setSidecar] = useState<StreakSidecar | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const badgeWrapRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Initial load whenever username changes. A null username clears
  // the sidecar so a sign-out hides the badge immediately.
  useEffect(() => {
    if (!username) {
      setSidecar(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const sc = await readStreak(username);
        if (!cancelled) setSidecar(sc);
      } catch (err) {
        console.warn("[StreakBadge] initial readStreak failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Subscribe to S0 sidecar-change events (Option C from the brief).
  // Every patchStreak write produces an event with the normalized
  // sidecar shape, so the badge can update state synchronously without
  // an extra read.
  useEffect(() => {
    if (!username) return;
    const unsub = onStreakSidecarChanged((u, next) => {
      if (u !== username) return;
      setSidecar(next);
    });
    return unsub;
  }, [username]);

  // Subscribe to S1 milestone-crossed events. The tick that emits a
  // milestone also calls patchStreak (which we already cover above),
  // so this subscription is a defensive re-read for the edge case
  // where a future S6 surface emits milestones without writing the
  // sidecar — keeps the badge fresh either way.
  useEffect(() => {
    if (!username) return;
    const unsub = onStreakMilestoneCrossed((event) => {
      if (event.username !== username) return;
      void (async () => {
        try {
          const sc = await readStreak(username);
          setSidecar(sc);
        } catch (err) {
          console.warn(
            "[StreakBadge] re-read after milestone failed:",
            err,
          );
        }
      })();
    });
    return unsub;
  }, [username]);

  // Compute visibility.
  const visible =
    !!username &&
    !!sidecar &&
    sidecar.enabled !== false &&
    sidecar.current_count >= 1;

  // Click-outside / Escape closes the popover.
  useEffect(() => {
    if (!popoverOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (
        popoverRef.current?.contains(target) ||
        badgeWrapRef.current?.contains(target)
      ) {
        return;
      }
      setPopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  if (!visible || !sidecar) return null;

  const count = sidecar.current_count;

  return (
    <div ref={badgeWrapRef} className="relative">
      <Tooltip
        label={`Streak: ${count} ${count === 1 ? "day" : "days"}`}
        placement="bottom"
      >
        <button
          type="button"
          aria-label={`Streak: ${count} ${count === 1 ? "day" : "days"}. Click for details.`}
          onClick={() => setPopoverOpen((o) => !o)}
          data-testid="streak-badge"
          className="inline-flex items-center gap-1 bg-sky-50 dark:bg-brand-action/15 border border-sky-200 dark:border-sky-500/30 rounded-full px-2 py-0.5 hover:bg-sky-100 dark:hover:bg-brand-action/20 transition-colors"
        >
          <FlameIcon className="w-3.5 h-3.5 text-sky-500" />
          <span className="text-meta font-semibold text-sky-700 dark:text-sky-300 tabular-nums">
            {count}
          </span>
        </button>
      </Tooltip>

      {popoverOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Streak details"
          data-testid="streak-badge-popover"
          className="absolute left-0 top-full mt-2 w-64 bg-surface-raised rounded-xl shadow-xl border border-border z-50 p-3 text-body"
        >
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <FlameIcon className="w-4 h-4 text-sky-500" />
            <span>
              {count} day {count === 1 ? "streak" : "streak"}
            </span>
          </div>
          {sidecar.started_on && (
            <div className="mt-2 text-meta text-foreground-muted">
              Started {sidecar.started_on}
            </div>
          )}
          <div className="text-meta text-foreground-muted">
            Personal best: {sidecar.longest_count}{" "}
            {sidecar.longest_count === 1 ? "day" : "days"}
          </div>
          <div className="mt-3 pt-2 border-t border-border text-meta text-foreground-muted">
            Private to you. Edit in Settings.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline flame icon. The project does not depend on lucide-react;
 * keeping the SVG inline matches the convention used by every other
 * AppShell icon (nav gear, help question mark, notification bell).
 * Path is the standard "flame" silhouette (24x24, currentColor) so
 * className can drive sizing AND color.
 */
function FlameIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12.83 2.18a1 1 0 0 0-1.66 0c-.91 1.34-2.21 2.34-3.59 3.4C5.78 7 4 8.55 4 12a8 8 0 0 0 16 0c0-2.74-1.18-4.36-2.46-5.93a17.66 17.66 0 0 1-1.43-1.92 14.6 14.6 0 0 1-2.85-1.97 1 1 0 0 0-.43 0Zm-.83 16a4 4 0 0 1-4-4c0-1.62.7-2.49 1.84-3.6.39-.38.8-.78 1.2-1.24a8.43 8.43 0 0 0 1.55 1.86c1.04.99 1.41 1.7 1.41 2.98a4 4 0 0 1-2 4Z" />
    </svg>
  );
}
