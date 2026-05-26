"use client";

// VCP R1 trash MVP notes (2026-05-26): the /trash route. R1 renders the
// Notes-only tree; R2 extends to all eight entity types. Sort defaults
// to newest-deleted-first (OQ15). Per-entry actions: Restore /
// Permanent delete. Layout deliberately stays Settings-area in tone
// rather than competing with the top-nav surfaces.

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
  type TrashIndexEntry,
  type TrashSort,
} from "@/lib/trash";
import { useResolveRestoreParent } from "@/components/trash/RestoreParentPrompt";

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
  const resolveRestoreParent = useResolveRestoreParent();

  // Re-read the index whenever the active user changes. Auto-cleanup
  // already ran on folder-connect, so this read is just for the live
  // list state. State updates are scheduled into an async callback
  // (not the effect body) per the react-hooks/set-state-in-effect rule.
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

  const sortedEntries = useMemo(
    () => sortTrashEntries(entries, sort),
    [entries, sort],
  );

  const handleRestore = async (entry: TrashIndexEntry) => {
    if (!currentUser) return;
    const key = `${entry.entity_type}:${entry.id}`;
    setActionState({ busyId: key, error: null });
    try {
      // R1 stub — always resolves to "just-this" since no parent entity
      // type can be trashed yet. R2 lights up the prompt.
      const outcome = await resolveRestoreParent(currentUser, entry);
      if (outcome === "cancel") return;
      const restored = await restoreEntity(currentUser, entry.entity_type, entry.id);
      if (!restored) {
        setActionState({ busyId: null, error: "Restore failed" });
        return;
      }
      setEntries((prev) =>
        prev.filter(
          (e) => !(e.id === entry.id && e.entity_type === entry.entity_type),
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

        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg bg-white">
          {sortedEntries.map((entry) => (
            <TrashRow
              key={`${entry.entity_type}:${entry.id}`}
              entry={entry}
              busy={actionState.busyId === `${entry.entity_type}:${entry.id}`}
              onRestore={() => handleRestore(entry)}
              onPermanentDelete={() => handlePermanentDelete(entry)}
            />
          ))}
        </ul>
      </div>
    </AppShell>
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
          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] uppercase tracking-wide">
            {entry.entity_type.replace("_", " ")}
          </span>
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
  // trash_path looks like `_trash/notes/47-PCR-setup-for-compound.json`.
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
  // Never sentinel is a far-future date; treat anything > 100 years out
  // as Never.
  const yearsFromNow = (ms - Date.now()) / (365 * 24 * 60 * 60 * 1000);
  if (yearsFromNow > 100) return "Never expires";
  const diff = ms - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  if (days <= 1) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}
