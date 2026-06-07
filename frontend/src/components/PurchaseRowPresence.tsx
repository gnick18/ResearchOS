"use client";

/**
 * PurchaseRowPresence.tsx
 *
 * Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 4 = the quiet
 * live-presence indicator shown on the open purchase row when a REMOTE peer is
 * editing the SAME item. Styled like the NoteDetailPopup presence indicator (a
 * small avatar + "<name> is editing" in a muted emerald tint).
 *
 * Renders nothing when there are no remote peers (solo edit / flag off), so it
 * is invisible until a real collaborator joins.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import UserAvatar from "@/components/UserAvatar";
import type { RemotePurchasePeer } from "@/lib/loro/use-purchase-presence";

export default function PurchaseRowPresence({
  peers,
}: {
  peers: RemotePurchasePeer[];
}) {
  if (peers.length === 0) return null;

  // De-duplicate by username so two devices of one collaborator read as one
  // person. Order is stable (first appearance wins).
  const seen = new Set<string>();
  const names: string[] = [];
  for (const peer of peers) {
    const name = peer.presence.username;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  const label =
    names.length === 1
      ? `${names[0]} is editing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are editing`
        : `${names[0]} +${names.length - 1} others are editing`;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-meta text-emerald-600 dark:text-emerald-300"
      data-testid="purchase-row-presence"
    >
      <span className="relative flex-shrink-0 h-5" style={{ width: `${20 + (Math.min(names.length, 3) - 1) * 8}px` }}>
        {names.slice(0, 3).map((name, idx) => (
          <span
            key={name}
            className="absolute top-0"
            style={idx === 0 ? undefined : { left: `${idx * 8}px` }}
          >
            <UserAvatar username={name} size="xs" />
          </span>
        ))}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}
