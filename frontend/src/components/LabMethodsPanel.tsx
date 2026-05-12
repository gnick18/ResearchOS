"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi, LabTask, LabMethod } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";

interface LabMethodsPanelProps {
  selectedUsernames: Set<string>;
  onTaskClick: (task: LabTask) => void;
  onUserClick?: (username: string) => void;
}

type SortKey = "usage" | "lastUsed" | "name";

const UNUSED_WINDOW_DAYS = 90;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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

interface MethodRow {
  method: LabMethod;
  taskCount: number;
  users: Set<string>;
  lastUsed: string | null; // ISO date, max start_date of tasks using this method
  tasks: LabTask[];
}

export default function LabMethodsPanel({
  selectedUsernames,
  onTaskClick,
  onUserClick,
}: LabMethodsPanelProps) {
  const { users, tasks, projects } = useLabData();
  const { data: methods = [], isLoading } = useQuery<LabMethod[]>({
    queryKey: ["lab", "methods"],
    queryFn: () => labApi.getMethods(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("usage");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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

  // Build per-method rollup from tasks the current user-filter says to include.
  const rows: MethodRow[] = useMemo(() => {
    const visibleTasks = tasks.filter((t) => selectedUsernames.has(t.username));
    const byMethod = new Map<number, MethodRow>();
    for (const m of methods) {
      byMethod.set(m.id, {
        method: m,
        taskCount: 0,
        users: new Set<string>(),
        lastUsed: null,
        tasks: [],
      });
    }
    for (const t of visibleTasks) {
      for (const mid of t.method_ids || []) {
        const row = byMethod.get(mid);
        if (!row) continue;
        row.taskCount += 1;
        row.users.add(t.username);
        row.tasks.push(t);
        if (t.start_date && (!row.lastUsed || t.start_date > row.lastUsed)) {
          row.lastUsed = t.start_date;
        }
      }
    }
    return Array.from(byMethod.values());
  }, [methods, tasks, selectedUsernames]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = rows;
    if (q) r = r.filter((row) => row.method.name.toLowerCase().includes(q));
    return r;
  }, [rows, query]);

  const sorted = useMemo(() => {
    const r = [...filtered];
    if (sortKey === "usage") {
      r.sort((a, b) => b.taskCount - a.taskCount || a.method.name.localeCompare(b.method.name));
    } else if (sortKey === "lastUsed") {
      r.sort((a, b) => {
        if (a.lastUsed && b.lastUsed) return b.lastUsed.localeCompare(a.lastUsed);
        if (a.lastUsed) return -1;
        if (b.lastUsed) return 1;
        return a.method.name.localeCompare(b.method.name);
      });
    } else {
      r.sort((a, b) => a.method.name.localeCompare(b.method.name));
    }
    return r;
  }, [filtered, sortKey]);

  // Split used vs unused based on UNUSED_WINDOW_DAYS.
  const cutoff = isoDaysAgo(UNUSED_WINDOW_DAYS);
  const used = sorted.filter((r) => r.lastUsed && r.lastUsed >= cutoff);
  const unused = sorted.filter((r) => !r.lastUsed || r.lastUsed < cutoff);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 text-sm text-gray-400">Loading methods...</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search + sort */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search methods by name…"
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <div className="inline-flex rounded-lg border border-gray-200 p-1 self-start md:self-auto">
          {(["usage", "lastUsed", "name"] as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setSortKey(key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                sortKey === key ? "bg-emerald-100 text-emerald-700" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {key === "usage" ? "Sort: Most used" : key === "lastUsed" ? "Sort: Recent" : "Sort: A–Z"}
            </button>
          ))}
        </div>
      </div>

      {/* Active methods */}
      <Section
        title="Methods in use"
        subtitle={`Used in the last ${UNUSED_WINDOW_DAYS} days`}
        count={used.length}
      >
        {used.length === 0 ? (
          <EmptyRow>No matching methods used recently.</EmptyRow>
        ) : (
          used.map((row) => (
            <MethodRowView
              key={`u-${row.method.id}`}
              row={row}
              expanded={expanded.has(row.method.id)}
              onToggle={() => toggleExpand(row.method.id)}
              userColorFor={userColorFor}
              projectNameFor={projectNameFor}
              onTaskClick={onTaskClick}
              onUserClick={onUserClick}
            />
          ))
        )}
      </Section>

      {/* Unused methods */}
      <Section
        title="Unused"
        subtitle={`Never used or last used more than ${UNUSED_WINDOW_DAYS} days ago`}
        count={unused.length}
      >
        {unused.length === 0 ? (
          <EmptyRow>None.</EmptyRow>
        ) : (
          unused.map((row) => (
            <MethodRowView
              key={`x-${row.method.id}`}
              row={row}
              expanded={expanded.has(row.method.id)}
              onToggle={() => toggleExpand(row.method.id)}
              userColorFor={userColorFor}
              projectNameFor={projectNameFor}
              onTaskClick={onTaskClick}
              onUserClick={onUserClick}
              dimmed
            />
          ))
        )}
      </Section>
    </div>
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{count}</span>
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-gray-400">{children}</div>;
}

function MethodRowView({
  row,
  expanded,
  onToggle,
  userColorFor,
  projectNameFor,
  onTaskClick,
  onUserClick,
  dimmed = false,
}: {
  row: MethodRow;
  expanded: boolean;
  onToggle: () => void;
  userColorFor: (username: string) => string;
  projectNameFor: (username: string, projectId: number) => string;
  onTaskClick: (task: LabTask) => void;
  onUserClick?: (username: string) => void;
  dimmed?: boolean;
}) {
  const { method, taskCount, users, lastUsed, tasks } = row;
  const sortedUsers = Array.from(users).sort();

  return (
    <div className={dimmed ? "opacity-70" : ""}>
      {/* Row is a div, not a button — it contains the per-user avatar
          buttons inside the cluster, and nested <button>s are invalid
          HTML (hydration error). Keyboard a11y is handled via role +
          tabIndex + onKeyDown for Enter/Space. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3 cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900 truncate">{method.name}</p>
            {method.is_public ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                public
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">
                {method.username}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {taskCount === 0
              ? "Not used by anyone in view"
              : `${taskCount} use${taskCount === 1 ? "" : "s"} across ${sortedUsers.length} user${sortedUsers.length === 1 ? "" : "s"}`}
            {lastUsed ? ` · last used ${formatDate(lastUsed)}` : ""}
          </p>
        </div>

        {/* User-color avatar cluster */}
        <div className="flex -space-x-1 flex-shrink-0">
          {sortedUsers.slice(0, 4).map((u) => (
            <button
              key={u}
              type="button"
              onClick={(e) => {
                if (onUserClick) {
                  e.stopPropagation();
                  onUserClick(u);
                }
              }}
              className="w-6 h-6 rounded-full ring-2 ring-white flex items-center justify-center text-white text-[10px] font-medium hover:ring-emerald-300 transition-shadow"
              style={{ backgroundColor: userColorFor(u) }}
              title={onUserClick ? `View ${u}'s dashboard` : u}
            >
              {u.charAt(0).toUpperCase()}
            </button>
          ))}
          {sortedUsers.length > 4 && (
            <div className="w-6 h-6 rounded-full ring-2 ring-white bg-gray-200 flex items-center justify-center text-[10px] text-gray-600 font-medium">
              +{sortedUsers.length - 4}
            </div>
          )}
        </div>

        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {expanded && (
        <div className="px-4 pb-3 -mt-1">
          {tasks.length === 0 ? (
            <div className="text-xs text-gray-400 py-2">No experiments use this method in view.</div>
          ) : (
            <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
              {[...tasks]
                .sort((a, b) => b.start_date.localeCompare(a.start_date))
                .map((task) => (
                  <button
                    key={`${task.username}-${task.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTaskClick(task);
                    }}
                    className="w-full text-left flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: userColorFor(task.username) }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{task.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {task.username} · {projectNameFor(task.username, task.project_id)} ·{" "}
                        {formatDate(task.start_date)}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        task.is_complete
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {task.is_complete ? "complete" : "in progress"}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
