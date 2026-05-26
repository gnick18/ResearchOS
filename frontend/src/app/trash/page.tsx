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

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Tooltip from "@/components/Tooltip";
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

const SORT_OPTIONS: Array<{ value: TrashSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "expiring", label: "Expiring soon" },
];

/** Order in which entity-type sections render. Notes first (most-used),
 *  then the rest roughly by familiarity. */
const SECTION_ORDER: Array<{ key: TrashEntityType; label: string }> = [
  { key: "note", label: "Notes" },
  { key: "task", label: "Tasks" },
  { key: "project", label: "Projects" },
  { key: "method", label: "Methods" },
  { key: "purchase_item", label: "Purchase items" },
  { key: "high_level_goal", label: "High-level goals" },
  { key: "lab_link", label: "Lab links" },
  { key: "mass_spec_protocol", label: "Mass spec protocols" },
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

  return (
    <AppShell>
      <RestoreParentPromptHost />
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">Trash</h1>
          <p className="text-sm text-gray-600">
            Deleted records stay here until the cleanup window passes. Restore
            puts a record back where it came from; permanent delete removes
            it without recovery.{" "}
            <Link
              href="/settings#history-and-trash"
              className="text-blue-600 hover:underline"
            >
              Configure cleanup window
            </Link>
            .
          </p>
        </header>

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {loading
              ? "Loading…"
              : `${entries.length} item${entries.length === 1 ? "" : "s"}`}
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <span>Sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as TrashSort)}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="rounded-md border border-red-300 bg-red-50 text-red-800 text-sm px-3 py-2"
          >
            {actionState.error}
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="border border-dashed border-gray-300 rounded-lg py-12 text-center text-gray-500">
            Trash is empty.
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="space-y-3">
            {SECTION_ORDER.map(({ key, label }) => {
              const sectionEntries = byType.get(key) ?? [];
              const isEmpty = sectionEntries.length === 0;
              const defaultCollapsed = isEmpty;
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
                />
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
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
}: TrashSectionProps) {
  const count = entries.length;
  return (
    <section
      className="border border-gray-200 rounded-lg bg-white overflow-hidden"
      aria-label={`Trash section: ${label}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
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
          <span className="text-sm font-medium text-gray-900">{label}</span>
        </span>
        <span className="text-xs text-gray-500">
          {count === 0 ? "Empty" : `${count} item${count === 1 ? "" : "s"}`}
        </span>
      </button>
      {!collapsed && count > 0 && (
        <ul
          id={`trash-section-${entryType}`}
          className="divide-y divide-gray-100 border-t border-gray-200"
        >
          {entries.map((entry) => (
            <TrashRow
              key={`${entry.entity_type}:${entry.id}`}
              entry={entry}
              busy={busyId === `${entry.entity_type}:${entry.id}`}
              onRestore={() => onRestore(entry)}
              onPermanentDelete={() => onPermanentDelete(entry)}
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
}

function TrashRow({ entry, busy, onRestore, onPermanentDelete }: TrashRowProps) {
  const displayName = buildDisplayName(entry);
  const deletedAtPretty = formatRelativeTime(entry.deleted_at);
  const expiresInLabel = formatExpiresIn(entry.auto_expires_at);
  return (
    <li className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">
          {displayName}
        </div>
        <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
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
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Restore
          </button>
        </Tooltip>
        <Tooltip label="Permanently delete (cannot be undone)" placement="top">
          <button
            type="button"
            onClick={onPermanentDelete}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
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
