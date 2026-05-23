"use client";

import { useQuery } from "@tanstack/react-query";
import { listAnnouncements } from "@/lib/lab/announcements";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * sidebar widget — "Today's announcements." Pinned announcements
 * condensed to titles only (proposal §3g). Reuses the same
 * `listAnnouncements` query the canvas widget reads; React Query
 * dedupes the fetch so the sidebar version is free.
 */
export default function TodaysAnnouncementsWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["lab-announcements"],
    queryFn: listAnnouncements,
  });

  const pinned = announcements.filter((a) => a.pinned);

  if (isLoading) {
    return (
      <div className="text-xs text-gray-400 italic">Loading…</div>
    );
  }

  if (pinned.length === 0) {
    return (
      <div className="text-xs text-gray-400 italic">
        No pinned announcements.
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {pinned.slice(0, 5).map((a) => (
        <li
          key={a.id}
          className="text-xs text-gray-700 truncate flex items-start gap-1"
          title={a.text}
        >
          {/* Pin icon. Inline SVG (project does not depend on
              lucide-react). Replaces the earlier 📌 emoji per Grant's
              no-emojis rule. */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="text-emerald-500 flex-shrink-0 mt-0.5"
          >
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" />
          </svg>
          {/* First line only, the compact sidebar format calls for
              titles, not the full body. The full text shows in the
              canvas Announcements widget. */}
          <span className="truncate">{a.text.split("\n")[0]}</span>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A snapshot + expanded contract (Phase A redispatch manager, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
// The widget body above is unchanged (inline pin SVG preserved). The
// snapshot reads the same `lab-announcements` cache; the body is the
// expanded popup content.
import StatTile from "./snapshot/StatTile";
import type { SnapshotTileProps } from "./types";

export function SnapshotTile(_props: SnapshotTileProps) {
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["lab-announcements"],
    queryFn: listAnnouncements,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const pinned = announcements.filter((a) => a.pinned).length;
  return (
    <StatTile
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="12" y1="17" x2="12" y2="22" />
          <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" />
        </svg>
      }
      iconClassName="text-emerald-500"
      label="Pinned today"
      stat={isLoading ? "—" : pinned}
      sub={pinned === 0 ? "Nothing pinned" : "announcement" + (pinned === 1 ? "" : "s")}
    />
  );
}

export const ExpandedView = TodaysAnnouncementsWidget;
