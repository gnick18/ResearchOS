"use client";

// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): the
// unified Share dialog. Replaces `SharePopup.tsx` 1:1 — every record
// type now uses ONE dialog with the same shape.
//
// What's new in R1 vs. the old SharePopup:
//   1. "Whole lab" chip — one-click toggle that pushes/pops the "*"
//      sentinel into shared_with. No more separate "is_public" flag
//      for methods; the dialog writes "*" entries directly.
//   2. Per-recipient read/edit toggle — each row has its own dropdown,
//      not just the new-entry input.
//   3. Multi-record-type support: "task" | "note" | "project" | "method"
//      | "link" | "goal". Each gets the same UX surface.
//      (Mira Batch 1 polish 2026-05-23: "mass_spec_protocol" was
//      accepted by the union but had no sharingApi backing — Save
//      completed silently with no disk write. Removed from the union
//      until a sharingApi.shareMassSpecProtocol helper lands. See
//      FOLLOW-UP (mira-batch1) in ShareDialogAdapter for the deferred
//      persist plumbing.)
//   4. Project records get an extra checkbox: "Also share all tasks
//      in this project" — explicit, not auto-cascading (per Grant
//      2026-05-23 OQ resolution).
//
// The actual write call goes through `sharingApi.shareX` / `unshareX`
// in `local-api.ts`. Future R1b will add `shareNote` / `shareLink` /
// `shareGoal` paths — for now, the dialog supports those record
// types in UI but the persist callback is provided by the caller via
// `onShared` (the caller knows which API to hit).

import { useCallback, useEffect, useMemo, useState } from "react";
import { usersApi } from "@/lib/local-api";
import Tooltip from "@/components/Tooltip";
import type { SharedUser } from "@/lib/types";
import { useArchivedUsers } from "@/hooks/useArchivedUsers";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import {
  WHOLE_LAB_SENTINEL,
  normalizeSharedWith,
  upsertSharedEntry,
  removeSharedEntry,
  isWholeLabShared,
} from "@/lib/sharing/unified";

export type ShareDialogRecordType =
  | "task"
  | "note"
  | "project"
  | "method"
  | "link"
  | "goal";

export interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recordType: ShareDialogRecordType;
  recordId: number;
  recordName: string;
  ownerUsername: string;
  currentSharedWith: SharedUser[];
  /** Called with the next shared_with array on every Save click. The
   *  caller is responsible for persisting the change to disk via the
   *  appropriate sharingApi.X / records-store path. */
  onSave: (next: SharedUser[], options?: { cascadeToTasks?: boolean }) => Promise<void> | void;
  /** Optional viewer username — when set + === ownerUsername, the
   *  "you are the owner" hint renders. */
  viewerUsername?: string;
  /** Optional flag: viewer is a Lab Head. Shows the implicit-view-all
   *  hint at the top of the dialog. */
  viewerIsLabHead?: boolean;
}

export default function ShareDialog({
  isOpen,
  onClose,
  recordType,
  recordId: _recordId,
  recordName,
  ownerUsername,
  currentSharedWith,
  onSave,
  viewerUsername,
  viewerIsLabHead = false,
}: ShareDialogProps) {
  const [users, setUsers] = useState<string[]>([]);
  const archivedSet = useArchivedUsers();
  // Lab head UX polish manager Bug 1 (2026-05-24): when "Whole lab" is
  // toggled on, expand to show the concrete list of current active
  // members the grant covers. Underlying behavior is unchanged — `*`
  // still lives-evaluates at read time via expandSharedWith — but the
  // user can now see WHO the grant currently includes.
  const labProfileMap = useLabUserProfileMap();
  const [shared, setShared] = useState<SharedUser[]>(() =>
    normalizeSharedWith(currentSharedWith),
  );
  const [addUsername, setAddUsername] = useState("");
  const [addLevel, setAddLevel] = useState<"read" | "edit">("edit");
  const [cascadeToTasks, setCascadeToTasks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep local state in sync with the prop when the dialog re-opens on a
  // different record.
  useEffect(() => {
    if (isOpen) {
      setShared(normalizeSharedWith(currentSharedWith));
      setAddUsername("");
      setAddLevel("edit");
      setCascadeToTasks(false);
      setError(null);
    }
  }, [isOpen, currentSharedWith]);

  const loadUsers = useCallback(async () => {
    try {
      const response = await usersApi.list();
      setUsers(response.users.filter((u) => u !== ownerUsername));
    } catch (err) {
      console.error("Failed to load users:", err);
    }
  }, [ownerUsername]);

  useEffect(() => {
    if (isOpen) loadUsers();
  }, [isOpen, loadUsers]);

  const wholeLab = useMemo(() => isWholeLabShared(shared), [shared]);

  // Bug 1: roster of currently active members the "Whole lab" grant
  // resolves to right now. Excludes the owner (they already have
  // implicit access) and archived users (filtered out at read time).
  // Recomputed reactively so adding/removing members elsewhere in the
  // session reflects the moment the dialog re-opens.
  const wholeLabRoster = useMemo(() => {
    const all = Object.keys(labProfileMap);
    return all
      .filter((u) => u !== ownerUsername && !archivedSet.has(u))
      .sort();
  }, [labProfileMap, archivedSet, ownerUsername]);

  const eligibleUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          !archivedSet.has(u) &&
          !shared.some((s) => s.username === u) &&
          u !== ownerUsername,
      ),
    [users, archivedSet, shared, ownerUsername],
  );

  const handleAdd = () => {
    if (!addUsername) {
      setError("Pick a user to share with.");
      return;
    }
    setShared((prev) => upsertSharedEntry(prev, addUsername, addLevel));
    setAddUsername("");
    setError(null);
  };

  const handleRemove = (username: string) => {
    setShared((prev) => removeSharedEntry(prev, username));
  };

  const handleToggleLevel = (username: string) => {
    setShared((prev) =>
      prev.map((s) =>
        s.username === username
          ? { username, level: s.level === "edit" ? "read" : "edit" }
          : s,
      ),
    );
  };

  const handleToggleWholeLab = () => {
    setShared((prev) =>
      isWholeLabShared(prev)
        ? removeSharedEntry(prev, WHOLE_LAB_SENTINEL)
        : upsertSharedEntry(prev, WHOLE_LAB_SENTINEL, "read"),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(shared, {
        cascadeToTasks: recordType === "project" ? cascadeToTasks : undefined,
      });
      onClose();
    } catch (err) {
      console.error("ShareDialog save failed", err);
      setError(
        (err as { message?: string })?.message ?? "Failed to save sharing.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]"
      data-tour-target="share-dialog"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Share {labelForType(recordType)}
            </h2>
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close share dialog"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </Tooltip>
          </div>
          <p className="text-sm text-gray-500 mt-1 truncate">{recordName}</p>
        </div>

        {/* Lab Head hint */}
        {viewerIsLabHead && viewerUsername !== ownerUsername && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200">
            <p className="text-xs text-amber-800">
              Lab Head: you can see and edit this record regardless of these
              share entries.
            </p>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {/* Currently shared */}
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Currently shared with
            </h3>
            {shared.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                Only you can see this {labelForType(recordType)}.
              </p>
            ) : (
              <div className="space-y-2">
                {shared.map((s) => (
                  <div
                    key={s.username}
                    className="bg-gray-50 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SharedUserAvatar username={s.username} />
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {s.username === WHOLE_LAB_SENTINEL
                              ? "Whole lab"
                              : `@${s.username}`}
                            {archivedSet.has(s.username) && (
                              <span className="ml-1 text-xs text-gray-400">
                                (archived)
                              </span>
                            )}
                          </p>
                          <button
                            type="button"
                            onClick={() => handleToggleLevel(s.username)}
                            className="text-xs text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
                          >
                            {s.level === "edit" ? "Can edit" : "Can read"} (click
                            to toggle)
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemove(s.username)}
                        className="text-red-500 hover:text-red-700 text-sm font-medium"
                        aria-label={`Remove access for ${s.username}`}
                      >
                        Remove
                      </button>
                    </div>
                    {/* Bug 1: when the "Whole lab" entry is in this row,
                     *  enumerate the active members the grant currently
                     *  covers so the owner can see who actually receives
                     *  the share today. Live-evaluated at read time, so
                     *  no extra writes — just visibility. */}
                    {s.username === WHOLE_LAB_SENTINEL && (
                      <div
                        className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-600"
                        data-testid="share-dialog-whole-lab-roster"
                      >
                        {wholeLabRoster.length === 0 ? (
                          <span className="italic text-gray-400">
                            No other active members in this lab yet.
                          </span>
                        ) : (
                          <>
                            <span className="text-gray-500">
                              Currently includes ({wholeLabRoster.length}):{" "}
                            </span>
                            <span className="text-gray-700">
                              {wholeLabRoster
                                .map((u) => `@${u}`)
                                .join(", ")}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Whole-lab shortcut */}
          <div className="mb-4">
            <button
              type="button"
              onClick={handleToggleWholeLab}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors text-sm font-medium ${
                wholeLab
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
              data-tour-target="share-dialog-whole-lab"
            >
              {wholeLab ? "Remove Whole-lab share" : "+ Share with the whole lab"}
            </button>
            <p className="text-xs text-gray-500 mt-1">
              Whole-lab shares default to read-only. Toggle the level above
              after adding.
            </p>
          </div>

          {/* Add someone */}
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Add someone
            </h3>
            <div className="flex gap-2">
              <select
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                data-tour-target="share-dialog-user-row"
              >
                <option value="">Pick a user…</option>
                {eligibleUsers.map((u) => (
                  <option key={u} value={u}>
                    @{u}
                  </option>
                ))}
              </select>
              <select
                value={addLevel}
                onChange={(e) =>
                  setAddLevel(e.target.value as "read" | "edit")
                }
                className="px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                aria-label="Permission level for new share"
              >
                <option value="edit">Edit</option>
                <option value="read">Read</option>
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!addUsername}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                data-tour-target="share-dialog-add"
              >
                Add
              </button>
            </div>
          </div>

          {/* Project-specific cascade option */}
          {recordType === "project" && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cascadeToTasks}
                  onChange={(e) => setCascadeToTasks(e.target.checked)}
                  className="mt-1 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    Also share all tasks in this project
                  </p>
                  <p className="text-xs text-amber-700">
                    Each task&apos;s sharing list will be updated to match.
                    New tasks added later are NOT auto-shared.
                  </p>
                </div>
              </label>
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            data-tour-target="share-dialog-confirm"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function labelForType(type: ShareDialogRecordType): string {
  switch (type) {
    case "task":
      return "task";
    case "note":
      return "note";
    case "project":
      return "project";
    case "method":
      return "method";
    case "link":
      return "link";
    case "goal":
      return "goal";
    default:
      return "record";
  }
}

function SharedUserAvatar({ username }: { username: string }) {
  if (username === WHOLE_LAB_SENTINEL) {
    return (
      <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-base">
        *
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
      <span className="text-sm font-medium text-blue-700">
        {username.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}
