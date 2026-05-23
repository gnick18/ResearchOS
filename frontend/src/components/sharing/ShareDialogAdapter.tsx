"use client";

// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): an
// adapter that wraps `ShareDialog` with a "drop-in for SharePopup"
// interface. SharePopup's contract was:
//
//     <SharePopup
//       itemType="task" | "method" | "project"
//       itemId={N}
//       itemName="…"
//       currentOwner={owner}
//       currentSharedWith={[...SharedUser]}
//       isPublic={bool}
//       onShared={() => refetch()}
//     />
//
// The new ShareDialog takes a single `onSave(next, opts)` callback. To
// minimize callsite churn during the R1 migration window, this adapter
// computes the diff between the previous `shared_with` and the
// dialog-saved list, then calls the matching `sharingApi.X` / `unshareX`
// helpers under the hood. Callers wire `onShared` to their own refetch
// the same way they did with SharePopup.

import { useCallback } from "react";
import { sharingApi } from "@/lib/local-api";
import type { SharedUser } from "@/lib/types";
import ShareDialog, { type ShareDialogRecordType } from "./ShareDialog";
import { normalizeSharedWith } from "@/lib/sharing/unified";

export interface ShareDialogAdapterProps {
  isOpen: boolean;
  onClose: () => void;
  /** Same record types as SharePopup, plus the new ones the unified
   *  primitive adds: "note" | "link" | "goal" | "mass_spec_protocol". */
  recordType: ShareDialogRecordType;
  recordId: number;
  recordName: string;
  ownerUsername: string;
  currentSharedWith: SharedUser[];
  /** Called after the save completes (any case — partial failures still
   *  fire this so the caller refetches). */
  onShared: () => void;
}

export default function ShareDialogAdapter({
  isOpen,
  onClose,
  recordType,
  recordId,
  recordName,
  ownerUsername,
  currentSharedWith,
  onShared,
}: ShareDialogAdapterProps) {
  const handleSave = useCallback(
    async (next: SharedUser[]) => {
      const before = normalizeSharedWith(currentSharedWith);
      const after = normalizeSharedWith(next);

      const beforeMap = new Map(before.map((s) => [s.username, s.level]));
      const afterMap = new Map(after.map((s) => [s.username, s.level]));

      // 1. Compute additions / removals / level changes.
      const toAdd: SharedUser[] = [];
      const toRemove: string[] = [];

      for (const [u, lvl] of afterMap) {
        const prev = beforeMap.get(u);
        if (prev !== lvl) toAdd.push({ username: u, level: lvl });
      }
      for (const [u] of beforeMap) {
        if (!afterMap.has(u)) toRemove.push(u);
      }

      // 2. Dispatch to the right API per record type.
      //
      //   - task / method / project: per-recipient share/unshare calls
      //     (existing pattern; each call updates the receiver-side
      //     `_shared_with_me.json` + bell notification).
      //   - note / link / goal: R1b adds batched `shareX(id, recipients[])`
      //     that replaces the whole `shared_with` list in one write
      //     (no receiver-side manifest; discovery is canRead-driven).
      //   - mass_spec_protocol: not yet wired — falls through to a
      //     console.warn. Surfaces as the next R1c chip if needed.
      if (
        recordType === "task" ||
        recordType === "method" ||
        recordType === "project"
      ) {
        for (const entry of toAdd) {
          const data = {
            username: entry.username,
            level: entry.level,
          };
          if (recordType === "task") {
            await sharingApi.shareTask(recordId, data);
          } else if (recordType === "method") {
            await sharingApi.shareMethod(recordId, data);
          } else {
            await sharingApi.shareProject(recordId, data);
          }
        }
        for (const username of toRemove) {
          if (recordType === "task") {
            await sharingApi.unshareTask(recordId, username);
          } else if (recordType === "method") {
            await sharingApi.unshareMethod(recordId, username);
          } else {
            await sharingApi.unshareProject(recordId, username);
          }
        }
      } else if (
        recordType === "note" ||
        recordType === "link" ||
        recordType === "goal"
      ) {
        // Batched replacement: take the full `after` list as the new
        // truth. The new sharingApi.shareX helpers persist the whole
        // array in one disk write.
        const recipients = after.map((s) => ({
          username: s.username,
          level: s.level,
        }));
        if (recordType === "note") {
          await sharingApi.shareNote(recordId, recipients);
        } else if (recordType === "link") {
          await sharingApi.shareLink(recordId, recipients);
        } else {
          await sharingApi.shareGoal(recordId, recipients);
        }
      } else {
        console.warn(
          `[ShareDialogAdapter] record type "${recordType}" not yet wired ` +
            `into the per-type sharingApi. Pending R1c follow-up.`,
        );
      }

      // Lab Mode retirement R1d (R1d shared_with API manager,
      // 2026-05-23): the method `is_public` legacy mirror block was
      // removed. The dialog now writes to `shared_with` exclusively
      // via `sharingApi.shareMethod` / `unshareMethod`; the on-disk
      // `is_public` field is no longer maintained from the share
      // surface. Any remaining receiver-side read that still checks
      // the boolean is reading stale data, by design, for one
      // release of back-compat. The unified `canRead` /
      // `isWholeLabShared` helpers are the source of truth.

      onShared();
    },
    [recordType, recordId, currentSharedWith, onShared],
  );

  return (
    <ShareDialog
      isOpen={isOpen}
      onClose={onClose}
      recordType={recordType}
      recordId={recordId}
      recordName={recordName}
      ownerUsername={ownerUsername}
      currentSharedWith={currentSharedWith}
      onSave={handleSave}
    />
  );
}
