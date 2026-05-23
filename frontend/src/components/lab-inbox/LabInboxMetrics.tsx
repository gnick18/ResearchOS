"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi, LabTask, LabGoal } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import LabGanttChart from "@/components/LabGanttChart";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import UserAvatar from "@/components/UserAvatar";
import type { Task } from "@/lib/types";

/**
 * Cross-lab metrics dashboard mounted inside the Lab Inbox (Lab Head Phase 4,
 * 2026-05-23 — lab head Phase 4 manager).
 *
 * Three aggregate views the PI uses to oversee the lab at a glance, each
 * tinted / attributed by owner so Mira can see who is doing what without
 * leaving her own surface:
 *
 *   1. **Gantt overlay** — reuses `LabGanttChart` with every lab member
 *      selected. The chart already tints each task bar by owner color and
 *      stamps the first-letter badge, so the existing rendering primitives
 *      give us a cross-member overlay for free.
 *   2. **Funding rollup** — totals from `labApi.getAllPurchaseItems()`
 *      grouped by member, by category, by funding account. A small recent
 *      purchases table sits below the rollup cards so the PI can see what
 *      just landed without leaving the page.
 *   3. **Roadmap aggregation** — `labApi.getGoals()` flattened into a
 *      single list with owner attribution and SMART-sub-goal progress,
 *      reusing the same `smart_goals` shape `LabRoadmapsPanel` walks.
 *
 * Phase 4 explicitly reads existing data shapes only — no new sidecars, no
 * new fields. If a future phase needs to cache an aggregate, that's a
 * separate change (see `feedback_flag_data_shape_in_advance.md`).
 *
 * Visibility: the parent (`/lab-inbox/page.tsx`) already gates on
 * `account_type === "lab_head"`, so this component assumes it's only
 * mounted for the PI.
 */

type MetricsTab = "gantt" | "funding" | "roadmap";

const TABS: Array<{ id: MetricsTab; label: string; description: string }> = [
  {
    id: "gantt",
    label: "Gantt overlay",
    description: "All lab members' tasks on one chart, colored by owner.",
  },
  {
    id: "funding",
    label: "Funding rollup",
    description: "Lab-wide spend totals by member, category, and funding account.",
  },
  {
    id: "roadmap",
    label: "Roadmap",
    description: "All high-level goals across the lab with progress.",
  },
];

export default function LabInboxMetrics() {
  const [activeTab, setActiveTab] = useState<MetricsTab>("gantt");

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 pt-5 pb-3 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">Lab metrics</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Cross-lab aggregates of tasks, spending, and goals. Read-only.
        </p>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 px-4 pt-3 border-b border-gray-200 bg-gray-50">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm rounded-t-lg transition-colors ${
                isActive
                  ? "bg-white text-emerald-700 border border-gray-200 border-b-white -mb-px font-medium"
                  : "text-gray-500 hover:text-gray-900 hover:bg-white/60"
              }`}
              title={tab.description}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="p-4 bg-white">
        {activeTab === "gantt" && <GanttOverlay />}
        {activeTab === "funding" && <FundingRollup />}
        {activeTab === "roadmap" && <RoadmapAggregation />}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gantt overlay
// ─────────────────────────────────────────────────────────────────────────────

function GanttOverlay() {
  const { users, isLoading, errorMessage } = useLabData();
  const [selectedTask, setSelectedTask] = useState<LabTask | null>(null);

  // The PI sees every member on the overlay by default. `LabGanttChart`
  // already filters its `tasks` by this set, tints by owner, and draws the
  // legend at the bottom — we just hand it the full membership.
  const allUsernames = useMemo(
    () => new Set(users.map((u) => u.username)),
    [users],
  );

  if (isLoading) {
    return (
      <div className="text-center py-12 text-sm text-gray-400">
        Loading lab data…
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
        {errorMessage}
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-gray-400">
        No lab members yet. The overlay populates once members are added.
      </div>
    );
  }

  return (
    <div>
      <LabGanttChart
        selectedUsernames={allUsernames}
        onTaskClick={setSelectedTask}
      />
      {selectedTask && (
        <TaskDetailPopup
          task={labTaskToTask(selectedTask)}
          onClose={() => setSelectedTask(null)}
          readOnly={true}
          username={selectedTask.username}
        />
      )}
    </div>
  );
}

// Mirror of the helper in `lab/page.tsx`. Kept local to avoid leaking the
// LabTask -> Task adapter into a new shared module just for Phase 4.
function labTaskToTask(labTask: LabTask): Task {
  return {
    id: labTask.id,
    project_id: labTask.project_id,
    name: labTask.name,
    start_date: labTask.start_date,
    duration_days: labTask.duration_days,
    end_date: labTask.end_date,
    is_high_level: false,
    is_complete: labTask.is_complete,
    task_type: labTask.task_type as "experiment" | "purchase" | "list",
    weekend_override: null,
    method_ids: labTask.method_ids || [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: labTask.experiment_color,
    sub_tasks: null,
    method_attachments: (labTask.method_ids || []).map((methodId) => ({
      method_id: methodId,
      owner: null,
      pcr_gradient: null,
      pcr_ingredients: null,
      lc_gradient: null,
      body_override: null,
      plate_annotation: null,
      cell_culture_schedule: null,
      variation_notes: null,
      compound_snapshots: null,
      qpcr_analysis: null,
    })),
    owner: labTask.username,
    shared_with: [],
    inherited_from_project: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Funding rollup
// ─────────────────────────────────────────────────────────────────────────────

const UNCATEGORIZED_LABEL = "Uncategorized";

function FundingRollup() {
  const { users, tasks } = useLabData();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Lookup tables keyed by "<username>:<taskId>" so each item can resolve
  // its parent purchase task (for the recent-purchases panel).
  const taskLookup = useMemo(() => {
    const map = new Map<string, LabTask>();
    for (const t of tasks) {
      if (t.task_type === "purchase") map.set(`${t.username}:${t.id}`, t);
    }
    return map;
  }, [tasks]);

  const userColorFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) map.set(u.username, u.color);
    return (username: string) => map.get(username) ?? "#6b7280";
  }, [users]);

  // Total spend across the entire lab.
  const totalSpent = useMemo(
    () => items.reduce((acc, item) => acc + (item.total_price ?? 0), 0),
    [items],
  );

  // Spend by member, sorted highest first.
  const spendByMember = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of items) {
      totals.set(item.username, (totals.get(item.username) ?? 0) + (item.total_price ?? 0));
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // Spend by category. `category` is optional on each item, so missing /
  // null falls into a single "Uncategorized" bucket.
  const spendByCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of items) {
      const key = item.category ?? UNCATEGORIZED_LABEL;
      totals.set(key, (totals.get(key) ?? 0) + (item.total_price ?? 0));
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // Spend by funding account. `funding_string` is the canonical account key
  // on each item; null falls into Uncategorized so the PI sees the
  // attribution gap.
  const spendByFunding = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of items) {
      const key = item.funding_string ?? UNCATEGORIZED_LABEL;
      totals.set(key, (totals.get(key) ?? 0) + (item.total_price ?? 0));
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // Recent purchases — 10 most recent line items by parent-task start_date.
  // Items don't carry their own date, so we attribute by the purchase task's
  // start_date (the same convention `LabPurchasesPanel.spentByMonth` uses).
  const recentItems = useMemo(() => {
    const enriched = items
      .map((item) => {
        const task = taskLookup.get(`${item.username}:${item.task_id}`);
        return {
          ...item,
          date: task?.start_date ?? "",
          taskName: task?.name ?? "",
        };
      })
      .filter((e) => e.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    return enriched.slice(0, 10);
  }, [items, taskLookup]);

  // Per-member max for the inline bar chart. Avoids 0/0 NaN when nothing
  // has been spent yet.
  const maxMemberSpend = useMemo(
    () => Math.max(0, ...spendByMember.map(([, v]) => v)),
    [spendByMember],
  );

  if (isLoading) {
    return (
      <div className="text-center py-12 text-sm text-gray-400">
        Loading purchases…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-sm text-gray-500 mb-1">No purchases yet.</p>
        <p className="text-xs text-gray-400">
          Once lab members log purchase items, totals appear here aggregated by
          member, category, and funding account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top-line summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total spent" value={formatCurrency(totalSpent)} />
        <SummaryCard label="Line items" value={items.length.toString()} />
        <SummaryCard label="Members spending" value={spendByMember.length.toString()} />
        <SummaryCard label="Funding accounts touched" value={spendByFunding.length.toString()} />
      </div>

      {/* Spend by member — bar chart row */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-900">Spend by member</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {spendByMember.map(([username, total]) => {
            const pct = maxMemberSpend > 0 ? (total / maxMemberSpend) * 100 : 0;
            const color = userColorFor(username);
            return (
              <div key={username} className="px-4 py-3 flex items-center gap-3">
                <UserAvatar username={username} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">
                      {username}
                    </span>
                    <span className="text-sm tabular-nums text-gray-700">
                      {formatCurrency(total)}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Spend by category + funding account — side-by-side tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownTable
          title="By category"
          rows={spendByCategory}
          total={totalSpent}
        />
        <BreakdownTable
          title="By funding account"
          rows={spendByFunding}
          total={totalSpent}
        />
      </div>

      {/* Recent purchases */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-900">Recent purchases</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            10 most recent line items by purchase-task date.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white border-b border-gray-200">
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Member</th>
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {recentItems.map((entry) => (
              <tr key={`${entry.username}:${entry.id}`} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-xs text-gray-500 tabular-nums">
                  {entry.date}
                </td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: userColorFor(entry.username) }}
                    />
                    <span className="text-gray-900">{entry.username}</span>
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-700 truncate max-w-[260px]" title={entry.item_name}>
                  {entry.item_name}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {formatCurrency(entry.total_price ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900 mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  total,
}: {
  title: string;
  rows: Array<[string, number]>;
  total: number;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <ul className="divide-y divide-gray-100">
        {rows.map(([label, amount]) => {
          const pct = total > 0 ? (amount / total) * 100 : 0;
          return (
            <li key={label} className="px-4 py-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 truncate" title={label}>
                  {label}
                </span>
                <span className="text-gray-900 tabular-nums font-medium ml-2 flex-shrink-0">
                  {formatCurrency(amount)}
                </span>
              </div>
              <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
                {pct.toFixed(1)}% of total
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─────────────────────────────────────────────────────────────────────────────
// Roadmap aggregation
// ─────────────────────────────────────────────────────────────────────────────

function RoadmapAggregation() {
  const { users, projects } = useLabData();

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

  const projectNameFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(`${p.username}:${p.id}`, p.name);
    return (username: string, projectId: number | null) =>
      projectId === null
        ? "Unknown project"
        : map.get(`${username}:${projectId}`) ?? "Unknown project";
  }, [projects]);

  // Single flat list sorted by end_date ascending (soonest deadline first),
  // with completed goals demoted to the bottom so the PI sees "what's
  // outstanding" by default. Personal goals (project_id === null) are
  // already filtered out by `labApi.getGoals()`.
  const sortedGoals = useMemo(() => {
    const today = startOfTodayISO();
    return [...goals].sort((a, b) => {
      if (a.is_complete !== b.is_complete) return a.is_complete ? 1 : -1;
      const aOverdue = !a.is_complete && a.end_date && a.end_date < today;
      const bOverdue = !b.is_complete && b.end_date && b.end_date < today;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      return (a.end_date || "").localeCompare(b.end_date || "");
    });
  }, [goals]);

  // High-level rollup counts so the PI sees lab-wide progress at a glance.
  const summary = useMemo(() => {
    const today = startOfTodayISO();
    let complete = 0;
    let overdue = 0;
    let inProgress = 0;
    let upcoming = 0;
    for (const g of goals) {
      if (g.is_complete) {
        complete++;
      } else if (g.end_date && g.end_date < today) {
        overdue++;
      } else if (g.start_date && g.start_date > today) {
        upcoming++;
      } else {
        inProgress++;
      }
    }
    return { total: goals.length, complete, overdue, inProgress, upcoming };
  }, [goals]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-sm text-gray-400">
        Loading goals…
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-sm text-gray-500 mb-1">No goals to show.</p>
        <p className="text-xs text-gray-400">
          Lab members&apos; high-level goals appear here once they&apos;re
          created. Members can opt out of lab visibility from their home page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Total goals" value={summary.total.toString()} />
        <SummaryCard label="In progress" value={summary.inProgress.toString()} />
        <SummaryCard label="Upcoming" value={summary.upcoming.toString()} />
        <SummaryCard label="Overdue" value={summary.overdue.toString()} />
        <SummaryCard label="Complete" value={summary.complete.toString()} />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-900">All goals</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Outstanding first (overdue, then by deadline), then completed.
          </p>
        </div>
        <ul className="divide-y divide-gray-100">
          {sortedGoals.map((goal) => {
            const progress = smartGoalProgress(goal);
            const status = timelineStatus(goal);
            const color = goal.color || userColorFor(goal.username);
            return (
              <li
                key={`${goal.username}:${goal.id}`}
                className="px-4 py-3 flex items-start gap-3"
              >
                <UserAvatar username={goal.username} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">
                      {goal.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
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
                    {goal.username} · {projectNameFor(goal.username, goal.project_id)} ·{" "}
                    {goal.end_date || "no deadline"}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${progress.pct}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0 tabular-nums">
                      {progress.total === 0
                        ? goal.is_complete
                          ? "Done"
                          : "No sub-goals"
                        : `${progress.done}/${progress.total}`}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function smartGoalProgress(goal: LabGoal): { total: number; done: number; pct: number } {
  const total = goal.smart_goals.length;
  const done = goal.smart_goals.filter((s) => s.is_complete).length;
  const pct = total === 0 ? (goal.is_complete ? 100 : 0) : Math.round((done / total) * 100);
  return { total, done, pct };
}

function timelineStatus(goal: LabGoal): {
  label: string;
  tone: "ok" | "soon" | "past" | "future" | "done";
} {
  const today = startOfTodayISO();
  if (goal.is_complete) return { label: "Complete", tone: "done" };
  if (goal.end_date && goal.end_date < today) return { label: "Past due", tone: "past" };
  if (goal.start_date && goal.start_date > today) return { label: "Upcoming", tone: "future" };
  return { label: "In progress", tone: "ok" };
}

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
