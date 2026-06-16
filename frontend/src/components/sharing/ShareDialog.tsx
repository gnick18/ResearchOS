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
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
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
  /** Unified Share entry point (2026-06-04): when true, render only the body
   *  and footer (no overlay, no title header). The UnifiedShareDialog owns the
   *  modal chrome and renders this as the "In your lab" tab. Defaults to false
   *  (standalone full-screen dialog). */
  embedded?: boolean;
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
  embedded = false,
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

  // Escape closes this dialog (app-wide convention). Skip in embedded mode:
  // the UnifiedShareDialog shell owns the overlay and its own Escape handling.
  useEscapeToClose(onClose, isOpen && !embedded);

  // Keep local state in sync with the prop when the dialog re-opens on a
  // different record.
  useEffect(() => {
    if (isOpen) {
      setShared(normalizeSharedWith(currentSharedWith));
      setAddUsername("");
      setAddLevel("edit");
      setCascadeToTasks(false);
      setError(null);
      // share-back user-action manager (2026-05-28): fire-and-forget tour
      // signal dispatched the instant the share dialog opens (the user
      // clicked Share on the popup). Tour simplification pass 4 2026-06-03
      // collapsed the §6.8 share-back field walk into one poll-gated beat,
      // so no gantt-share beat consumes this event today, but the dispatch
      // is kept (still exercised by watchShareDialogOpened's unit tests and
      // available for future tour surfaces). Mirrors the cheap CustomEvent
      // pattern the other tour surfaces use (tour:experiment-popup-opened,
      // tour:home-create-modal-opened). Costs one dispatch per dialog open
      // regardless of listeners; no-op when no tour is running.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tour:share-dialog-opened"));
      }
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
    // Notify the onboarding v4 share-back walkthrough beat that a user
    // was added to the in-dialog share list (the Add button only updates
    // local dialog state; Save persists). Cheap no-op when no tour is
    // active and SSR-safe.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tour:share-user-added", {
          detail: { username: addUsername, level: addLevel },
        }),
      );
    }
    setAddUsername("");
    setError(null);
  };

  const handleRemove = (username: string) => {
    setShared((prev) => removeSharedEntry(prev, username));
  };

  const handleSetLevel = (username: string, level: "read" | "edit") => {
    setShared((prev) =>
      prev.map((s) => (s.username === username ? { username, level } : s)),
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

  // The body + footer, shared by the standalone full-screen dialog and the
  // embedded (UnifiedShareDialog "In your lab" tab) mode. In embedded mode the
  // UnifiedShareDialog renders the outer chrome (overlay + title + close), so we
  // skip our own header here.
  const inner = (
    <>
        {/* PI hint */}
        {viewerIsLabHead && viewerUsername !== ownerUsername && (
          <div className="px-6 py-2 bg-amber-50 dark:bg-amber-500/15 border-b border-amber-200 dark:border-amber-500/30">
            <p className="text-meta text-amber-800 dark:text-amber-300">
              PI: you can see and edit this record regardless of these
              share entries.
            </p>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {/* Currently shared */}
          <div className="mb-4">
            <h3 className="text-body font-medium text-foreground mb-2">
              Currently shared with
            </h3>
            {shared.length === 0 ? (
              <p className="text-meta text-foreground-muted italic">
                Only you can see this {labelForType(recordType)}.
              </p>
            ) : (
              <div className="space-y-2">
                {shared.map((s) => (
                  <div
                    key={s.username}
                    className="bg-surface-sunken rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <SharedUserAvatar username={s.username} />
                        <div className="min-w-0">
                          <p className="truncate text-body font-medium text-foreground">
                            {s.username === WHOLE_LAB_SENTINEL
                              ? "Whole lab"
                              : `@${s.username}`}
                            {archivedSet.has(s.username) && (
                              <span className="ml-1 text-meta text-foreground-muted">
                                (archived)
                              </span>
                            )}
                          </p>
                          {/* Read/Edit segmented control: two explicit choices
                           *  instead of a hidden "click to toggle" text link, so
                           *  the current level is always visible and either side
                           *  is one tap away. */}
                          <div
                            role="group"
                            aria-label={`Access level for ${
                              s.username === WHOLE_LAB_SENTINEL
                                ? "the whole lab"
                                : `@${s.username}`
                            }`}
                            className="mt-1 inline-flex rounded-md border border-border bg-surface-raised p-0.5"
                          >
                            {(
                              [
                                { value: "read", label: "Can view" },
                                { value: "edit", label: "Can edit" },
                              ] as const
                            ).map((opt) => {
                              const active = s.level === opt.value;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() =>
                                    handleSetLevel(s.username, opt.value)
                                  }
                                  className={`rounded px-2.5 py-1 text-meta font-medium transition-colors ${
                                    active
                                      ? "bg-brand-action text-white shadow-sm"
                                      : "text-foreground-muted hover:text-foreground"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemove(s.username)}
                        className="shrink-0 text-meta font-medium text-foreground-muted hover:text-red-600"
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
                        className="mt-2 pt-2 border-t border-border text-meta text-foreground-muted"
                        data-testid="share-dialog-whole-lab-roster"
                      >
                        {wholeLabRoster.length === 0 ? (
                          <span className="italic text-foreground-muted">
                            No other active members in this lab yet.
                          </span>
                        ) : (
                          <>
                            <span className="text-foreground-muted">
                              Currently includes ({wholeLabRoster.length}):{" "}
                            </span>
                            <span className="text-foreground">
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
              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors text-body font-medium ${
                wholeLab
                  ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                  : "border-border text-foreground hover:bg-surface-sunken"
              }`}
              data-tour-target="share-dialog-whole-lab"
            >
              {wholeLab ? "Remove Whole-lab share" : "+ Share with the whole lab"}
            </button>
            <p className="text-meta text-foreground-muted mt-1">
              Whole-lab shares default to read-only. Toggle the level above
              after adding.
            </p>
          </div>

          {/* Add someone */}
          <div className="mb-4">
            <h3 className="text-body font-medium text-foreground mb-2">
              Add someone
            </h3>
            <div className="flex gap-2">
              <select
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                className="flex-1 px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                className="px-2 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-body"
                aria-label="Permission level for new share"
              >
                <option value="edit">Edit</option>
                <option value="read">Read</option>
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!addUsername}
                className="ros-btn-raise px-3 py-2 bg-brand-action text-white rounded-lg hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed text-body font-medium"
                data-tour-target="share-dialog-add"
              >
                Add
              </button>
            </div>
          </div>

          {/* Project-specific cascade option */}
          {recordType === "project" && (
            <div className="mb-4 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cascadeToTasks}
                  onChange={(e) => setCascadeToTasks(e.target.checked)}
                  className="mt-1 rounded border-amber-300 dark:border-amber-500/30 text-amber-600 dark:text-amber-300 focus:ring-amber-500"
                />
                <div>
                  <p className="text-body font-medium text-amber-800 dark:text-amber-300">
                    Also share all tasks in this project
                  </p>
                  <p className="text-meta text-amber-700 dark:text-amber-300">
                    Each task&apos;s sharing list will be updated to match.
                    New tasks added later are NOT auto-shared.
                  </p>
                </div>
              </label>
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
              <p className="text-body text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-foreground hover:bg-surface-sunken rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            data-tour-target="share-dialog-confirm"
            className="ros-btn-raise px-4 py-2 bg-brand-action text-white rounded-lg hover:bg-brand-action/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
    </>
  );

  // Embedded: the UnifiedShareDialog owns the overlay + title + close button, so
  // we return just the body/footer. The tour markers move to the unified shell.
  if (embedded) {
    return <div data-tour-target="share-dialog">{inner}</div>;
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]"
      data-tour-target="share-dialog"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="share-dialog"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-surface-raised rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-heading font-semibold text-foreground">
              Share {labelForType(recordType)}
            </h2>
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-foreground-muted hover:text-foreground-muted transition-colors"
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
          <p className="text-body text-foreground-muted mt-1 truncate">{recordName}</p>
        </div>
        {inner}
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
      <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-700 dark:text-emerald-300 text-title">
        *
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center">
      <span className="text-body font-medium text-blue-700 dark:text-blue-300">
        {username.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}
