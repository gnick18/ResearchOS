"use client";

// Tree Studio left rail (phylo v3 unified rail, Grant 2026-06-13). The signature
// collection rail recycled from /sequences + /chemistry: a collection selector
// (All / Unfiled / Projects with counts), a filter box, and the saved trees in
// that collection as a selectable, bulk-actionable, right-clickable list. Picking
// a row opens that tree in the canvas (the parent's onPick). This replaces the
// controls-first left column AND retires the separate Hub saved-trees grid, so
// trees live in exactly one place.
//
// The split shell (width / divider / collapse) lives in the parent (PhyloStudio),
// mirroring how ChemistryHub owns its split; this renders only the rail content.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { phyloApi, type PhyloMeta } from "@/lib/phylo/api";
import { projectsApi } from "@/lib/local-api";
import { useContextMenu } from "@/components/context-menu/ContextMenuProvider";
import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";

const TREE_LIST_KEY = ["phylo", "list"] as const;

export function PhyloCollectionRail({
  selectedId,
  onPick,
  onNew,
  onCollapse,
  onOpenCleared,
}: {
  /** The open tree's id, for row highlight. */
  selectedId: string | null;
  /** Open a saved tree in the canvas. */
  onPick: (id: string) => void;
  /** Start a new tree (parent shows the import panel in the canvas). */
  onNew: () => void;
  /** Collapse the rail to focus the canvas. */
  onCollapse: () => void;
  /** The open tree was deleted, so the canvas should clear. */
  onOpenCleared?: () => void;
}) {
  const queryClient = useQueryClient();
  const { openMenu } = useContextMenu();

  const [collection, setCollection] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<PhyloMeta | null>(null);

  const { data: trees = [], isLoading, isError } = useQuery({
    queryKey: TREE_LIST_KEY,
    queryFn: () => phyloApi.list(),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "for-phylo"],
    queryFn: () => projectsApi.list(),
  });

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: TREE_LIST_KEY });
  }, [queryClient]);

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(String(p.id), p.name);
    return map;
  }, [projects]);

  const unfiledCount = useMemo(
    () => trees.filter((t) => t.project_ids.length === 0).length,
    [trees],
  );
  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of trees)
      for (const pid of t.project_ids)
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
    return counts;
  }, [trees]);

  const inCollection = useMemo(() => {
    if (collection === "all") return trees;
    if (collection === "unfiled")
      return trees.filter((t) => t.project_ids.length === 0);
    return trees.filter((t) => t.project_ids.includes(collection));
  }, [trees, collection]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? inCollection.filter((t) => t.name.toLowerCase().includes(q))
      : inCollection;
  }, [inCollection, query]);

  // Keep the checked set consistent with live data (drop deleted ids), but never
  // clear on a search / collection change so a user can refine mid-selection.
  useEffect(() => {
    setCheckedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(trees.map((t) => t.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [trees]);

  const visibleChecked = useMemo(
    () => shown.reduce((n, t) => n + (checkedIds.has(t.id) ? 1 : 0), 0),
    [shown, checkedIds],
  );
  const allVisibleChecked = shown.length > 0 && visibleChecked === shown.length;
  const someVisibleChecked = visibleChecked > 0 && !allVisibleChecked;

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const toggleAllVisible = useCallback(() => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      const everyVisible = shown.length > 0 && shown.every((t) => next.has(t.id));
      if (everyVisible) for (const t of shown) next.delete(t.id);
      else for (const t of shown) next.add(t.id);
      return next;
    });
  }, [shown]);
  const clearSelection = useCallback(() => setCheckedIds(new Set()), []);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      let clearedOpen = false;
      for (const id of ids) {
        try {
          if (await phyloApi.remove(id)) {
            if (id === selectedId) clearedOpen = true;
          }
        } catch (err) {
          console.warn("[phylo] bulk delete failed for", id, err);
        }
      }
      setCheckedIds(new Set());
      await invalidate();
      if (clearedOpen) onOpenCleared?.();
    } finally {
      setBulkBusy(false);
    }
  }, [checkedIds, bulkBusy, selectedId, invalidate, onOpenCleared]);

  const handleBulkAddToProject = useCallback(
    async (projectId: string) => {
      const ids = Array.from(checkedIds);
      if (ids.length === 0 || bulkBusy || !projectId) return;
      setBulkBusy(true);
      try {
        for (const id of ids) {
          const t = trees.find((x) => x.id === id);
          if (!t || t.project_ids.includes(projectId)) continue;
          try {
            await phyloApi.updateMeta(id, {
              project_ids: [...t.project_ids, projectId],
            });
          } catch (err) {
            console.warn("[phylo] bulk link failed for", id, err);
          }
        }
        await invalidate();
      } finally {
        setBulkBusy(false);
      }
    },
    [checkedIds, bulkBusy, trees, invalidate],
  );

  const handleRenameConfirm = useCallback(
    async (next: string) => {
      const target = renameTarget;
      setRenameTarget(null);
      const trimmed = next.trim();
      if (!target || !trimmed || trimmed === target.name) return;
      await phyloApi.updateMeta(target.id, { name: trimmed });
      await invalidate();
    },
    [renameTarget, invalidate],
  );

  const handleDuplicate = useCallback(
    async (t: PhyloMeta) => {
      const raw = await phyloApi.get(t.id);
      if (!raw) return;
      const copy = await phyloApi.create(raw.tree, {
        name: `${t.name} copy`,
        project_ids: t.project_ids,
        format: t.format,
        source: t.source,
        figure: t.figure,
        metadata: t.metadata,
      });
      await invalidate();
      onPick(copy.meta.id);
    },
    [invalidate, onPick],
  );

  const handleDeleteOne = useCallback(
    async (t: PhyloMeta) => {
      const ok = await phyloApi.remove(t.id);
      if (!ok) return;
      await invalidate();
      if (t.id === selectedId) onOpenCleared?.();
    },
    [invalidate, selectedId, onOpenCleared],
  );

  const buildTreeMenu = useCallback(
    (t: PhyloMeta): EditMenuItem[] => [
      { id: "open", label: "Open", enabled: true, onRun: () => onPick(t.id) },
      {
        id: "rename",
        label: "Rename",
        enabled: true,
        onRun: () => setRenameTarget(t),
      },
      {
        id: "duplicate",
        label: "Duplicate",
        enabled: true,
        onRun: () => void handleDuplicate(t),
      },
      {
        id: "delete",
        label: "Delete",
        enabled: true,
        destructive: true,
        group: true,
        onRun: () => void handleDeleteOne(t),
      },
    ],
    [onPick, handleDuplicate, handleDeleteOne],
  );

  return (
    <>
      {/* header + actions */}
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-title font-bold text-foreground">Trees</h1>
          <div className="flex items-center gap-2">
            <span className="text-meta text-foreground-muted">
              {trees.length} tree{trees.length === 1 ? "" : "s"}
            </span>
            <Tooltip label="Hide the list">
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Hide the tree list"
                className="shrink-0 rounded-md p-1 text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
              >
                <Icon name="chevronLeft" className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <button
            type="button"
            onClick={onNew}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-action px-2.5 py-1.5 text-meta font-semibold text-white transition-colors hover:bg-brand-action/90"
          >
            <Icon name="plus" className="w-3.5 h-3.5" />
            New tree
          </button>
        </div>
      </div>

      {/* collection selector */}
      <div className="border-b border-border px-3 py-2">
        <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
          Collection
        </label>
        <select
          aria-label="Filter trees by collection"
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
          className="w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground outline-none focus:border-brand-action"
        >
          <option value="all">All trees ({trees.length})</option>
          <option value="unfiled">Unfiled ({unfiledCount})</option>
          {projects.length > 0 ? (
            <optgroup label="Projects">
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name} ({projectCounts.get(String(p.id)) ?? 0})
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>

      {/* filter */}
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter your trees"
            aria-label="Filter your trees by name"
            className="w-full min-w-0 rounded-md border border-border bg-surface-raised pl-8 pr-2.5 py-1.5 text-body text-foreground placeholder:text-foreground-muted outline-none focus:border-brand-action"
          />
        </div>
      </div>

      {/* select all */}
      {!isLoading && !isError && shown.length > 0 ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <input
            type="checkbox"
            checked={allVisibleChecked}
            ref={(el) => {
              if (el) el.indeterminate = someVisibleChecked;
            }}
            onChange={toggleAllVisible}
            aria-label="Select all shown trees"
            className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border text-accent focus:ring-sky-400"
          />
          <span className="text-meta text-foreground-muted">
            {checkedIds.size > 0 ? `${checkedIds.size} selected` : "Select all"}
          </span>
        </div>
      ) : null}

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
        {isError ? (
          <p className="px-3 py-6 text-meta text-red-600 dark:text-red-300">
            Could not read your trees. Check your data folder is connected.
          </p>
        ) : isLoading ? (
          <p className="px-3 py-6 text-meta text-foreground-muted">Loading...</p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-6 text-meta text-foreground-muted">
            {trees.length === 0
              ? "No trees yet. Start one with New tree, or build one in Tree Builder."
              : query.trim()
                ? `No trees match "${query}".`
                : "No trees in this collection."}
          </p>
        ) : (
          <ul>
            {shown.map((t) => (
              <TreeRow
                key={t.id}
                tree={t}
                projectName={projectName}
                selected={selectedId === t.id}
                checked={checkedIds.has(t.id)}
                onToggleCheck={() => toggleChecked(t.id)}
                onClick={() => onPick(t.id)}
                onContextMenu={(e) => openMenu(e, buildTreeMenu(t))}
              />
            ))}
          </ul>
        )}
      </div>

      {/* bulk action bar */}
      {checkedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-sunken px-3 py-2">
          <span className="text-meta font-semibold text-foreground">
            {checkedIds.size} selected
          </span>
          {projects.length > 0 ? (
            <select
              aria-label="Add selected trees to a project"
              value=""
              disabled={bulkBusy}
              onChange={(e) => {
                if (e.target.value) {
                  void handleBulkAddToProject(e.target.value);
                  e.target.value = "";
                }
              }}
              className="rounded-md border border-border bg-surface-raised px-2 py-1 text-meta text-foreground outline-none focus:border-brand-action disabled:opacity-60"
            >
              <option value="">Add to project...</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={() => void handleBulkDelete()}
            disabled={bulkBusy}
            className="ml-auto rounded-md px-2.5 py-1 text-meta font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            {bulkBusy ? "Deleting..." : "Delete"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-md px-2 py-1 text-meta text-foreground-muted hover:text-foreground"
          >
            Clear
          </button>
        </div>
      ) : null}

      {renameTarget && (
        <TreeRenameModal
          current={renameTarget.name}
          onCancel={() => setRenameTarget(null)}
          onConfirm={(name) => void handleRenameConfirm(name)}
        />
      )}
    </>
  );
}

function fmtAdded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TreeRow({
  tree,
  projectName,
  selected,
  checked,
  onToggleCheck,
  onClick,
  onContextMenu,
}: {
  tree: PhyloMeta;
  projectName: Map<string, string>;
  selected: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const meta = [
    tree.tip_count != null ? `${tree.tip_count} tips` : null,
    tree.format,
    fmtAdded(tree.added_at),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      onContextMenu={onContextMenu}
      className={`flex items-center border-b border-border ${
        selected ? "bg-accent-soft" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        aria-label={`Select ${tree.name}`}
        className="ml-3 mr-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border text-accent focus:ring-sky-400"
      />
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-2.5 px-2 py-2 text-left transition-colors ${
          selected ? "" : "hover:bg-surface-sunken"
        }`}
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-accent-soft text-brand-action">
          <Icon name="tree" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-foreground">
            {tree.name}
          </span>
          {meta ? (
            <span className="block truncate text-meta text-foreground-muted">
              {meta}
            </span>
          ) : null}
        </span>
        {tree.project_ids[0] ? (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300 max-w-[80px] truncate">
            {projectName.get(tree.project_ids[0]) ?? "Project"}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** Small rename modal, reached from the row right-click menu. Mirrors the
 *  sequences / chemistry rename affordance: prefilled input, Enter saves, Esc
 *  cancels. */
function TreeRenameModal({
  current,
  onCancel,
  onConfirm,
}: {
  current: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [value, setValue] = useState(current);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/20"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-sm bg-surface-raised border border-border rounded-xl shadow-2xl p-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-body font-semibold text-foreground mb-2">
          Rename tree
        </h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="w-full px-3 py-2 text-body text-foreground bg-surface border border-border rounded-lg outline-none focus:border-brand-action"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-meta font-medium text-foreground-muted hover:text-foreground rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(value)}
            className="px-3 py-1.5 text-meta font-semibold text-white bg-brand-action rounded-lg hover:opacity-90 transition-opacity"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default PhyloCollectionRail;
