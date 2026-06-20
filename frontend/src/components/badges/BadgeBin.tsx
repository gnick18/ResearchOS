// Badge bin (badges v1). The full catalog with tap-to-pin.
//
// Renders every catalog badge as a small medallion. Earned badges are
// tap-to-pin/unpin (max 4 pinned, with a gentle cap message); locked badges
// show how they are earned and cannot be pinned. The pinned set is the source
// of truth for the public BadgeShelf above it.
//
// PINNING PERSISTENCE (v1): localStorage ONLY, keyed by profileId
// (`ros.badges.pinned.<profileId>`). v1 persists pins in localStorage; phase 2
// will move pins to a folder sidecar plus publish a badge snapshot to the
// network profile (data-shape decision pending Grant). No folder sidecar file
// or persisted JSON format is created now.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

"use client";

import { useCallback, useEffect, useState } from "react";

import BadgeMedallion from "@/components/badges/BadgeMedallion";
import { BADGE_CATALOG } from "@/lib/badges/catalog";
import { useNudge, markNudgeUsed } from "@/lib/ui/use-nudge";

/** Max pinned badges. Shared cap with the shelf. */
const MAX_PINNED = 4;

/** localStorage key for one profile's pinned badge ids. */
function pinKey(profileId: string): string {
  return `ros.badges.pinned.${profileId}`;
}

function readPins(profileId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(pinKey(profileId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writePins(profileId: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pinKey(profileId), JSON.stringify(ids));
  } catch {
    // localStorage can be unavailable (private mode, quota). Pins are a
    // convenience in v1, so a failed write degrades to in-memory only.
  }
}

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
  const earned = new Set(earnedIds);
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

  // Hydrate pins from localStorage on mount and whenever the profile changes.
  useEffect(() => {
    const initial = readPins(profileId);
    setPinned(initial);
    onPinsChange?.(initial);
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
        writePins(profileId, next);
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
