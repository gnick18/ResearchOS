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
          className="text-xs text-gray-700 truncate"
          title={a.text}
        >
          <span className="text-emerald-500 mr-1">📌</span>
          {/* First line only — the compact sidebar format calls for
              titles, not the full body. The full text shows in the
              canvas Announcements widget. */}
          {a.text.split("\n")[0]}
        </li>
      ))}
    </ul>
  );
}
