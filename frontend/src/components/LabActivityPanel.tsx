"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi, LabTask, LabUser, LabProject } from "@/lib/local-api";
import type { Note } from "@/lib/types";

interface LabActivityPanelProps {
  tasks: LabTask[];
  users: LabUser[];
  projects: LabProject[];
  selectedUsernames: Set<string>;
  onTaskClick: (task: LabTask) => void;
  onUserClick?: (username: string) => void;
  onSwitchToNotes?: () => void;
}

const RECENT_WINDOW_DAYS = 30;

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatRelativeDay(iso: string): string {
  if (!iso) return "";
  const today = startOfTodayISO();
  if (iso === today) return "today";
  // ISO date math: parse as UTC midnight to avoid TZ drift.
  const a = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );
  const diffDays = Math.round((a - b) / (24 * 60 * 60 * 1000));
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "yesterday";
  if (diffDays > 0) return `in ${diffDays}d`;
  return `${Math.abs(diffDays)}d ago`;
}

function formatTimestamp(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function TypeChip({ type }: { type: string }) {
  const styles: Record<string, string> = {
    experiment: "bg-blue-50 text-blue-700",
    purchase: "bg-amber-50 text-amber-700",
    note: "bg-emerald-50 text-emerald-700",
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full ${
        styles[type] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {type}
    </span>
  );
}

interface RowProps {
  userColor: string;
  username: string;
  title: string;
  type: string;
  context: string;
  dateLabel: string;
  onClick?: () => void;
  onUserClick?: () => void;
}

function ActivityRow({ userColor, username, title, type, context, dateLabel, onClick, onUserClick }: RowProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 transition-colors ${
        onClick ? "hover:bg-gray-50 cursor-pointer" : ""
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          if (onUserClick) {
            e.stopPropagation();
            onUserClick();
          }
        }}
        disabled={!onUserClick}
        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0 hover:ring-2 hover:ring-emerald-300 disabled:hover:ring-0 transition-shadow"
        style={{ backgroundColor: userColor }}
        title={onUserClick ? `View ${username}'s dashboard` : username}
      >
        {username.charAt(0).toUpperCase()}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-gray-900 font-medium truncate">{title}</p>
          <TypeChip type={type} />
        </div>
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          <span className="font-medium text-gray-700">{username}</span>
          {context && (
            <>
              <span className="text-gray-300 mx-1.5">•</span>
              <span>{context}</span>
            </>
          )}
        </p>
      </div>
      <div className="text-xs text-gray-400 flex-shrink-0">{dateLabel}</div>
    </div>
  );
}

function SectionShell({
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

export default function LabActivityPanel({
  tasks,
  users,
  projects,
  selectedUsernames,
  onTaskClick,
  onUserClick,
  onSwitchToNotes,
}: LabActivityPanelProps) {
  // Shared notes only — matches what the Notes tab shows.
  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
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
    return (username: string, projectId: number) =>
      map.get(`${username}:${projectId}`) ?? "Unknown project";
  }, [projects]);

  const today = startOfTodayISO();
  const windowStart = isoDaysAgo(RECENT_WINDOW_DAYS);

  // #11 — Running now: in-flight experiments + purchases.
  // Note: tasks have no completed_at field, so we treat "running" as
  // start_date <= today <= end_date && !is_complete.
  const runningNow = useMemo(() => {
    return tasks
      .filter((t) => selectedUsernames.has(t.username))
      .filter((t) => t.task_type === "experiment" || t.task_type === "purchase")
      .filter((t) => !t.is_complete)
      .filter((t) => t.start_date && t.end_date)
      .filter((t) => t.start_date <= today && today <= t.end_date)
      .sort((a, b) => a.end_date.localeCompare(b.end_date));
  }, [tasks, selectedUsernames, today]);

  // #8 — Recently completed (last 30d). end_date is a proxy for completion
  // since Task has no completed_at; this can mislabel late-completed tasks.
  const recentlyCompleted = useMemo(() => {
    return tasks
      .filter((t) => selectedUsernames.has(t.username))
      .filter((t) => t.task_type === "experiment" || t.task_type === "purchase")
      .filter((t) => t.is_complete)
      .filter((t) => t.end_date && t.end_date >= windowStart && t.end_date <= today)
      .sort((a, b) => b.end_date.localeCompare(a.end_date));
  }, [tasks, selectedUsernames, today, windowStart]);

  // Recent shared notes — updated in the last 30d.
  const recentNotes = useMemo(() => {
    return notes
      .filter((n) => selectedUsernames.has(n.username))
      .filter((n) => {
        const stamp = n.updated_at || n.created_at;
        if (!stamp) return false;
        const iso = stamp.slice(0, 10);
        return iso >= windowStart;
      })
      .sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
  }, [notes, selectedUsernames, windowStart]);

  const nothingSelected = selectedUsernames.size === 0;

  return (
    <div className="space-y-6">
      {nothingSelected && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          No users selected. Open the user filter (bottom-right) to choose who to view.
        </div>
      )}

      <SectionShell
        title="Running now"
        subtitle="Experiments and purchases currently in flight"
        count={runningNow.length}
      >
        {runningNow.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Nothing in flight for selected users.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {runningNow.map((task) => (
              <ActivityRow
                key={`run-${task.username}-${task.id}`}
                userColor={userColorFor(task.username)}
                username={task.username}
                title={task.name}
                type={task.task_type}
                context={projectNameFor(task.username, task.project_id)}
                dateLabel={`ends ${formatRelativeDay(task.end_date)}`}
                onClick={() => onTaskClick(task)}
                onUserClick={onUserClick ? () => onUserClick(task.username) : undefined}
              />
            ))}
          </div>
        )}
      </SectionShell>

      <SectionShell
        title="Recently completed"
        subtitle={`Finished in the last ${RECENT_WINDOW_DAYS} days`}
        count={recentlyCompleted.length}
      >
        {recentlyCompleted.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Nothing completed in this window.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentlyCompleted.map((task) => (
              <ActivityRow
                key={`done-${task.username}-${task.id}`}
                userColor={userColorFor(task.username)}
                username={task.username}
                title={task.name}
                type={task.task_type}
                context={projectNameFor(task.username, task.project_id)}
                dateLabel={formatRelativeDay(task.end_date)}
                onClick={() => onTaskClick(task)}
                onUserClick={onUserClick ? () => onUserClick(task.username) : undefined}
              />
            ))}
          </div>
        )}
      </SectionShell>

      <SectionShell
        title="Recent shared notes"
        subtitle={`Updated in the last ${RECENT_WINDOW_DAYS} days`}
        count={recentNotes.length}
      >
        {recentNotes.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            No recently updated shared notes.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentNotes.map((note) => (
              <ActivityRow
                key={`note-${note.username}-${note.id}`}
                userColor={userColorFor(note.username)}
                username={note.username}
                title={note.title || "(untitled)"}
                type="note"
                context={note.is_running_log ? "Running log" : "Note"}
                dateLabel={formatTimestamp(note.updated_at || note.created_at)}
                onClick={onSwitchToNotes}
                onUserClick={onUserClick ? () => onUserClick(note.username) : undefined}
              />
            ))}
          </div>
        )}
      </SectionShell>
    </div>
  );
}
