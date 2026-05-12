"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi, LabTask } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import type { Note, PurchaseItem } from "@/lib/types";

interface LabUserDetailPanelProps {
  username: string;
  onClose: () => void;
  onTaskClick: (task: LabTask) => void;
}

const RECENT_DAYS = 30;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  if (!iso) return "";
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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${color ?? "text-gray-900"}`}>{value}</p>
    </div>
  );
}

export default function LabUserDetailPanel({
  username,
  onClose,
  onTaskClick,
}: LabUserDetailPanelProps) {
  const { users, tasks, projects } = useLabData();
  const user = useMemo(
    () => users.find((u) => u.username === username),
    [users, username],
  );

  const today = startOfTodayISO();
  const windowStart = isoDaysAgo(RECENT_DAYS);

  // Close on ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["lab", "notes", username],
    queryFn: () => labApi.getUserNotes(username),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Share the panel-wide purchase-items cache; filter to this user in `select`
  // so we don't re-walk the filesystem.
  const { data: items = [] } = useQuery({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    select: (data: Array<PurchaseItem & { username: string }>) =>
      data.filter((i) => i.username === username),
  });

  const userTasks = useMemo(
    () => tasks.filter((t) => t.username === username),
    [tasks, username],
  );

  const projectNameFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(`${p.username}:${p.id}`, p.name);
    return (projectId: number) =>
      map.get(`${username}:${projectId}`) ?? "Unknown project";
  }, [projects, username]);

  const activeExperiments = useMemo(() => {
    return userTasks
      .filter((t) => t.task_type === "experiment")
      .filter((t) => !t.is_complete)
      .filter((t) => t.start_date && t.end_date)
      .filter((t) => t.start_date <= today && today <= t.end_date)
      .sort((a, b) => a.end_date.localeCompare(b.end_date));
  }, [userTasks, today]);

  const recentlyCompleted = useMemo(() => {
    return userTasks
      .filter((t) => t.task_type === "experiment" || t.task_type === "purchase")
      .filter((t) => t.is_complete)
      .filter((t) => t.end_date && t.end_date >= windowStart && t.end_date <= today)
      .sort((a, b) => b.end_date.localeCompare(a.end_date));
  }, [userTasks, today, windowStart]);

  const recentSharedNotes = useMemo(() => {
    return notes
      .filter((n) => n.is_shared)
      .filter((n) => {
        const stamp = n.updated_at || n.created_at;
        return stamp && stamp.slice(0, 10) >= windowStart;
      })
      .sort((a, b) =>
        (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
      );
  }, [notes, windowStart]);

  // If the user isn't in the cache yet (data still loading, or username
  // doesn't exist), bail. The page-level open-panel guard usually prevents
  // this, but we still want a safe fallback.
  if (!user) return null;

  // Stats
  const projectsCount = projects.filter((p) => p.username === username && !p.is_archived).length;
  const totalExperiments = userTasks.filter((t) => t.task_type === "experiment").length;
  const completedExperiments = userTasks.filter(
    (t) => t.task_type === "experiment" && t.is_complete,
  ).length;
  const completionPct =
    totalExperiments === 0 ? 0 : Math.round((completedExperiments / totalExperiments) * 100);
  const totalSpent = items.reduce((acc, i) => acc + (i.total_price ?? 0), 0);

  // Top funding accounts for this user (in-view spend).
  const topFunding = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of items) {
      const key = item.funding_string || "Uncategorized";
      totals.set(key, (totals.get(key) ?? 0) + (item.total_price ?? 0));
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [items]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-[60]"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-white shadow-2xl z-[70] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={`${username} dashboard`}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-semibold flex-shrink-0"
            style={{ backgroundColor: user.color }}
          >
            {username.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{username}</h2>
            <p className="text-xs text-gray-500">
              {user.created_at ? `Member since ${formatDate(user.created_at)}` : "Member"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 p-4 border-b border-gray-100">
          <Stat label="Active projects" value={String(projectsCount)} />
          <Stat label="Experiments" value={`${completedExperiments}/${totalExperiments}`} />
          <Stat label="Completion" value={`${completionPct}%`} color="text-emerald-700" />
          <Stat label="Total spent" value={`$${totalSpent.toFixed(2)}`} />
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Active experiments */}
          <Section title="Active experiments" subtitle="Running today" count={activeExperiments.length}>
            {activeExperiments.length === 0 ? (
              <EmptyRow>Nothing in flight.</EmptyRow>
            ) : (
              activeExperiments.map((t) => (
                <TaskRow
                  key={`act-${t.id}`}
                  task={t}
                  context={projectNameFor(t.project_id)}
                  dateLabel={`ends ${formatDate(t.end_date)}`}
                  onClick={() => onTaskClick(t)}
                />
              ))
            )}
          </Section>

          {/* Recently completed */}
          <Section
            title="Recently completed"
            subtitle={`Last ${RECENT_DAYS} days (by end date)`}
            count={recentlyCompleted.length}
          >
            {recentlyCompleted.length === 0 ? (
              <EmptyRow>Nothing completed in this window.</EmptyRow>
            ) : (
              recentlyCompleted.map((t) => (
                <TaskRow
                  key={`done-${t.id}`}
                  task={t}
                  context={projectNameFor(t.project_id)}
                  dateLabel={formatDate(t.end_date)}
                  onClick={() => onTaskClick(t)}
                />
              ))
            )}
          </Section>

          {/* Spend by funding */}
          {topFunding.length > 0 && (
            <Section title="Top funding accounts" subtitle="By total spend" count={topFunding.length}>
              {topFunding.map(([name, total]) => (
                <div key={name} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 text-sm text-gray-900 truncate">{name}</div>
                  <div className="text-sm font-medium text-gray-700">${total.toFixed(2)}</div>
                </div>
              ))}
            </Section>
          )}

          {/* Shared notes */}
          <Section
            title="Recent shared notes"
            subtitle={`Updated in the last ${RECENT_DAYS} days`}
            count={recentSharedNotes.length}
          >
            {recentSharedNotes.length === 0 ? (
              <EmptyRow>No recent shared notes.</EmptyRow>
            ) : (
              recentSharedNotes.map((n) => (
                <div key={n.id} className="px-4 py-2.5">
                  <p className="text-sm text-gray-900 truncate">{n.title || "(untitled)"}</p>
                  <p className="text-xs text-gray-500">
                    {n.is_running_log ? "Running log" : "Note"} ·{" "}
                    {formatDate((n.updated_at || n.created_at).slice(0, 10))}
                  </p>
                </div>
              ))
            )}
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-100">
      <div className="px-4 py-3 flex items-center justify-between bg-gray-50">
        <div>
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
          <p className="text-[11px] text-gray-500">{subtitle}</p>
        </div>
        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">
          {count}
        </span>
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-center text-sm text-gray-400">{children}</div>;
}

function TaskRow({
  task,
  context,
  dateLabel,
  onClick,
}: {
  task: LabTask;
  context: string;
  dateLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 truncate">{task.name}</p>
        <p className="text-xs text-gray-500 truncate">
          {task.task_type} · {context}
        </p>
      </div>
      <div className="text-xs text-gray-400 flex-shrink-0">{dateLabel}</div>
    </button>
  );
}
