"use client";

// Version Control Phase 3 (shared-generalization): the entity-agnostic restore
// controller. Lifted VERBATIM from NoteDetailPopup's restore handlers so Notes
// behavior is byte-for-byte unchanged; the per-entity chips reuse this hook by
// passing their own {entityType, api, immutableKeys}.
//
// What it owns (all behavior-identical to the Notes Phase 2 controller):
//   - reconstructTarget: reverse-walk from the LIVE HEAD (canonicalized from the
//     on-disk record, NOT reconstructState) to a target version,
//   - the Case-C HistoryCompactedTargetError handling (folded-away target),
//   - canonicalToPayload: parse the reconstructed canonical into a restore
//     payload, dropping the entity's immutable keys (id / created_at / ...),
//   - handleRestore: write the target back + stamp the 24h revert_undo_window +
//     stamp the row kind "revert", then run onAfterRestore (e.g. exit history),
//   - handleUndoRestore: reverse-walk to the PRE-restore version, clear the
//     window, stamp "undo-revert", with the edits-since confirm guard.
//
// What STAYS in the popup: reflecting the restored record into the local editor
// fields. The hook hands the updated record to `onUpdate`; the popup's onUpdate
// does the local-state reflection. The hook never touches editor state.

import { useCallback, useMemo, useState } from "react";
import {
  historyEngine,
  canonicalize,
  HistoryCompactedTargetError,
  type HistoryRow,
  type HistoryEditKind,
} from "@/lib/history";
import type { RevertUndoWindow } from "@/lib/types";

/**
 * The minimal record shape the hook restores. Entities pass their own record
 * type; it must carry an id, the owner field, and the optional undo window.
 */
export interface RestorableRecord {
  id: number;
  username?: string;
  revert_undo_window?: RevertUndoWindow | null;
}

/** History metadata threaded to the entity's *Api.update (FLAG-5 shape). */
interface HistoryMeta {
  kind: HistoryEditKind;
  revert_target_version?: number;
}

/**
 * The minimal entity API the hook needs. Mirrors notesApi: a `get` that reads
 * the live record (optionally for a specific owner folder) and an `update` that
 * threads the historyMeta stamp. Both are generic over the record + payload.
 */
export interface VersionRestoreApi<T extends RestorableRecord> {
  get(id: number, owner?: string): Promise<T | null | undefined>;
  update(
    id: number,
    payload: Record<string, unknown>,
    historyMeta?: HistoryMeta,
  ): Promise<T | null | undefined>;
}

export interface UseVersionRestoreArgs<T extends RestorableRecord> {
  /** Entity type / history-file namespace, e.g. "notes". */
  entityType: string;
  /** The live record (HEAD source for the reverse-walk + owner/id). */
  record: T;
  /** Numeric record id. */
  id: number;
  /** Owner folder the history file lives under. */
  owner: string;
  /** The entity API (get + update). */
  api: VersionRestoreApi<T>;
  /** Signed-in user, credited as reverted_by when present. */
  currentUser: string | null | undefined;
  /** Hand the freshly-written record up (the popup reflects it into editor state). */
  onUpdate: (record: T) => void;
  /**
   * Keys stripped from the reconstructed canonical when building the restore
   * payload (never overwritten). For Note: ["id", "created_at", "username"].
   */
  immutableKeys: string[];
  /** Optional: run AFTER a successful restore (e.g. the popup exits history). */
  onAfterRestore?: () => void;
}

export interface UseVersionRestoreResult {
  /** Fire a restore to `targetVersion` (the sidebar onRestore handler). */
  handleRestore: (targetVersion: number) => Promise<void>;
  /** Undo the active restore (returns the record to its pre-restore version). */
  handleUndoRestore: () => Promise<void>;
  /** The live undo window, or null. */
  undoWindow: RevertUndoWindow | null;
  /** True while the undo window is present + unexpired. */
  undoWindowActive: boolean;
  /** User-facing restore error string (null = none). */
  restoreError: string | null;
  /** Imperatively clear the restore error (e.g. on close). */
  setRestoreError: (msg: string | null) => void;
}

export function useVersionRestore<T extends RestorableRecord>({
  entityType,
  record,
  id,
  owner,
  api,
  currentUser,
  onUpdate,
  immutableKeys,
  onAfterRestore,
}: UseVersionRestoreArgs<T>): UseVersionRestoreResult {
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Reverse-walk from HEAD to `targetVersion`, returning the canonical state
  // string AT the target. Throws HistoryCompactedTargetError (Case C) when the
  // target was folded into a boundary snapshot.
  //
  // HEAD canonical comes from the LIVE record on disk, NOT reconstructState: a
  // record that existed BEFORE its first tracked edit has a bare genesis
  // anchored at a non-empty pre-image, which reconstructState cannot resolve
  // without HEAD (the very thing we are deriving). The live record IS the HEAD,
  // so we canonicalize it directly. This also matches the post_hash on the
  // latest history row by construction (recordXHistory canonicalizes the same).
  const reconstructTarget = useCallback(
    async (rows: HistoryRow[], targetVersion: number): Promise<string> => {
      const liveHead = await api.get(id, owner || undefined);
      const headCanonical = canonicalize(liveHead ?? record);
      return historyEngine.reverseWalkTo(rows, targetVersion, headCanonical);
    },
    [api, id, owner, record],
  );

  // Parse a reconstructed canonical string into a full-state restore payload.
  // The canonical is the TRACKED state (denylist-stripped), so it carries every
  // structural field we restore. We drop the entity's immutable keys (never
  // overwritten) and never include `revert_undo_window` (denylisted, so it is
  // not in the canonical anyway).
  const canonicalToPayload = useCallback(
    (canonical: string): Record<string, unknown> => {
      const parsed = JSON.parse(canonical) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(parsed)) {
        if (immutableKeys.includes(key)) continue;
        out[key] = parsed[key];
      }
      return out;
    },
    [immutableKeys],
  );

  // Restore: write the target version back as the live record + open a 24h undo
  // window. Stamps the resulting history row kind "revert". After the write,
  // runs onAfterRestore (the popup exits the history sidebar so the restored
  // record is visible with the header "Undo restore" surfaced).
  const handleRestore = useCallback(
    async (targetVersion: number) => {
      setRestoreError(null);
      try {
        const rows = await historyEngine.readHistory(entityType, owner, id);
        if (rows.length === 0) return;
        const headVersion = rows.length - 1;
        let targetCanonical: string;
        try {
          targetCanonical = await reconstructTarget(rows, targetVersion);
        } catch (err) {
          if (err instanceof HistoryCompactedTargetError) {
            // Case C: the target was folded away. Offer the boundary fallback
            // (the closest reachable saved point, reverseWalkTo(rows, 0)).
            setRestoreError(
              "That version was summarized to keep history fast and can no longer be restored exactly. The earliest saved point is still available from the summarized group.",
            );
            return;
          }
          throw err;
        }
        const payload = canonicalToPayload(targetCanonical);
        const nowIso = new Date().toISOString();
        const expiresIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        payload.revert_undo_window = {
          from_version: headVersion,
          to_version: targetVersion,
          reverted_at: nowIso,
          expires_at: expiresIso,
          reverted_by: currentUser ?? record.username ?? "",
        } satisfies RevertUndoWindow;
        const updated = await api.update(id, payload, {
          kind: "revert",
          revert_target_version: targetVersion,
        });
        if (updated) {
          onUpdate(updated);
        }
        // Exit history: surface the live restored record + the Undo button.
        onAfterRestore?.();
      } catch (err) {
        console.error("[useVersionRestore] restore failed:", err);
        setRestoreError("Could not restore that version. Please try again.");
      }
    },
    [
      entityType,
      owner,
      id,
      record.username,
      currentUser,
      reconstructTarget,
      canonicalToPayload,
      api,
      onUpdate,
      onAfterRestore,
    ],
  );

  // The live undo window, if present + unexpired. `now` is read at render; the
  // render gate (and this) drops an expired window without a background timer.
  const undoWindow = record.revert_undo_window ?? null;
  const undoWindowActive =
    !!undoWindow && Date.now() < new Date(undoWindow.expires_at).getTime();

  // Undo restore: reverse-walk to the PRE-restore version (from_version), write
  // it back, clear the window, stamp the row kind "undo-revert". Confirms first
  // if edits landed since the restore. Case C on the undo walk clears the window
  // (the pre-restore point was folded away) + messages.
  const handleUndoRestore = useCallback(async () => {
    if (!undoWindow) return;
    setRestoreError(null);
    try {
      const rows = await historyEngine.readHistory(entityType, owner, id);
      if (rows.length === 0) return;
      // Edits-since guard: the restore wrote a row at from_version+1, so the
      // undo target (from_version) is the second-to-last row if nothing has
      // been edited since the restore. If MORE rows exist past the restore row,
      // the user kept editing; confirm before discarding that work.
      const restoreRowIndex = undoWindow.from_version + 1;
      const editsSince = rows.length - 1 - restoreRowIndex;
      if (
        editsSince > 0 &&
        !confirm(
          "You have edited this note since the restore. Undoing will discard those edits and return the note to its pre-restore state. Continue?",
        )
      ) {
        return;
      }
      let preRestoreCanonical: string;
      try {
        preRestoreCanonical = await reconstructTarget(rows, undoWindow.from_version);
      } catch (err) {
        if (err instanceof HistoryCompactedTargetError) {
          // Case C: the pre-restore version was folded away. We cannot undo
          // exactly; clear the window so the stale button disappears + message.
          await api.update(id, { revert_undo_window: null });
          const cleared = await api.get(id, owner || undefined);
          if (cleared) onUpdate(cleared);
          setRestoreError(
            "The pre-restore version was summarized and can no longer be undone automatically. The undo window has been closed.",
          );
          return;
        }
        throw err;
      }
      const payload = canonicalToPayload(preRestoreCanonical);
      payload.revert_undo_window = null; // clear the window
      const updated = await api.update(id, payload, {
        kind: "undo-revert",
        revert_target_version: undoWindow.from_version,
      });
      if (updated) {
        onUpdate(updated);
      }
    } catch (err) {
      console.error("[useVersionRestore] undo-restore failed:", err);
      setRestoreError("Could not undo the restore. Please try again.");
    }
  }, [
    undoWindow,
    entityType,
    owner,
    id,
    reconstructTarget,
    canonicalToPayload,
    api,
    onUpdate,
  ]);

  return useMemo(
    () => ({
      handleRestore,
      handleUndoRestore,
      undoWindow,
      undoWindowActive,
      restoreError,
      setRestoreError,
    }),
    [
      handleRestore,
      handleUndoRestore,
      undoWindow,
      undoWindowActive,
      restoreError,
    ],
  );
}
