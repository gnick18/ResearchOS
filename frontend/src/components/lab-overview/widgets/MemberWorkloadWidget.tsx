"use client";

import { useMemo } from "react";
import { useLabData } from "@/hooks/useLabData";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { useAccountType } from "@/hooks/useAccountType";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import UserAvatar from "@/components/UserAvatar";

const PEOPLE_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
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
);

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
export default function MemberWorkloadWidget(props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar" | "strip";
}) {
  const surface = props?.surface;
  const { currentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(currentUser);
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

  if (!isLabHead) {
    return null;
  }

  if (rows.length === 0) {
    return (
      <p className="text-meta text-foreground-muted italic">
        No lab members yet.
      </p>
    );
  }

  // Strip surface (lab-overview): a full-width responsive grid of compact
  // member cards, each with a shared-scale workload bar, so a PI reads the
  // whole lab's load in one glance row instead of a tall narrow column.
  if (surface === "strip") {
    const maxOpen = Math.max(1, ...rows.map((r) => r.open));
    return (
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {rows.map((r) => {
          const bluePct = Math.round(((r.open - r.overdue) / maxOpen) * 100);
          const redPct = Math.round((r.overdue / maxOpen) * 100);
          return (
            <li
              key={r.username}
              title={`${r.displayName}. Open: ${r.open} · Overdue: ${r.overdue}`}
              className="rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <UserAvatar username={r.username} size="sm" />
                <span className="min-w-0 flex-1 truncate text-meta font-medium text-foreground">
                  {r.displayName}
                </span>
              </div>
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full bg-brand-action"
                  style={{ width: `${bluePct}%` }}
                />
                <div
                  className="h-full bg-rose-500"
                  style={{ width: `${redPct}%` }}
                />
              </div>
              <div className="mt-1.5 text-meta text-foreground-muted">
                {r.open > 0 ? (
                  <>
                    <span className="font-medium text-foreground tabular-nums">
                      {r.open}
                    </span>{" "}
                    open
                    {r.overdue > 0 ? (
                      <span className="text-rose-600 dark:text-rose-400">
                        {" "}
                        · {r.overdue} overdue
                      </span>
                    ) : null}
                  </>
                ) : (
                  "No open tasks"
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li
          key={r.username}
          // Phase B Batch B3: row tooltip surfaces the full
          // "Open: N · Overdue: M" detail per the brief.
          // /workbench has no `?user=` param today (it scopes to
          // currentUser via the auth context, not a query string),
          // so we don't make the row clickable — clicking would
          // navigate to the PI's own workbench, not the member's,
          // which is more confusing than non-clickable. FOLLOW-UP:
          // wire a `/workbench?user=<username>` view for PIs once
          // the workbench surface owner picks it up.
          title={`${r.displayName}. Open: ${r.open} · Overdue: ${r.overdue}`}
          className="flex items-center gap-1.5 px-1 py-1 rounded"
        >
          <UserAvatar username={r.username} size="sm" />
          <span className="text-meta text-foreground truncate flex-1 min-w-0">
            {r.displayName}
          </span>
          <span
            className={`text-meta font-semibold tabular-nums px-1 py-0.5 rounded ${
              r.open === 0
                ? "bg-surface-sunken text-foreground-muted"
                : "bg-surface-sunken text-foreground"
            }`}
            title="Open tasks"
          >
            {r.open}
          </span>
          <span
            className={`text-meta font-semibold tabular-nums px-1 py-0.5 rounded ${
              r.overdue === 0
                ? "bg-surface-sunken text-foreground-muted"
                : "bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-200"
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
// Phase B Batch B3 (Phase B Batch B3 manager, 2026-05-23): unique
// per-widget tile designs.
// ─────────────────────────────────────────────────────────────────────────────
// SnapshotTile shows a vertical bar-chart-like preview of the 3 most
// loaded members (avatar + name + horizontal bar). Bar width is
// proportional to the busiest member's open count so the rows
// compare visually. Overdue counts tint the bar's tail red.
//
// SidebarTile compresses to a single row: people icon + "Workload"
// + "X members · Y overdue".
import type { SnapshotTileProps, SidebarTileProps } from "./types";

interface WorkloadRow {
  username: string;
  displayName: string;
  open: number;
  overdue: number;
}

/**
 * Shared row aggregator. Identical sort logic to the body so the
 * "top 3" in the snapshot matches the top 3 visible in the popup.
 */
function useWorkloadRows(): {
  accountType: ReturnType<typeof useAccountType>;
  rows: WorkloadRow[];
  totalMembers: number;
  totalOverdue: number;
} {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { users, tasks } = useLabData();
  const profileMap = useLabUserProfileMap();
  const today = todayIso();
  const rows = useMemo<WorkloadRow[]>(() => {
    return users
      .map<WorkloadRow>((u) => {
        let open = 0;
        let overdue = 0;
        for (const t of tasks) {
          if (t.username !== u.username) continue;
          if (t.is_complete) continue;
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
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
        return b.open - a.open;
      });
  }, [users, tasks, profileMap, today]);
  const totalOverdue = rows.reduce((s, r) => s + r.overdue, 0);
  return {
    accountType,
    rows,
    totalMembers: rows.length,
    totalOverdue,
  };
}

export function SnapshotTile(_props: SnapshotTileProps) {
  const { accountType, rows } = useWorkloadRows();
  if (accountType !== "lab_head") return null;
  const top = rows.slice(0, 3);
  // Bar denominator: largest open count across the top 3 so each
  // bar's width reads as "share of the busiest". When everyone has 0
  // open tasks, we render the "no active members" empty state.
  const maxOpen = Math.max(1, ...top.map((r) => r.open));
  const empty = top.length === 0 || top.every((r) => r.open === 0);
  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className="text-indigo-500 flex-shrink-0"
        >
          {PEOPLE_ICON}
        </span>
        <span className="text-meta uppercase tracking-wide text-foreground-muted font-medium truncate">
          Member workload
        </span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-center">
        {empty ? (
          <div className="text-meta text-foreground-muted italic">
            {top.length === 0 ? "No active members" : "Nothing open"}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {top.map((r) => {
              // Open bar width as % of the busiest member.
              const widthPct = Math.max(8, (r.open / maxOpen) * 100);
              const overdueShare =
                r.open > 0 ? Math.min(1, r.overdue / r.open) : 0;
              return (
                <li
                  key={r.username}
                  className="flex items-center gap-1.5 min-w-0"
                  title={`${r.displayName}. Open: ${r.open} · Overdue: ${r.overdue}`}
                >
                  <span className="flex-shrink-0">
                    <UserAvatar username={r.username} size="sm" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-meta text-foreground truncate"
                      title={r.displayName}
                    >
                      {r.displayName}
                    </div>
                    {/* Horizontal bar — indigo base with a red
                        sliver showing the overdue share. Inline
                        style for the per-row width because Tailwind
                        can't materialize arbitrary % values
                        ergonomically. */}
                    <div
                      className="h-1.5 bg-surface-sunken rounded overflow-hidden mt-0.5"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full flex"
                        style={{ width: `${widthPct}%` }}
                      >
                        <div
                          className="h-full bg-indigo-400"
                          style={{
                            width: `${(1 - overdueShare) * 100}%`,
                          }}
                        />
                        <div
                          className="h-full bg-red-400"
                          style={{ width: `${overdueShare * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <span className="text-meta text-foreground-muted tabular-nums flex-shrink-0">
                    {r.open}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export const ExpandedView = MemberWorkloadWidget;

/**
 * Lab overview PI tooltips (Chip B, 2026-05-25): help-badge copy for
 * the Member workload sidebar tile. PI-only.
 */
export const HELP_TEXT =
  "Open and overdue task counts for every lab member. PI only. Spot who is underwater before standup, click any row to drill into that person's queue.";

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile — single-row workload summary. "X members · Y overdue"
// is the at-a-glance "is anyone underwater?" cue.
// ─────────────────────────────────────────────────────────────────────────────

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { accountType, totalMembers, totalOverdue } = useWorkloadRows();
  if (accountType !== "lab_head") return null;
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md transition-colors ${
        interactive
          ? "cursor-pointer hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
          : ""
      }`}
    >
      <span aria-hidden="true" className="text-indigo-500 flex-shrink-0">
        {PEOPLE_ICON}
      </span>
      <span className="text-meta font-medium text-foreground truncate flex-1 min-w-0">
        Workload
      </span>
      <span className="text-meta text-foreground-muted tabular-nums flex-shrink-0">
        {totalMembers} member{totalMembers === 1 ? "" : "s"}
        {totalOverdue > 0 && (
          <>
            {" "}
            ·{" "}
            <span className="text-red-600 dark:text-red-300 font-semibold">
              {totalOverdue} overdue
            </span>
          </>
        )}
      </span>
    </div>
  );
}
