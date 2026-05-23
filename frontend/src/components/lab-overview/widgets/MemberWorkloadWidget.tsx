"use client";

import { useMemo } from "react";
import { useLabData } from "@/hooks/useLabData";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { useAccountType } from "@/hooks/useAccountType";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import UserAvatar from "@/components/UserAvatar";

/**
 * Lab Mode retirement R3 (R3 widget catalog manager, 2026-05-23):
 * member workload at-a-glance, sidebar surface. Replaces the R2 stub.
 *
 * One line per lab member: avatar + display name + open-task count +
 * overdue-task count. Sorted by overdue count DESC so the busiest /
 * most-behind member floats to the top.
 *
 * Data: pulls every lab member's open tasks via useLabData (the same
 * cache the canvas widgets read). "Open" = !is_complete. "Overdue" =
 * !is_complete AND end_date < today.
 *
 * Visibility: `memberVisible: false` in the catalog, so this is a
 * PI-only widget. We defensively guard against stale layouts here
 * too — if a viewer slipped through without account_type === lab_head,
 * the body returns null.
 */
export default function MemberWorkloadWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { users, tasks } = useLabData();
  const profileMap = useLabUserProfileMap();

  const rows = useMemo(() => {
    const today = todayIso();
    return users
      .map((u) => {
        let open = 0;
        let overdue = 0;
        for (const t of tasks) {
          if (t.username !== u.username) continue;
          if (t.is_complete) continue;
          // Goals are excluded upstream via labApi.getTasks({exclude_goals:true}).
          open++;
          if (t.end_date && t.end_date < today) overdue++;
        }
        return {
          username: u.username,
          displayName:
            profileMap[u.username]?.displayName?.trim() || u.username,
          open,
          overdue,
        };
      })
      .sort((a, b) => {
        // Overdue DESC; ties broken by open DESC so the most-loaded
        // member surfaces above an equally-overdue but lower-volume one.
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
        return b.open - a.open;
      });
  }, [users, tasks, profileMap]);

  if (accountType !== "lab_head") {
    return null;
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        No lab members yet.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li
          key={r.username}
          className="flex items-center gap-1.5 px-1 py-1 rounded"
          title={`${r.displayName} — ${r.open} open, ${r.overdue} overdue`}
        >
          <UserAvatar username={r.username} size="sm" />
          <span className="text-xs text-gray-700 truncate flex-1 min-w-0">
            {r.displayName}
          </span>
          <span
            className={`text-[10px] font-semibold tabular-nums px-1 py-0.5 rounded ${
              r.open === 0
                ? "bg-gray-100 text-gray-400"
                : "bg-gray-100 text-gray-700"
            }`}
            title="Open tasks"
          >
            {r.open}
          </span>
          <span
            className={`text-[10px] font-semibold tabular-nums px-1 py-0.5 rounded ${
              r.overdue === 0
                ? "bg-gray-100 text-gray-400"
                : "bg-red-100 text-red-800"
            }`}
            title="Overdue tasks"
          >
            {r.overdue}
          </span>
        </li>
      ))}
    </ul>
  );
}

function todayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A snapshot + expanded contract (Phase A redispatch manager, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
// The widget body above is unchanged from R3 + Mira polish (archived
// users are excluded upstream via `useArchivedUsers` consumers; here
// the per-member rows preserve that filter). Snapshot summarizes the
// total open + overdue across the lab.
import StatTile from "./snapshot/StatTile";
import type { SnapshotTileProps } from "./types";

export function SnapshotTile(_props: SnapshotTileProps) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { tasks } = useLabData();
  if (accountType !== "lab_head") return null;
  const today = todayIso();
  let open = 0;
  let overdue = 0;
  for (const t of tasks) {
    if (t.is_complete) continue;
    open++;
    if (t.end_date && t.end_date < today) overdue++;
  }
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
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      }
      iconClassName="text-indigo-500"
      label="Member workload"
      stat={open}
      sub={
        overdue > 0
          ? `${overdue} overdue lab-wide`
          : "open tasks lab-wide"
      }
    />
  );
}

export const ExpandedView = MemberWorkloadWidget;
