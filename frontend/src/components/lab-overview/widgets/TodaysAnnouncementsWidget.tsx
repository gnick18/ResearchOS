"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAnnouncements } from "@/lib/lab/announcements";
import UserAvatar from "@/components/UserAvatar";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * sidebar widget — "Today's announcements." Pinned announcements
 * condensed to titles only (proposal §3g). Reuses the same
 * `listAnnouncements` query the canvas widget reads; React Query
 * dedupes the fetch so the sidebar version is free.
 *
 * Phase B Batch B2 (Phase B Batch B2 manager, 2026-05-23): the body
 * stays a tight pin-list (preserves the inline pin SVG); SnapshotTile
 * and SidebarTile each get unique compact designs, and the body adds a
 * "View all in Announcements" footer that walks the user to the full
 * AnnouncementsWidget popup.
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
        No pinned announcements today.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <ul className="space-y-1.5">
        {pinned.slice(0, 5).map((a) => (
          <li
            key={a.id}
            className="text-xs text-gray-700 truncate flex items-start gap-1"
            title={a.text}
          >
            {/* Pin icon. Inline SVG (project does not depend on
                lucide-react). Replaces the earlier 📌 emoji per Grant's
                no-emojis rule. PRESERVED — Phase B Batch B2 keeps the
                exact path from R2. */}
            {PIN_SVG_BODY_SIZE}
            {/* First line only, the compact sidebar format calls for
                titles, not the full body. The full text shows in the
                canvas Announcements widget. */}
            <span className="truncate">{a.text.split("\n")[0]}</span>
          </li>
        ))}
      </ul>
      {/* Phase B Batch B2: footer link that walks the user to the full
          AnnouncementsWidget popup so the today-filtered slice doesn't
          dead-end. We can't directly open another widget's popup from
          here (each widget owns its own popup), so we surface this as
          a labelled hint — the AnnouncementsWidget tile sits on the
          canvas next to this one. */}
      <p className="mt-1 pt-1.5 border-t border-gray-100 text-[10px] text-gray-400">
        Open the Announcements widget to see the full thread, edit, or
        post a new one.
      </p>
    </div>
  );
}

// Inline pin SVG (PRESERVED — Mira-Literal rule). The widget body uses
// 12px for the compact pinlist; the snapshot/sidebar tiles need their
// own sizes (16 / 14) but with the same `<path>` geometry.
const PIN_SVG_BODY_SIZE = (
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
);

const PIN_SVG = (size: number) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
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
);

// ─────────────────────────────────────────────────────────────────────────────
// Phase B Batch B2 (Phase B Batch B2 manager, 2026-05-23): unique tile
// designs for the today-filtered slice.
// ─────────────────────────────────────────────────────────────────────────────
// SnapshotTile: stacked mini-list ("Today" header + up to 3 preview
// rows with avatar + first-line text). Distinct from the Announcements
// widget's HeroNumberTile so the two tiles read as different at a
// glance even when placed side-by-side on the canvas.
import type { SnapshotTileProps, SidebarTileProps } from "./types";
import SidebarStatTile from "./snapshot/SidebarStatTile";

export function SnapshotTile(_props: SnapshotTileProps) {
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["lab-announcements"],
    queryFn: listAnnouncements,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const pinned = useMemo(
    () => announcements.filter((a) => a.pinned),
    [announcements],
  );

  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          aria-hidden="true"
          className="text-emerald-500 flex items-center justify-center flex-shrink-0"
        >
          {PIN_SVG(14)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-medium truncate">
          Today
        </span>
      </div>
      {isLoading ? (
        <p className="text-xs text-gray-400 italic">Loading…</p>
      ) : pinned.length === 0 ? (
        <p className="flex-1 flex items-center text-xs text-gray-400 italic">
          No pinned announcements today
        </p>
      ) : (
        <ul className="flex-1 flex flex-col gap-1.5 min-h-0">
          {pinned.slice(0, 3).map((a) => {
            const firstLine = a.text.split("\n")[0];
            return (
              <li
                key={a.id}
                className="flex items-start gap-1.5 min-w-0"
                title={a.text}
              >
                <UserAvatar username={a.author} size="xs" />
                <span className="text-xs text-gray-700 leading-snug truncate flex-1 min-w-0">
                  {firstLine}
                </span>
              </li>
            );
          })}
          {pinned.length > 3 && (
            <li className="text-[10px] text-gray-400 pl-7">
              +{pinned.length - 3} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export const ExpandedView = TodaysAnnouncementsWidget;

// SidebarTile: pin icon + "X pinned" + truncated single-line preview
// of the top pinned item. The single-row layout in SidebarStatTile is
// too narrow for a preview line, so the tile renders its own compact
// stack (icon row + preview row) inside an interactive shell.
export function SidebarTile({ onClick }: SidebarTileProps) {
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["lab-announcements"],
    queryFn: listAnnouncements,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const pinned = useMemo(
    () => announcements.filter((a) => a.pinned),
    [announcements],
  );
  const top = pinned[0];
  const preview = top?.text.split("\n")[0] ?? "";

  // When there's no preview line, fall back to the canonical
  // SidebarStatTile so the row reads uniformly with neighbors.
  if (!top) {
    return (
      <SidebarStatTile
        icon={PIN_SVG(14)}
        iconClassName="text-emerald-500"
        label="Pinned"
        stat={isLoading ? "—" : 0}
        sub="Nothing pinned"
        onClick={onClick}
      />
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full flex flex-col gap-1 px-2.5 py-2 rounded-md cursor-pointer hover:bg-gray-100 focus:bg-gray-100 focus:outline-none transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className="text-emerald-500 flex items-center justify-center flex-shrink-0"
        >
          {PIN_SVG(14)}
        </span>
        <span className="text-xs font-medium text-gray-700 truncate flex-1 min-w-0">
          {pinned.length} pinned
        </span>
      </div>
      <p className="text-[11px] text-gray-500 truncate pl-6" title={top.text}>
        {preview}
      </p>
    </div>
  );
}
