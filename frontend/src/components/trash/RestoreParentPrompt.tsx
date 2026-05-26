// VCP R1 trash MVP notes (2026-05-26): the restore-with-parent prompt.
//
// OQ4 locks the default behavior to "Restore both" when a Note's
// Project is also in trash. R1 cannot actually trigger the prompt
// (Projects can't be trashed yet — that's R2), so the public hook is
// wired but currently always resolves to "just-this" without showing
// any UI. The prompt component IS wired so R2 just has to flip the
// detection logic in `useShouldPromptForParent` to surface real Project
// trash entries.

"use client";

import { useCallback } from "react";
import type { TrashIndexEntry } from "@/lib/trash";

/** Three-button outcome of the prompt. */
export type RestoreParentOutcome = "restore-both" | "just-this" | "cancel";

/** Check whether a parent-in-trash exists for the entry being restored.
 *
 *  R1: Always returns `null` (no parent entity type is trashable in R1).
 *  R2: Reads the entry's `parent_entity_type` + `parent_id`, walks the
 *  index for that owner, and returns the matching parent trash entry
 *  if present. */
export async function findParentInTrash(
  username: string,
  entry: TrashIndexEntry,
): Promise<TrashIndexEntry | null> {
  void username;
  // R1 stub. Only Notes can land in trash, so a Note's parent
  // (project) is never trashed. R2 will flip this to a real index
  // walk by entry.parent_entity_type + entry.parent_id.
  if (!entry.parent_id || !entry.parent_entity_type) return null;
  // The check is wired-but-passive for R1 so R2 can drop in the
  // real lookup without touching the UI.
  return null;
}

/** Hook that resolves the prompt outcome. Used by the trash UI's
 *  Restore button so the same call site keeps working in R2.
 *
 *  Returns a function that the caller awaits before issuing the
 *  underlying `restoreEntity` call. R1: always resolves to "just-this"
 *  (no parent will ever surface from `findParentInTrash`). R2: opens
 *  a modal dialog and awaits the user's choice. */
export function useResolveRestoreParent(): (
  username: string,
  entry: TrashIndexEntry,
) => Promise<RestoreParentOutcome> {
  return useCallback(async (username, entry) => {
    const parent = await findParentInTrash(username, entry);
    if (!parent) return "just-this";
    // R2 plug-in point: open a modal here. For R1 the branch is
    // unreachable.
    return "restore-both";
  }, []);
}

// Re-export for tests + future R2 integration.
export type ParentResolver = (
  username: string,
  entry: TrashIndexEntry,
) => Promise<RestoreParentOutcome>;
