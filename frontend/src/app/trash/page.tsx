"use client";

// VCP R2 trash everywhere (2026-05-26): the /trash route. R1 rendered a
// flat list of (Notes-only) trash entries; R2 groups by entity type and
// collapses empty sections. Sort within each section still defaults to
// newest-deleted-first (OQ15). Per-entry actions: Restore (with
// restore-with-dependencies prompt when applicable) / Permanent delete.
//
// Restore-with-dependencies (OQ4): when restoring a child whose parent
// is ALSO in trash, the `useResolveRestoreParent` hook prompts the user
// via `RestoreParentPromptHost`. "Restore both" cascades: parent is
// restored first so the child's `original_path` parent directory exists.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import {
  listTrash,
  restoreEntity,
  permanentlyDelete,
  sortTrashEntries,
  type TrashEntityType,
  type TrashIndexEntry,
  type TrashSort,
} from "@/lib/trash";
import {
  useResolveRestoreParent,
  RestoreParentPromptHost,
} from "@/components/trash/RestoreParentPrompt";
import {
  entryKey,
  toggleKey,
  toggleSection,
  sectionSelectState,
  pruneSelection,
  selectedEntries,
} from "./trash-selection";
import { SECTION_ORDER } from "./trash-sections";

const SORT_OPTIONS: Array<{ value: TrashSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "expiring", label: "Expiring soon" },
];

export default function TrashPage() {
  const { currentUser, isConnected } = useFileSystem();
  const [entries, setEntries] = useState<TrashIndexEntry[]>([]);
  const [sort, setSort] = useState<TrashSort>("newest");
  const [loading, setLoading] = useState(true);
  const [actionState, setActionState] = useState<{
    busyId: string | null;
    error: string | null;
  }>({ busyId: null, error: null });
  // Track which sections the user collapsed manually. Empty sections
  // default to collapsed (computed from `entries`); non-empty default
  // to expanded.
  const [collapsedOverrides, setCollapsedOverrides] = useState<
    Partial<Record<TrashEntityType, boolean>>
  >({});
  // Bulk-select model: a set of composite `${entity_type}:${id}` keys.
  // Ids collide across entity types, so the key must be namespaced.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Bulk action progress + the permanent-delete confirm gate.
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const resolveRestoreParent = useResolveRestoreParent();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isConnected || !currentUser) {
        if (!cancelled) {
          setEntries([]);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) setLoading(true);
      try {
        const list = await listTrash(currentUser);
        if (cancelled) return;
        setEntries(list);
      } catch (err) {
        console.warn("[trash-page] listTrash failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isConnected]);

  // Drop any selected keys whose row no longer exists (after a single-row
  // restore/delete, or when the list reloads). Keeps the selection set and
  // its derived count honest.
  useEffect(() => {
    setSelected((prev) => pruneSelection(prev, entries));
  }, [entries]);

  // Pre-bucket by entity type for the section render.
  const byType = useMemo(() => {
    const buckets = new Map<TrashEntityType, TrashIndexEntry[]>();
    for (const e of entries) {
      const arr = buckets.get(e.entity_type) ?? [];
      arr.push(e);
      buckets.set(e.entity_type, arr);
    }
    // Sort each bucket per the active sort.
    for (const [k, v] of buckets) {
      buckets.set(k, sortTrashEntries(v, sort));
    }
    return buckets;
  }, [entries, sort]);

  const handleRestore = async (entry: TrashIndexEntry) => {
    if (!currentUser) return;
    const key = `${entry.entity_type}:${entry.id}`;
    setActionState({ busyId: key, error: null });
    try {
      const outcome = await resolveRestoreParent(currentUser, entry);
      if (outcome === "cancel") {
        setActionState({ busyId: null, error: null });
        return;
      }
      const restored = await restoreEntity(
        currentUser,
        entry.entity_type,
        entry.id,
        currentUser,
      );
      if (!restored) {
        setActionState({ busyId: null, error: "Restore failed" });
        return;
      }
      // Track which ids to drop from local state.
      const removedKeys: Array<{ id: string | number; type: TrashEntityType }> = [
        { id: entry.id, type: entry.entity_type },
      ];
      // "Restore both" branch: the parent is restored AFTER the child
      // here (the writer creates the parent dir on demand, and the
      // child's `original_path` doesn't actually depend on the live
      // parent record existing — it's just a numeric ref). The order
      // doesn't matter for the file system; we do parent-first as a
      // convention so the read side sees a consistent state.
      if (
        outcome === "restore-both" &&
        entry.parent_id !== undefined &&
        entry.parent_entity_type
      ) {
        const parentEntry = entries.find(
          (e) =>
            e.entity_type === entry.parent_entity_type &&
            e.id === entry.parent_id,
        );
        if (parentEntry) {
          try {
            const restoredParent = await restoreEntity(
              currentUser,
              parentEntry.entity_type,
              parentEntry.id,
              currentUser,
            );
            if (restoredParent) {
              removedKeys.push({
                id: parentEntry.id,
                type: parentEntry.entity_type,
              });
            }
          } catch (err) {
            console.warn(
              "[trash-page] cascade restore of parent failed (child restored, parent left in trash)",
              err,
            );
          }
        }
      }
      setEntries((prev) =>
        prev.filter(
          (e) =>
            !removedKeys.some(
              (k) => k.id === e.id && k.type === e.entity_type,
            ),
        ),
      );
      setActionState({ busyId: null, error: null });
    } catch (err) {
      console.warn("[trash-page] restore failed", err);
      setActionState({ busyId: null, error: "Restore failed" });
    }
  };

  const handlePermanentDelete = async (entry: TrashIndexEntry) => {
    if (!currentUser) return;
    if (
      !window.confirm(
        "Permanently delete this record? This cannot be undone.",
      )
    ) {
      return;
    }
    const key = `${entry.entity_type}:${entry.id}`;
    setActionState({ busyId: key, error: null });
    try {
      const ok = await permanentlyDelete(
        currentUser,
        entry.entity_type,
        entry.id,
      );
      if (!ok) {
        setActionState({ busyId: null, error: "Permanent delete failed" });
        return;
      }
      setEntries((prev) =>
        prev.filter(
          (e) => !(e.id === entry.id && e.entity_type === entry.entity_type),
        ),
      );
      setActionState({ busyId: null, error: null });
    } catch (err) {
      console.warn("[trash-page] permanentDelete failed", err);
      setActionState({ busyId: null, error: "Permanent delete failed" });
    }
  };

  // --- Bulk select model ---------------------------------------------
  const toggleRow = (entry: TrashIndexEntry) =>
    setSelected((prev) => toggleKey(prev, entryKey(entry)));

  const toggleSectionSelect = (sectionEntries: TrashIndexEntry[]) =>
    setSelected((prev) => toggleSection(prev, sectionEntries));

  const clearSelection = () => setSelected(new Set());

  const selectedCount = selected.size;

  // --- Bulk actions ---------------------------------------------------
  // Both bulk paths loop the same restore / permanent-delete APIs the
  // single-row buttons use. Each selected entry is treated independently
  // (no parent-restore prompt in bulk; if a parent is also selected it is
  // restored on its own pass). Non-owner no-ops return falsy from the API
  // and are counted as failures rather than crashing.

  const handleBulkRestore = async () => {
    if (!currentUser) return;
    const targets = selectedEntries(selected, entries);
    if (targets.length === 0) return;
    setBulkBusy(true);
    setActionState({ busyId: null, error: null });
    const restoredKeys = new Set<string>();
    let failures = 0;
    for (const entry of targets) {
      try {
        const ok = await restoreEntity(
          currentUser,
          entry.entity_type,
          entry.id,
        );
        if (ok) restoredKeys.add(entryKey(entry));
        else failures += 1;
      } catch (err) {
        console.warn("[trash-page] bulk restore item failed", err);
        failures += 1;
      }
    }
    setEntries((prev) => prev.filter((e) => !restoredKeys.has(entryKey(e))));
    setSelected(new Set());
    setBulkBusy(false);
    setActionState({
      busyId: null,
      error:
        failures > 0
          ? `Restored ${restoredKeys.size} of ${targets.length}. ${failures} could not be restored.`
          : null,
    });
  };

  const handleBulkPermanentDelete = async () => {
    if (!currentUser) return;
    const targets = selectedEntries(selected, entries);
    if (targets.length === 0) {
      setConfirmBulkDelete(false);
      return;
    }
    setConfirmBulkDelete(false);
    setBulkBusy(true);
    setActionState({ busyId: null, error: null });
    const deletedKeys = new Set<string>();
    let failures = 0;
    for (const entry of targets) {
      try {
        const ok = await permanentlyDelete(
          currentUser,
          entry.entity_type,
          entry.id,
        );
        if (ok) deletedKeys.add(entryKey(entry));
        else failures += 1;
      } catch (err) {
        console.warn("[trash-page] bulk permanent delete item failed", err);
        failures += 1;
      }
    }
    setEntries((prev) => prev.filter((e) => !deletedKeys.has(entryKey(e))));
    setSelected(new Set());
    setBulkBusy(false);
    setActionState({
      busyId: null,
      error:
        failures > 0
          ? `Deleted ${deletedKeys.size} of ${targets.length}. ${failures} could not be deleted.`
          : null,
    });
  };

  return (
    <AppShell>
      <RestoreParentPromptHost />
      <div className="flex-1 overflow-y-auto">
        <PageContainer width="wide" className="py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-heading font-semibold text-foreground">Trash</h1>
          <p className="text-body text-foreground-muted">
            Deleted records stay here until the cleanup window passes. Restore
            puts a record back where it came from; permanent delete removes
            it without recovery.{" "}
            <Link
              href="/settings#history-and-trash"
              className="text-accent hover:underline"
            >
              Configure cleanup window
            </Link>
            .
          </p>
        </header>

        <div className="flex items-center justify-between">
          <p className="text-body text-foreground-muted">
            {loading
              ? "Loading…"
              : `${entries.length} item${entries.length === 1 ? "" : "s"}`}
          </p>
          <label className="flex items-center gap-2 text-body text-foreground">
            <span>Sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as TrashSort)}
              className="border border-border rounded px-2 py-1 text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {actionState.error && (
          <div
            role="alert"
            className="rounded-md border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-300 text-body px-3 py-2"
          >
            {actionState.error}
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="border border-dashed border-border rounded-lg py-12 text-center text-foreground-muted">
            Trash is empty.
          </div>
        )}

        {!loading && entries.length > 0 && selectedCount > 0 && (
          <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-accent-soft px-4 py-3 shadow-sm">
            <span className="text-body font-medium text-foreground">
              {selectedCount} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBulkRestore}
                disabled={bulkBusy}
                className="ros-btn-neutral ros-btn-raise px-3 py-1.5 text-body disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkBusy ? "Working…" : `Restore ${selectedCount}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(true)}
                disabled={bulkBusy}
                className="ros-btn-raise px-3 py-1.5 text-body rounded-md text-red-700 dark:text-red-200 border border-red-200 dark:border-red-400/40 bg-red-50 dark:bg-red-500/25 hover:bg-red-100 dark:hover:bg-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Permanent delete {selectedCount}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={bulkBusy}
                className="px-3 py-1.5 text-body rounded-md text-foreground hover:bg-surface-raised/70 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear selection
              </button>
            </div>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="space-y-3">
            {SECTION_ORDER.map(({ key, label }) => {
              const sectionEntries = byType.get(key) ?? [];
              // Hide empty categories entirely so the page stays uncluttered; a
              // category reappears on its own once it has trashed items again.
              if (sectionEntries.length === 0) return null;
              const defaultCollapsed = false;
              const collapsed =
                collapsedOverrides[key] !== undefined
                  ? collapsedOverrides[key]
                  : defaultCollapsed;
              return (
                <TrashSection
                  key={key}
                  label={label}
                  entryType={key}
                  entries={sectionEntries}
                  collapsed={collapsed === true}
                  onToggle={() =>
                    setCollapsedOverrides((prev) => ({
                      ...prev,
                      [key]: !(collapsed === true),
                    }))
                  }
                  busyId={actionState.busyId}
                  onRestore={handleRestore}
                  onPermanentDelete={handlePermanentDelete}
                  selected={selected}
                  selectState={sectionSelectState(selected, sectionEntries)}
                  onToggleRow={toggleRow}
                  onToggleSection={() => toggleSectionSelect(sectionEntries)}
                  selectDisabled={bulkBusy}
                />
              );
            })}
          </div>
        )}
        </PageContainer>
      </div>
      {confirmBulkDelete && (
        <BulkDeleteConfirm
          count={selectedCount}
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={handleBulkPermanentDelete}
        />
      )}
    </AppShell>
  );
}

interface BulkDeleteConfirmProps {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Modal confirm gate for the irreversible bulk permanent-delete. The
 *  single-row path uses window.confirm, but a bulk wipe deserves an
 *  explicit red confirm so it can never fire on a stray click. */
function BulkDeleteConfirm({ count, onCancel, onConfirm }: BulkDeleteConfirmProps) {
  // Escape cancels this confirm gate (app-wide convention).
  useEscapeToClose(onCancel);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-delete-title"
    >
      <div className="w-full max-w-sm rounded-lg bg-surface-raised p-5 shadow-xl">
        <h2
          id="bulk-delete-title"
          className="text-title font-semibold text-foreground"
        >
          Permanently delete {count} item{count === 1 ? "" : "s"}?
        </h2>
        <p className="mt-2 text-body text-foreground-muted">
          This cannot be undone. The selected records are removed without
          recovery.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="ros-btn-neutral ros-btn-raise px-3 py-1.5 text-body"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="ros-btn-raise px-3 py-1.5 text-body rounded-md text-white bg-red-600 hover:bg-red-700"
          >
            Permanently delete
          </button>
        </div>
      </div>
    </div>
  );
}

interface TrashSectionProps {
  label: string;
  entryType: TrashEntityType;
  entries: TrashIndexEntry[];
  collapsed: boolean;
  onToggle: () => void;
  busyId: string | null;
  onRestore: (entry: TrashIndexEntry) => void;
  onPermanentDelete: (entry: TrashIndexEntry) => void;
  selected: Set<string>;
  selectState: "none" | "some" | "all";
  onToggleRow: (entry: TrashIndexEntry) => void;
  onToggleSection: () => void;
  selectDisabled: boolean;
}

function TrashSection({
  label,
  entryType,
  entries,
  collapsed,
  onToggle,
  busyId,
  onRestore,
  onPermanentDelete,
  selected,
  selectState,
  onToggleRow,
  onToggleSection,
  selectDisabled,
}: TrashSectionProps) {
  const count = entries.length;
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  // The indeterminate flag is DOM-only (no React prop), so set it on the
  // ref whenever the section's tri-state lands on "some".
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectState === "some";
    }
  }, [selectState]);
  return (
    <section
      className="border border-border rounded-lg bg-surface-raised overflow-hidden"
      aria-label={`Trash section: ${label}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Tooltip label={`Select all ${label.toLowerCase()}`} placement="top">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={selectState === "all"}
            disabled={selectDisabled}
            onChange={onToggleSection}
            aria-label={`Select all ${label}`}
            className="h-4 w-4 rounded border-border text-accent focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </Tooltip>
        <button
          type="button"
          onClick={onToggle}
          className="-mx-1 flex flex-1 items-center justify-between rounded px-1 py-0.5 hover:bg-surface-sunken text-left"
          aria-expanded={!collapsed}
          aria-controls={`trash-section-${entryType}`}
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block w-2 h-2 border-r border-b border-gray-500 transform transition-transform ${
                collapsed ? "-rotate-45" : "rotate-45"
              }`}
            />
            <span className="text-body font-medium text-foreground">{label}</span>
          </span>
          <span className="text-meta text-foreground-muted">
            {count === 0 ? "Empty" : `${count} item${count === 1 ? "" : "s"}`}
          </span>
        </button>
      </div>
      {!collapsed && count > 0 && (
        <ul
          id={`trash-section-${entryType}`}
          className="divide-y divide-border border-t border-border"
        >
          {entries.map((entry) => (
            <TrashRow
              key={`${entry.entity_type}:${entry.id}`}
              entry={entry}
              busy={busyId === `${entry.entity_type}:${entry.id}`}
              onRestore={() => onRestore(entry)}
              onPermanentDelete={() => onPermanentDelete(entry)}
              checked={selected.has(`${entry.entity_type}:${entry.id}`)}
              onToggleSelect={() => onToggleRow(entry)}
              selectDisabled={selectDisabled}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface TrashRowProps {
  entry: TrashIndexEntry;
  busy: boolean;
  onRestore: () => void;
  onPermanentDelete: () => void;
  checked: boolean;
  onToggleSelect: () => void;
  selectDisabled: boolean;
}

function TrashRow({
  entry,
  busy,
  onRestore,
  onPermanentDelete,
  checked,
  onToggleSelect,
  selectDisabled,
}: TrashRowProps) {
  const displayName = buildDisplayName(entry);
  const deletedAtPretty = formatRelativeTime(entry.deleted_at);
  const expiresInLabel = formatExpiresIn(entry.auto_expires_at);
  return (
    <li className="px-4 py-3 flex items-center gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={selectDisabled}
        onChange={onToggleSelect}
        aria-label={`Select ${displayName}`}
        className="h-4 w-4 rounded border-border text-accent focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <div className="flex-1 min-w-0">
        <div className="text-body font-medium text-foreground truncate">
          {displayName}
        </div>
        <div className="text-meta text-foreground-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>Deleted by {entry.deleted_by}</span>
          <span aria-hidden="true">·</span>
          <span>{deletedAtPretty}</span>
          {expiresInLabel && (
            <>
              <span aria-hidden="true">·</span>
              <span>{expiresInLabel}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Tooltip label="Restore to original location" placement="top">
          <button
            type="button"
            onClick={onRestore}
            disabled={busy}
            className="ros-btn-neutral ros-btn-raise px-3 py-1.5 text-body disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Restore
          </button>
        </Tooltip>
        <Tooltip label="Permanently delete (cannot be undone)" placement="top">
          <button
            type="button"
            onClick={onPermanentDelete}
            disabled={busy}
            className="ros-btn-raise px-3 py-1.5 text-body rounded-md text-red-700 dark:text-red-200 border border-red-200 dark:border-red-400/40 bg-red-50 dark:bg-red-500/25 hover:bg-red-100 dark:hover:bg-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Permanent delete
          </button>
        </Tooltip>
      </div>
    </li>
  );
}

/** Pull a display name out of the index entry. The index doesn't carry
 *  the title, but the slug suffix on the trash filename mirrors the
 *  original name — we strip the `<id>-` prefix to recover a readable
 *  approximation. */
function buildDisplayName(entry: TrashIndexEntry): string {
  const filename = entry.trash_path.split("/").pop() ?? "";
  const stem = filename.replace(/\.json$/, "");
  const dashIdx = stem.indexOf("-");
  const slug = dashIdx >= 0 ? stem.slice(dashIdx + 1) : "";
  if (!slug) return `Untitled ${entry.entity_type} #${entry.id}`;
  return slug.replace(/-/g, " ");
}

/** Relative time formatter ("3 days ago"). Avoids a new dependency by
 *  rolling a simple bucketing helper. */
function formatRelativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "Unknown time";
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** "Expires in N days" countdown, or null when in the Never bucket. */
function formatExpiresIn(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const yearsFromNow = (ms - Date.now()) / (365 * 24 * 60 * 60 * 1000);
  if (yearsFromNow > 100) return "Never expires";
  const diff = ms - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  if (days <= 1) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}
