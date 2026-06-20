// Badge bin (badges v1). The full catalog with tap-to-pin.
//
// Renders every catalog badge as a small medallion. Earned badges are
// tap-to-pin/unpin (max 4 pinned, with a gentle cap message); locked badges
// show how they are earned and cannot be pinned. The pinned set is the source
// of truth for the public BadgeShelf above it.
//
// PINNING PERSISTENCE (phase 2): the account-scoped cloud blob is the durable,
// cross-device home (Grant's call over a folder sidecar), with a per-device
// localStorage cache for instant paint. Both live behind lib/badges/pins.ts; the
// cloud write is flag-guarded and best-effort, so the bin still works (cache
// only) when account settings are off or no identity is unlocked.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import BadgeMedallion from "@/components/badges/BadgeMedallion";
import { BADGE_CATALOG } from "@/lib/badges/catalog";
import { loadPinnedBadgeIds, savePinnedBadgeIds } from "@/lib/badges/pins";
import { useNudge, markNudgeUsed } from "@/lib/ui/use-nudge";

/** Max pinned badges. Shared cap with the shelf. */
const MAX_PINNED = 4;

export default function BadgeBin({
  profileId,
  earnedIds,
  onPinsChange,
}: {
  profileId: string;
  earnedIds: string[];
  /** Notifies a parent (e.g. the shelf) when the pinned set changes. */
  onPinsChange?: (pinnedIds: string[]) => void;
}) {
  const earned = useMemo(() => new Set(earnedIds), [earnedIds]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [capHit, setCapHit] = useState(false);

  // Invite pinning. A medallion is tap-to-pin, but that is easy to walk past, so
  // the first earned-but-unpinned badge shimmers the first few times this bin is
  // open with room to pin. The cue tracks "has an unpinned earned badge and the
  // pin cap is not full" and retires for good on the first pin (markNudgeUsed).
  const firstPinnableId =
    BADGE_CATALOG.find((b) => earned.has(b.id) && !pinned.includes(b.id))?.id ??
    null;
  const nudgePin = useNudge("badges-pin", {
    eligible: firstPinnableId != null && pinned.length < MAX_PINNED,
  });

  // Hydrate pins on mount and whenever the profile changes. The loader prefers
  // the account-scoped cloud value and falls back to the per-device cache. The
  // cancelled guard drops a stale resolve if the profile changes mid-flight.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const initial = await loadPinnedBadgeIds(profileId);
      if (cancelled) return;
      setPinned(initial);
      onPinsChange?.(initial);
    })();
    return () => {
      cancelled = true;
    };
    // onPinsChange is intentionally excluded; it is a notification callback and
    // including it would re-run the hydration on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const togglePin = useCallback(
    (id: string) => {
      if (!earned.has(id)) return;
      // A deliberate pin interaction means the user has found the affordance, so
      // retire the discovery shimmer for good.
      markNudgeUsed("badges-pin");
      setCapHit(false);
      setPinned((prev) => {
        let next: string[];
        if (prev.includes(id)) {
          next = prev.filter((x) => x !== id);
        } else if (prev.length >= MAX_PINNED) {
          setCapHit(true);
          return prev;
        } else {
          next = [...prev, id];
        }
        void savePinnedBadgeIds(profileId, next);
        onPinsChange?.(next);
        return next;
      });
    },
    [earned, profileId, onPinsChange],
  );

  return (
    <div>
      {capHit && (
        <p className="mb-3 text-meta text-foreground-muted">
          You can pin up to {MAX_PINNED} badges. Unpin one to make room.
        </p>
      )}
      <ul className="flex flex-wrap gap-5">
        {BADGE_CATALOG.map((badge) => {
          const isEarned = earned.has(badge.id);
          const isPinned = pinned.includes(badge.id);
          const tag = !isEarned
            ? "Locked"
            : isPinned
              ? "Pinned"
              : "Tap to pin";
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
                title={badge.description}
                className={[
                  "rounded-full outline-offset-4",
                  isEarned
                    ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-action"
                    : "cursor-default",
                  isPinned ? "ring-2 ring-brand-action ring-offset-2 ring-offset-surface rounded-full" : "",
                  nudgePin && badge.id === firstPinnableId ? "ros-nudge-shimmer" : "",
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
