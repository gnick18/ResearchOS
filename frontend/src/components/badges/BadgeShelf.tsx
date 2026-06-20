// Pinned-badge shelf (badges v1). Read-only public display.
//
// Shows up to 4 pinned badges as large medallions with their labels, the way
// they appear on a public network profile. It takes already-resolved pinned
// ids and the set of earned ids; it does NOT read localStorage itself (that is
// BadgeBin's job, the interactive surface). When nothing is pinned it renders
// nothing, so a profile with no badges is unchanged.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import BadgeMedallion from "@/components/badges/BadgeMedallion";
import { getBadge } from "@/lib/badges/catalog";

/** Max pinned badges on the shelf (mirrors the bin's pin cap). */
const MAX_PINNED = 4;

export default function BadgeShelf({
  pinnedIds,
  earnedIds,
}: {
  pinnedIds: string[];
  earnedIds: string[];
}) {
  const earned = new Set(earnedIds);
  const badges = pinnedIds
    .slice(0, MAX_PINNED)
    .map((id) => getBadge(id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-6">
      {badges.map((badge) => (
        <div
          key={badge.id}
          className="flex w-24 flex-col items-center gap-2 text-center"
        >
          <BadgeMedallion
            badge={badge}
            size="lg"
            earned={earned.has(badge.id)}
          />
          <span className="text-meta font-medium text-foreground">
            {badge.label}
          </span>
        </div>
      ))}
    </div>
  );
}
