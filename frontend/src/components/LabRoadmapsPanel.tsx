"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi, LabGoal } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import UserAvatar from "@/components/UserAvatar";
import Tooltip from "@/components/Tooltip";

interface LabRoadmapsPanelProps {
  selectedUsernames: Set<string>;
  onUserClick?: (username: string) => void;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

interface GoalProgress {
  total: number;
  done: number;
  pct: number; // 0-100
}

function smartGoalProgress(goal: LabGoal): GoalProgress {
  const total = goal.smart_goals.length;
  const done = goal.smart_goals.filter((s) => s.is_complete).length;
  const pct = total === 0 ? (goal.is_complete ? 100 : 0) : Math.round((done / total) * 100);
  return { total, done, pct };
}

function timelineStatus(goal: LabGoal, today: string): {
  label: string;
  tone: "ok" | "soon" | "past" | "future" | "done";
} {
  if (goal.is_complete) return { label: "Complete", tone: "done" };
  if (goal.end_date && goal.end_date < today) return { label: "Past due", tone: "past" };
  if (goal.start_date && goal.start_date > today) return { label: "Upcoming", tone: "future" };
  return { label: "In progress", tone: "ok" };
}

export default function LabRoadmapsPanel({
  selectedUsernames,
  onUserClick,
}: LabRoadmapsPanelProps) {
  const { users, projects } = useLabData();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: goals = [], isLoading } = useQuery<LabGoal[]>({
    queryKey: ["lab", "goals"],
    queryFn: () => labApi.getGoals(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const userColorFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) map.set(u.username, u.color);
    return (username: string) => map.get(username) ?? "#6b7280";
  }, [users]);

  // Personal goals (project_id === null) are filtered out by labApi.getGoals
  // before they ever reach lab mode, so we don't need to handle that case.
  const projectNameFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(`${p.username}:${p.id}`, p.name);
    return (username: string, projectId: number | null) =>
      projectId === null
        ? "Unknown project"
        : map.get(`${username}:${projectId}`) ?? "Unknown project";
  }, [projects]);

  // Group goals by username, sorted by start_date asc within each user.
  // Skip users not in the current filter.
  const byUser = useMemo(() => {
    const map = new Map<string, LabGoal[]>();
    for (const g of goals) {
      if (!selectedUsernames.has(g.username)) continue;
      const bucket = map.get(g.username) ?? [];
      bucket.push(g);
      map.set(g.username, bucket);
    }
    for (const [user, bucket] of map) {
      bucket.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
      map.set(user, bucket);
    }
    return map;
  }, [goals, selectedUsernames]);

  // Only render users that we actually have data for, sorted alphabetically.
  const usersWithGoals = useMemo(() => Array.from(byUser.keys()).sort(), [byUser]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const today = startOfTodayISO();

  if (isLoading) {
    return <div className="text-center py-12 text-sm text-gray-400">Loading roadmaps…</div>;
  }

  if (goals.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-gray-500 text-sm mb-2">No goals to show.</p>
        <p className="text-xs text-gray-400">
          Roadmaps appear here once lab members create high-level goals.
          Users can opt out of lab visibility from their home page.
        </p>
      </div>
    );
  }

  if (usersWithGoals.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        Selected users haven&apos;t shared any goals (or have opted out).
      </div>
    );
  }

  // Lab Mode fix manager R1 (2026-05-22): track the FIRST tracker
  // button rendered across every (user, goal) tuple so the
  // lab-mode-roadmaps cursor demo can click it deterministically.
  // Render-scoped flag, reset on every render.
  let firstTrackerStamped = false;

  return (
    <div className="space-y-6">
      {usersWithGoals.map((username) => {
        const userGoals = byUser.get(username) || [];
        const userColor = userColorFor(username);
        return (
          <div
            key={username}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            {/* User header */}
            <div className="p-4 border-b border-gray-200 flex items-center gap-3 bg-gray-50">
              <Tooltip
                label={onUserClick ? `View ${username}'s dashboard` : username}
                placement="bottom"
              >
                <button
                  type="button"
                  onClick={() => onUserClick?.(username)}
                  disabled={!onUserClick}
                  aria-label={onUserClick ? `View ${username}'s dashboard` : username}
                  className="rounded-full hover:ring-2 hover:ring-emerald-300 disabled:hover:ring-0 transition-shadow"
                >
                  <UserAvatar username={username} size="md" />
                </button>
              </Tooltip>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900">{username}</h3>
                <p className="text-xs text-gray-500">
                  {userGoals.length} goal{userGoals.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {/* Goals list */}
            <div className="divide-y divide-gray-100">
              {userGoals.map((goal) => {
                const key = `${username}:${goal.id}`;
                const isOpen = expanded.has(key);
                const progress = smartGoalProgress(goal);
                const status = timelineStatus(goal, today);
                const stampFirstTracker = !firstTrackerStamped;
                if (stampFirstTracker) firstTrackerStamped = true;
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(key)}
                      data-tour-target={
                        stampFirstTracker
                          ? "lab-mode-roadmaps-first-tracker"
                          : undefined
                      }
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0 mt-2"
                          style={{ backgroundColor: goal.color || userColor }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-gray-900">{goal.name}</p>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                status.tone === "done"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : status.tone === "past"
                                  ? "bg-red-50 text-red-700"
                                  : status.tone === "future"
                                  ? "bg-gray-100 text-gray-600"
                                  : "bg-blue-50 text-blue-700"
                              }`}
                            >
                              {status.label}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {projectNameFor(username, goal.project_id)} ·{" "}
                            {goal.start_date ? formatDate(goal.start_date) : "no start"} →{" "}
                            {goal.end_date ? formatDate(goal.end_date) : "no end"}
                          </p>
                          {/* Progress bar */}
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${progress.pct}%`,
                                  backgroundColor: goal.color || userColor,
                                }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 flex-shrink-0">
                              {progress.total === 0
                                ? goal.is_complete
                                  ? "Done"
                                  : "No sub-goals"
                                : `${progress.done}/${progress.total}`}
                            </span>
                          </div>
                        </div>
                        <svg
                          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>

                    {isOpen && goal.smart_goals.length > 0 && (
                      <div className="px-4 pb-3 pl-11">
                        <ul className="space-y-1">
                          {goal.smart_goals.map((sg) => (
                            <li key={sg.id} className="flex items-start gap-2 text-sm">
                              <span
                                className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded ${
                                  sg.is_complete
                                    ? "bg-emerald-500 text-white"
                                    : "border border-gray-300"
                                }`}
                                aria-hidden
                              >
                                {sg.is_complete && (
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </span>
                              <span className={sg.is_complete ? "text-gray-400 line-through" : "text-gray-700"}>
                                {sg.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {isOpen && goal.smart_goals.length === 0 && (
                      <div className="px-4 pb-3 pl-11 text-xs text-gray-400">
                        No sub-goals defined.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
