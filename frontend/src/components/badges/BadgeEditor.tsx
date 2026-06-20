"use client";

// Badge editor (badges phase 2). Controlled owner-side pinning.
//
// The interactive surface the OWNER uses to choose which earned badges to feature
// before publishing a snapshot to their public profile. Fully CONTROLLED: the
// caller owns the pinned array and the earned set (computed from real metrics)
// and receives every change via onChange, so the editor itself does no
// persistence (no localStorage, no folder, no network). The holder UI
// (ProfileEditorCard for a researcher, the lab-site dashboard for a lab) holds
// the draft pins and publishes them.
//
// Earned badges are tap-to-pin/unpin up to the shared cap; locked badges show how
// they are earned and cannot be pinned. The cap rule lives in snapshot.ts
// (normalizePins), so the editor and the publish builder agree.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { useCallback, useMemo } from "react";

import BadgeMedallion from "@/components/badges/BadgeMedallion";
import { BADGE_CATALOG } from "@/lib/badges/catalog";
import { MAX_PINNED_BADGES } from "@/lib/badges/snapshot";

export default function BadgeEditor({
  earnedBadgeIds,
  pinnedBadgeIds,
  onChange,
}: {
  /** The holder's earned badge ids (from real metrics). Only these are pinnable. */
  earnedBadgeIds: string[];
  /** The currently pinned ids (controlled). */
  pinnedBadgeIds: string[];
  /** Notifies the caller of the next pinned set after a tap. */
  onChange: (nextPinned: string[]) => void;
}) {
  const earned = useMemo(() => new Set(earnedBadgeIds), [earnedBadgeIds]);
  const pinned = useMemo(() => new Set(pinnedBadgeIds), [pinnedBadgeIds]);
  const capHit = pinnedBadgeIds.length >= MAX_PINNED_BADGES;

  const togglePin = useCallback(
    (id: string) => {
      if (!earned.has(id)) return;
      if (pinned.has(id)) {
        onChange(pinnedBadgeIds.filter((x) => x !== id));
        return;
      }
      if (pinnedBadgeIds.length >= MAX_PINNED_BADGES) return;
      onChange([...pinnedBadgeIds, id]);
    },
    [earned, pinned, pinnedBadgeIds, onChange],
  );

  return (
    <div>
      <p className="mb-3 text-meta text-foreground-muted">
        {capHit
          ? `You can pin up to ${MAX_PINNED_BADGES} badges. Unpin one to make room.`
          : `Pin up to ${MAX_PINNED_BADGES} earned badges to feature on your public profile.`}
      </p>
      <ul className="flex flex-wrap gap-5">
        {BADGE_CATALOG.map((badge) => {
          const isEarned = earned.has(badge.id);
          const isPinned = pinned.has(badge.id);
          const tag = !isEarned ? "Locked" : isPinned ? "Pinned" : "Tap to pin";
          return (
            <li
              key={badge.id}
              className="flex w-28 flex-col items-center gap-2 text-center"
            >
              <button
                type="button"
                onClick={() => togglePin(badge.id)}
                disabled={!isEarned}
                aria-pressed={isPinned}
                className={[
                  "rounded-full outline-offset-4",
                  isEarned
                    ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-action"
                    : "cursor-default",
                  isPinned
                    ? "ring-2 ring-brand-action ring-offset-2 ring-offset-surface rounded-full"
                    : "",
                ].join(" ")}
              >
                <BadgeMedallion badge={badge} size="sm" earned={isEarned} />
              </button>
              <span className="text-meta font-medium text-foreground">
                {badge.label}
              </span>
              <span
                className={[
                  "text-meta",
                  isPinned ? "text-brand-action" : "text-foreground-muted",
                ].join(" ")}
              >
                {tag}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
