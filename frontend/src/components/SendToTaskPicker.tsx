"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAllTasksIncludingShared,
  fetchAllProjectsIncludingShared,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Project, Task } from "@/lib/types";
import { taskKey } from "@/lib/types";

/**
 * Modal that asks the user which task to file a batch of selected inbox
 * items into. Pattern mirrors `ImportExperimentDialog`: a small centered
 * card with a search input on top and a list below.
 *
 * The default "recent" view shows the 8 most-recently-started experiment
 * tasks (sorted by `start_date` desc), which matches the existing recency
 * sort used elsewhere in the app and is the same field the GANTT keys on.
 * Once the user starts typing in the search box, the list filters by
 * task-name substring (case-insensitive) and also matches against the
 * project name so a user can type "crystal" to find tasks in the "Crystal
 * growth" project.
 *
 * Selection is confirm-on-click: clicking a task row immediately invokes
 * `onPick(task)` and the parent closes the modal. There's no separate
 * Confirm button — the action is reversible (the user can pull the photos
 * back out of the task's Images folder if they file to the wrong place),
 * and the extra click would just slow the batch-file flow that motivated
 * this picker in the first place.
 */

interface SendToTaskPickerProps {
  isOpen: boolean;
  selectedCount: number;
  onClose: () => void;
  onPick: (task: Pick<Task, "id" | "owner" | "name">) => void;
}

const RECENT_LIMIT = 8;

export default function SendToTaskPicker({
  isOpen,
  selectedCount,
  onClose,
  onPick,
}: SendToTaskPickerProps) {
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Reuse the same query key the GANTT uses so React Query hands us its
  // already-populated cache rather than spinning up a duplicate read pass.
  const { data: allTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["tasks", "with-shared", currentUser],
    queryFn: fetchAllTasksIncludingShared,
    enabled: isOpen,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
    enabled: isOpen,
  });

  // Reset the search + expansion state every time the modal opens so the
  // user lands on the "recent" view by default.
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setShowAll(false);
  }, [isOpen]);

  // Esc-to-close.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const projectsByCompositeKey = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) map.set(`${p.owner}:${p.id}`, p);
    return map;
  }, [projects]);

  // Only experiment-typed tasks make sense as a destination here: Lab Notes
  // (which is where these files end up) is hidden on simple and purchase
  // tasks. Drop list-style and purchase tasks from the picker entirely.
  const candidateTasks = useMemo(
    () => allTasks.filter((t) => t.task_type === "experiment"),
    [allTasks],
  );

  const trimmed = query.trim().toLowerCase();
  const matchesQuery = (t: Task): boolean => {
    if (!trimmed) return true;
    if (t.name.toLowerCase().includes(trimmed)) return true;
    const proj = projectsByCompositeKey.get(`${t.owner}:${t.project_id}`);
    if (proj && proj.name.toLowerCase().includes(trimmed)) return true;
    return false;
  };

  const sortedByRecent = useMemo(() => {
    return [...candidateTasks].sort((a, b) => {
      // start_date is a YYYY-MM-DD string; lexical compare is correct.
      if (a.start_date === b.start_date) return b.id - a.id;
      return a.start_date < b.start_date ? 1 : -1;
    });
  }, [candidateTasks]);

  const filtered = useMemo(
    () => sortedByRecent.filter(matchesQuery),
    // matchesQuery references trimmed + projectsByCompositeKey but it's
    // recomputed each render — dep array uses the underlying inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedByRecent, trimmed, projectsByCompositeKey],
  );

  const visible = trimmed || showAll ? filtered : filtered.slice(0, RECENT_LIMIT);
  const hasMore = !trimmed && !showAll && filtered.length > RECENT_LIMIT;

  if (!isOpen) return null;

  const headerLabel =
    selectedCount === 1 ? "Send to task" : `Send ${selectedCount} items to task`;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="send-to-task-picker"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{headerLabel}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Files land in the task&apos;s Lab Notes folder.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none p-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks…"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {tasksLoading ? (
            <p className="text-sm text-gray-500 text-center py-6">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-6">
              {trimmed ? "No tasks match." : "No experiment tasks yet."}
            </p>
          ) : (
            <ul className="space-y-1">
              {!trimmed && (
                <li className="px-3 pt-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Recent
                </li>
              )}
              {visible.map((t) => {
                const proj = projectsByCompositeKey.get(`${t.owner}:${t.project_id}`);
                return (
                  <li key={taskKey(t)}>
                    <button
                      type="button"
                      onClick={() =>
                        onPick({ id: t.id, owner: t.owner, name: t.name })
                      }
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-blue-50 focus:bg-blue-50 focus:outline-none flex items-center gap-3"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: proj?.color || "#9ca3af" }}
                        aria-hidden
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-gray-900 truncate">
                          {t.name}
                        </span>
                        <span className="block text-xs text-gray-500 truncate">
                          {proj ? proj.name : "No project"}
                          {t.is_shared_with_me ? ` · shared by ${t.owner}` : ""}
                          {" · "}
                          {t.start_date}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {hasMore && (
                <li className="px-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    See all {filtered.length} tasks…
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
