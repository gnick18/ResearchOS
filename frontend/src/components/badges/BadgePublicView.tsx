// Public badge view (badges phase 2). Read-only, snapshot-driven.
//
// Renders a holder's published badge snapshot on their public network page: the
// pinned shelf up top, then the full catalog as a read-only grid (earned in
// color, the rest locked) so a visitor sees both what was earned and what is
// still out there. A visitor cannot pin (that is the owner's editor), so there
// is no interactivity here, and no localStorage or folder read. When nothing is
// earned it renders nothing, so a holder with no badges is byte-identical.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import BadgeMedallion from "@/components/badges/BadgeMedallion";
import BadgeShelf from "@/components/badges/BadgeShelf";
import { BADGE_CATALOG } from "@/lib/badges/catalog";
import { isBadgeSnapshotEmpty, type BadgeSnapshot } from "@/lib/badges/snapshot";

export default function BadgePublicView({
  snapshot,
  showHeader = true,
}: {
  snapshot: BadgeSnapshot;
  /** Render the section heading + blurb (true on a profile among other sections). */
  showHeader?: boolean;
}) {
  if (isBadgeSnapshotEmpty(snapshot)) return null;

  const earned = new Set(snapshot.earnedBadgeIds);

  return (
    <section className={showHeader ? "mt-12 border-t border-border pt-8" : ""}>
      {showHeader && (
        <>
          <h2 className="text-title font-semibold text-foreground">Badges</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Earned from real activity on ResearchOS.
          </p>
        </>
      )}

      {snapshot.pinnedBadgeIds.length > 0 && (
        <div className="mt-6">
          <BadgeShelf
            pinnedIds={snapshot.pinnedBadgeIds}
            earnedIds={snapshot.earnedBadgeIds}
          />
        </div>
      )}

      <ul className="mt-8 flex flex-wrap gap-5">
        {BADGE_CATALOG.map((badge) => {
          const isEarned = earned.has(badge.id);
          return (
            <li
              key={badge.id}
              className="flex w-28 flex-col items-center gap-2 text-center"
            >
              <BadgeMedallion badge={badge} size="sm" earned={isEarned} />
              <span className="text-meta font-medium text-foreground">
                {badge.label}
              </span>
              <span className="text-meta text-foreground-muted">
                {isEarned ? "Earned" : "Locked"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
