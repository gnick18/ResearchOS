"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllProjectsIncludingShared } from "@/lib/local-api";
import LivingPopup from "@/components/ui/LivingPopup";
import type { Task, Project } from "@/lib/types";

interface TaskPickerProps {
  open: boolean;
  /** Tasks eligible to be selected — caller pre-filters (e.g. exclude self / existing parents). */
  availableTasks: Task[];
  /** Pin the section for this project at the top. */
  currentProjectId?: number;
  /** Optional placeholder + title overrides. */
  placeholder?: string;
  title?: string;
  onSelect: (taskId: number) => void | Promise<void>;
  onClose: () => void;
}

type FlatRow =
  | { kind: "header"; label: string; count: number; sectionKey: string }
  | { kind: "task"; task: Task; sectionKey: string };

const NO_PROJECT = "No project";

function formatDate(iso: string | null | undefined): string {
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

export default function TaskPicker({
  open,
  availableTasks,
  currentProjectId,
  placeholder = "Search experiments by name or #tag…",
  title,
  onSelect,
  onClose,
}: TaskPickerProps) {
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Reset internal state when the picker is (re)opened. Compare-to-previous-
  // prop pattern from the React docs, preferred over a syncing effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
    }
  }

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const projectById = useMemo(() => {
    const m = new Map<number, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  const flatRows: FlatRow[] = useMemo(() => {
    const raw = query.trim().toLowerCase();
    const tagQuery = raw.startsWith("#") ? raw.slice(1) : raw;

    const filtered = availableTasks.filter((t) => {
      if (!raw) return true;
      if (t.name.toLowerCase().includes(raw)) return true;
      if (tagQuery && t.tags?.some((tag) => tag.toLowerCase().includes(tagQuery))) {
        return true;
      }
      return false;
    });

    // Group tasks by project. Sort within a project by start_date desc so the
    // most-recent experiment is at the top of each group — usually what the
    // user is depending on.
    const byProject = new Map<number | "none", Task[]>();
    for (const t of filtered) {
      const key: number | "none" = t.project_id ?? "none";
      const bucket = byProject.get(key);
      if (bucket) bucket.push(t);
      else byProject.set(key, [t]);
    }

    const projectKeys = Array.from(byProject.keys()).sort((a, b) => {
      // current project first
      if (a === currentProjectId) return -1;
      if (b === currentProjectId) return 1;
      // "none" last
      if (a === "none") return 1;
      if (b === "none") return -1;
      const aName = projectById.get(a as number)?.name ?? "";
      const bName = projectById.get(b as number)?.name ?? "";
      return aName.localeCompare(bName);
    });

    const rows: FlatRow[] = [];
    for (const key of projectKeys) {
      const tasks = (byProject.get(key) ?? []).slice().sort((a, b) => {
        // recent first within a project
        if (a.start_date && b.start_date && a.start_date !== b.start_date) {
          return b.start_date.localeCompare(a.start_date);
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      const labelBase =
        key === "none"
          ? NO_PROJECT
          : projectById.get(key as number)?.name ?? `Project ${key}`;
      const label = key === currentProjectId ? `${labelBase} · this project` : labelBase;
      rows.push({
        kind: "header",
        label,
        count: tasks.length,
        sectionKey: `project:${key}`,
      });
      for (const task of tasks) {
        rows.push({ kind: "task", task, sectionKey: `project:${key}` });
      }
    }
    return rows;
  }, [availableTasks, query, projectById, currentProjectId]);

  const selectableIndices = useMemo(
    () =>
      flatRows
        .map((r, i) => (r.kind === "task" ? i : -1))
        .filter((i) => i !== -1),
    [flatRows]
  );

  // Clamp the highlighted index when the filtered list changes. Defensive
  // sync against derived state — legitimately needs setState in an effect.
  useEffect(() => {
    if (selectableIndices.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHighlightedIndex(-1);
      return;
    }
    if (!selectableIndices.includes(highlightedIndex)) {
      setHighlightedIndex(selectableIndices[0]);
    }
  }, [selectableIndices, highlightedIndex]);

  useEffect(() => {
    if (highlightedIndex < 0) return;
    const el = rowRefs.current.get(highlightedIndex);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  if (!open) return null;

  const moveHighlight = (direction: 1 | -1) => {
    if (selectableIndices.length === 0) return;
    const currentPos = selectableIndices.indexOf(highlightedIndex);
    const nextPos =
      currentPos === -1
        ? 0
        : Math.min(
            selectableIndices.length - 1,
            Math.max(0, currentPos + direction)
          );
    setHighlightedIndex(selectableIndices[nextPos]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = flatRows[highlightedIndex];
      if (row?.kind === "task") {
        void onSelect(row.task.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    // align="top" keeps the command-palette drop-from-top placement; selfSize so
    // the card's own max-w-2xl + 75vh sizing renders unchanged. The card owns the
    // full keyboard model (arrows / Enter / Escape) via handleKeyDown, so
    // LivingPopup's Escape is opted out. No blur: a list picker is a little popup.
    <LivingPopup
      open
      onClose={onClose}
      label={title || "Select a task"}
      selfSize
      align="top"
      showClose={false}
      closeOnEscape={false}
    >
      <div
        className="pointer-events-auto w-full max-w-2xl bg-surface-raised rounded-xl ros-popup-card-shadow flex flex-col overflow-hidden"
        style={{ maxHeight: "75vh" }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {title && (
          <div className="px-4 pt-3 pb-1 text-meta uppercase tracking-wide font-semibold text-foreground-muted">
            {title}
          </div>
        )}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg
            className="w-4 h-4 text-foreground-muted shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 text-body outline-none placeholder-gray-400"
          />
          <button
            onClick={onClose}
            className="text-meta text-foreground-muted hover:text-foreground bg-surface-sunken hover:bg-border px-2 py-1 border border-border rounded"
            aria-label="Close picker"
          >
            Esc
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {availableTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-body text-foreground-muted">
              No eligible experiments available.
            </div>
          ) : flatRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-body text-foreground-muted">
              No experiments match &ldquo;{query}&rdquo;. Try a different search
              or clear the input.
            </div>
          ) : (
            flatRows.map((row, index) => {
              if (row.kind === "header") {
                return (
                  <div
                    key={`h:${row.sectionKey}`}
                    className="sticky top-0 z-10 bg-surface-sunken/95 backdrop-blur px-4 py-1.5 text-meta uppercase tracking-wide font-semibold text-foreground-muted border-b border-border"
                  >
                    {row.label}
                    <span className="ml-2 text-foreground-muted normal-case tracking-normal font-normal">
                      {row.count}
                    </span>
                  </div>
                );
              }
              const t = row.task;
              const isHighlighted = index === highlightedIndex;
              return (
                <button
                  key={`${row.sectionKey}:${t.id}`}
                  ref={(el) => {
                    if (el) rowRefs.current.set(index, el);
                    else rowRefs.current.delete(index);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => void onSelect(t.id)}
                  className={`w-full text-left px-4 py-2.5 border-b border-border transition-colors ${
                    isHighlighted ? "bg-blue-50 dark:bg-blue-500/15" : "bg-surface-raised hover:bg-surface-sunken"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-body font-medium truncate ${
                          t.is_complete ? "text-foreground-muted line-through" : "text-foreground"
                        }`}
                      >
                        {t.name}
                      </span>
                      {t.is_complete && (
                        <span className="text-meta text-green-600 dark:text-green-300 shrink-0">✓</span>
                      )}
                    </div>
                    <span className="text-meta text-foreground-muted shrink-0 whitespace-nowrap">
                      {formatDate(t.start_date)} → {formatDate(t.end_date)}
                    </span>
                  </div>
                  {t.tags && t.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {t.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-meta px-1.5 py-0.5 bg-surface-sunken text-foreground-muted rounded"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-meta text-foreground-muted bg-surface-sunken">
          <span>
            <kbd className="px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
              ↑
            </kbd>
            <kbd className="ml-0.5 px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
              ↓
            </kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
              ↵
            </kbd>{" "}
            select
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-surface-raised border border-border rounded text-foreground-muted">
              esc
            </kbd>{" "}
            close
          </span>
        </div>
      </div>
    </LivingPopup>
  );
}
