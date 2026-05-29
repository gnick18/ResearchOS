"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { weeklyGoalsApi } from "@/lib/local-api";
import Tooltip from "@/components/Tooltip";
import { mondayOf, weekLabel } from "@/lib/weekly-goals/week";
import type { WeeklyGoal } from "@/lib/types";
import type {
  ExpandedViewProps,
  SnapshotTileProps,
  SidebarTileProps,
} from "./types";
import SidebarStatTile from "./snapshot/SidebarStatTile";

/**
 * Weekly goals widget (PI beta feedback, weekly-goals widget, 2026-05-29).
 *
 * The TRAINEE-FACING CAPTURE UI. A compact box where a trainee logs the
 * weekly goals they set in their 1:1 meetings, marks them done, or deletes
 * them. This is LIGHTWEIGHT and STANDALONE — NOT the Gantt high-level-goal
 * editor (`HighLevelGoal` / SMART goals / project timelines). A weekly goal
 * never lands on the Gantt; the two concepts stay visually + conceptually
 * separate.
 *
 * Sharing: a new goal DEFAULTS to shared-to-lab ("*"), so the PI sees it in
 * the Trainee notes + weekly goals widget. The trainee can flip a goal to
 * private with the per-row lock toggle. Either way the PI surface reads
 * through `labApi.getWeeklyGoals({ shared_only })` + `canRead`, never a
 * bypass.
 *
 * Reachable as a member-visible widget on the /home canvas + /lab-overview
 * canvas (opt-in via the Add widget palette). Not auto-seeded into any
 * default layout — that keeps this change out of the Home default-layout
 * migration owned by a parallel agent.
 */

const WEEKLY_GOALS_QUERY_KEY = ["weekly-goals", "mine"] as const;

const TARGET_SVG = (
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
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

const CHECK_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const TRASH_SVG = (
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
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const SHARED_SVG = (
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

const LOCK_SVG = (
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
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

function useMyWeeklyGoals() {
  return useQuery<WeeklyGoal[]>({
    queryKey: WEEKLY_GOALS_QUERY_KEY,
    queryFn: () => weeklyGoalsApi.list(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** Group goals by week_of (newest week first). */
function groupByWeek(goals: WeeklyGoal[]): { week: string; goals: WeeklyGoal[] }[] {
  const map = new Map<string, WeeklyGoal[]>();
  for (const g of goals) {
    const list = map.get(g.week_of) ?? [];
    list.push(g);
    map.set(g.week_of, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, list]) => ({
      week,
      goals: list.sort((a, b) => {
        if (a.is_complete !== b.is_complete) return a.is_complete ? 1 : -1;
        return b.id - a.id;
      }),
    }));
}

/**
 * ExpandedView: the full capture box. Add a goal for the current week,
 * toggle done, toggle shared/private, delete.
 */
export default function WeeklyGoalsWidget(_props?: ExpandedViewProps) {
  const queryClient = useQueryClient();
  const { data: goals = [], isLoading } = useMyWeeklyGoals();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const thisWeek = mondayOf();
  const grouped = useMemo(() => groupByWeek(goals), [goals]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: WEEKLY_GOALS_QUERY_KEY });

  const handleAdd = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      // Default shared-to-lab so the goal is visible to the PI.
      await weeklyGoalsApi.create({ text, week_of: thisWeek, is_shared: true });
      setDraft("");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleToggleDone = async (goal: WeeklyGoal) => {
    await weeklyGoalsApi.update(goal.id, { is_complete: !goal.is_complete });
    await refresh();
  };

  const handleToggleShared = async (goal: WeeklyGoal) => {
    await weeklyGoalsApi.update(goal.id, { is_shared: !goal.is_shared });
    await refresh();
  };

  const handleDelete = async (goal: WeeklyGoal) => {
    await weeklyGoalsApi.delete(goal.id);
    await refresh();
  };

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <p className="text-xs text-gray-500">
        Log the goals you set in your 1:1 this week. Shared goals are visible
        to your PI. These are separate from your Gantt goals.
      </p>

      {/* Add row */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleAdd();
        }}
        className="flex items-center gap-2"
      >
        <span aria-hidden="true" className="text-emerald-500 flex-shrink-0">
          {TARGET_SVG}
        </span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add a goal for ${weekLabel(thisWeek)}…`}
          data-testid="weekly-goal-input"
          className="flex-1 min-w-0 text-sm rounded-lg border border-gray-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          data-testid="weekly-goal-add"
          className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-40 hover:bg-emerald-700 transition-colors"
        >
          Add
        </button>
      </form>

      {/* List, grouped by week */}
      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-3">
        {isLoading ? (
          <p className="text-sm text-gray-400 italic">Loading…</p>
        ) : grouped.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">
              No weekly goals yet
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Add the first goal you set in your 1:1. Your PI sees shared
              goals in their dashboard.
            </p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.week}>
              <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1.5">
                {weekLabel(group.week)}
              </p>
              <ul className="flex flex-col gap-1">
                {group.goals.map((goal) => (
                  <li
                    key={goal.id}
                    className="flex items-center gap-2 group"
                    data-testid={`weekly-goal-row-${goal.id}`}
                  >
                    <Tooltip
                      label={goal.is_complete ? "Mark not done" : "Mark done"}
                      placement="top"
                    >
                      <button
                        type="button"
                        onClick={() => void handleToggleDone(goal)}
                        data-testid={`weekly-goal-toggle-${goal.id}`}
                        aria-pressed={goal.is_complete}
                        className={`inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 transition-colors ${
                          goal.is_complete
                            ? "bg-emerald-500 text-white"
                            : "border border-gray-300 text-transparent hover:border-emerald-400"
                        }`}
                      >
                        {CHECK_SVG}
                      </button>
                    </Tooltip>
                    <span
                      className={`flex-1 min-w-0 text-sm truncate ${
                        goal.is_complete
                          ? "text-gray-400 line-through"
                          : "text-gray-800"
                      }`}
                    >
                      {goal.text}
                    </span>
                    <Tooltip
                      label={
                        goal.is_shared
                          ? "Shared with your PI. Click to make private."
                          : "Private. Click to share with your PI."
                      }
                      placement="top"
                    >
                      <button
                        type="button"
                        onClick={() => void handleToggleShared(goal)}
                        data-testid={`weekly-goal-share-${goal.id}`}
                        aria-pressed={goal.is_shared}
                        className={`inline-flex items-center justify-center w-6 h-6 rounded flex-shrink-0 transition-colors ${
                          goal.is_shared
                            ? "text-sky-600 hover:bg-sky-50"
                            : "text-gray-400 hover:bg-gray-100"
                        }`}
                      >
                        {goal.is_shared ? SHARED_SVG : LOCK_SVG}
                      </button>
                    </Tooltip>
                    <Tooltip label="Delete goal" placement="top">
                      <button
                        type="button"
                        onClick={() => void handleDelete(goal)}
                        data-testid={`weekly-goal-delete-${goal.id}`}
                        className="inline-flex items-center justify-center w-6 h-6 rounded flex-shrink-0 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        {TRASH_SVG}
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export const ExpandedView = WeeklyGoalsWidget;

export const HELP_TEXT =
  "Your lightweight weekly goals, the ones you set in your 1:1 meetings. Add a goal, mark it done, or delete it. Shared goals are visible to your PI. These are separate from your Gantt high-level goals.";

// ─────────────────────────────────────────────────────────────────────────────
// Tiles
// ─────────────────────────────────────────────────────────────────────────────

export function SnapshotTile(_props: SnapshotTileProps) {
  const { data: goals = [], isLoading } = useMyWeeklyGoals();
  const thisWeek = mondayOf();
  const thisWeekGoals = useMemo(
    () => goals.filter((g) => g.week_of === thisWeek),
    [goals, thisWeek],
  );
  const done = thisWeekGoals.filter((g) => g.is_complete).length;
  const total = thisWeekGoals.length;

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-emerald-500 flex-shrink-0">
          {TARGET_SVG}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Weekly goals
        </span>
      </div>
      <div className="mt-2 flex-1 min-h-0 flex flex-col justify-center">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : total === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">
            No goals this week
          </p>
        ) : (
          <>
            <div className="text-2xl font-bold tabular-nums text-gray-800">
              {done}
              <span className="text-base text-gray-400">/{total}</span>
            </div>
            <p className="text-xs text-gray-500">done this week</p>
          </>
        )}
      </div>
    </div>
  );
}

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { data: goals = [], isLoading } = useMyWeeklyGoals();
  const thisWeek = mondayOf();
  const thisWeekGoals = goals.filter((g) => g.week_of === thisWeek);
  const done = thisWeekGoals.filter((g) => g.is_complete).length;
  const total = thisWeekGoals.length;

  return (
    <SidebarStatTile
      icon={TARGET_SVG}
      iconClassName="text-emerald-500"
      label="Weekly goals"
      stat={isLoading ? "—" : `${done}/${total}`}
      sub={isLoading ? undefined : "done this week"}
      onClick={onClick}
    />
  );
}
