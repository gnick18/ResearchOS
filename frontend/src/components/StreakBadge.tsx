"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  onStreakSidecarChanged,
  patchStreak,
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
 *
 * L5 first-reveal tooltip: when the badge transitions hidden -> visible
 * AND the sidecar's `shown_privacy_notice` is still false, a one-shot
 * speech-bubble tooltip explains that the streak is private. Auto
 * dismisses after 8 seconds OR on any click. After dismiss the badge
 * patches `shown_privacy_notice = true` so the tooltip never re-fires.
 */

interface StreakBadgeProps {
  /** Active user; null hides the badge entirely. */
  username: string | null;
}

const FIRST_REVEAL_AUTO_DISMISS_MS = 8_000;

export default function StreakBadge({ username }: StreakBadgeProps) {
  const [sidecar, setSidecar] = useState<StreakSidecar | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [firstRevealVisible, setFirstRevealVisible] = useState(false);

  // We dismiss the first-reveal tooltip exactly once per badge mount.
  // Keep the "did we already see count >= 1 this mount" memory in a
  // ref so the dismiss handler can flip it without re-rendering and
  // without depending on stale closure state.
  const sawNonzeroOnceRef = useRef(false);
  const firstRevealTimerRef = useRef<number | null>(null);

  const badgeWrapRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Initial load whenever username changes. A null username clears
  // the sidecar so a sign-out hides the badge immediately.
  useEffect(() => {
    if (!username) {
      setSidecar(null);
      sawNonzeroOnceRef.current = false;
      setFirstRevealVisible(false);
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

  // L5 first-reveal trigger: when the badge transitions hidden -> visible
  // for the first time this mount AND the sidecar says we've never
  // shown the notice, surface the speech bubble.
  useEffect(() => {
    if (!visible || !sidecar || !username) return;
    if (sawNonzeroOnceRef.current) return;
    sawNonzeroOnceRef.current = true;
    if (sidecar.shown_privacy_notice) return;
    setFirstRevealVisible(true);
    if (typeof window !== "undefined") {
      firstRevealTimerRef.current = window.setTimeout(() => {
        dismissFirstReveal();
      }, FIRST_REVEAL_AUTO_DISMISS_MS);
    }
    // dismissFirstReveal is stable (defined below with useCallback over
    // refs only) but the lint rule still flags it; the only real
    // dependency change here is on `visible` flipping true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sidecar, username]);

  // Cleanup the auto-dismiss timer on unmount so a teardown mid-fire
  // doesn't try to setState on an unmounted component.
  useEffect(() => {
    return () => {
      if (firstRevealTimerRef.current !== null) {
        window.clearTimeout(firstRevealTimerRef.current);
        firstRevealTimerRef.current = null;
      }
    };
  }, []);

  const dismissFirstReveal = useCallback(() => {
    setFirstRevealVisible(false);
    if (firstRevealTimerRef.current !== null) {
      window.clearTimeout(firstRevealTimerRef.current);
      firstRevealTimerRef.current = null;
    }
    if (!username) return;
    // Fire-and-forget the persistence flip; if the write fails the
    // user might see the tooltip once more on next mount, which is
    // benign compared to blocking the UI on a sidecar write.
    void patchStreak(username, (cur) =>
      cur.shown_privacy_notice ? cur : { ...cur, shown_privacy_notice: true },
    ).catch((err) => {
      console.warn(
        "[StreakBadge] failed to persist shown_privacy_notice:",
        err,
      );
    });
  }, [username]);

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

      {firstRevealVisible && (
        <FirstRevealBubble
          anchor={badgeWrapRef.current}
          onDismiss={dismissFirstReveal}
        />
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

/**
 * L5 first-reveal speech-bubble. Portaled to document.body so it
 * cannot be clipped by an `overflow: hidden` ancestor in the header.
 * Anchored to the badge's bottom edge with the tail pointing up at
 * the badge. Click ANYWHERE on the bubble dismisses; clicking outside
 * does NOT (auto-dismiss handles that).
 */
function FirstRevealBubble({
  anchor,
  onDismiss,
}: {
  anchor: HTMLElement | null;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!anchor) return;
    const update = () => {
      const r = anchor.getBoundingClientRect();
      // Slightly LEFT of center so the tail at ~24px from the left
      // edge points up at the badge.
      setPos({
        top: r.bottom + 12,
        left: r.left - 8,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor]);

  // Top-level document click also dismisses. We attach in capture phase
  // so the popover's own click-handler still wins for in-bubble clicks
  // when the bubble itself is the target — the bubble's onClick fires
  // first as part of normal bubbling, then this dismiss fires regardless.
  useEffect(() => {
    const onAnyClick = () => onDismiss();
    document.addEventListener("click", onAnyClick);
    return () => document.removeEventListener("click", onAnyClick);
  }, [onDismiss]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-testid="streak-first-reveal"
      role="status"
      onClick={onDismiss}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        opacity: pos ? 1 : 0,
        transition: "opacity 120ms",
        zIndex: 1100,
      }}
      className="cursor-pointer max-w-[240px]"
    >
      {/* Tail: an upward-pointing triangle. Positioned so its tip
          aligns with the badge above. */}
      <div
        aria-hidden="true"
        className="ml-5 w-0 h-0"
        style={{
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderBottom: "6px solid rgb(186 230 253)",
        }}
      />
      <div className="bg-sky-50 dark:bg-sky-500/15 border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-300 rounded-lg shadow-md px-3 py-2 text-meta">
        Your streak is private to you. Disable in Settings anytime.
      </div>
    </div>,
    document.body,
  );
}
