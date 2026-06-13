// VCP R2 trash everywhere (2026-05-26): the restore-with-parent prompt.
//
// OQ4 locks the default behavior to "Restore both" when a child's parent
// (e.g. a Task's Project, a PurchaseItem's Task) is also in trash. R1
// stubbed this: `findParentInTrash` always returned null and the hook
// always resolved to "just-this". R2 lights it up:
//
//   1. `findParentInTrash` does a real index walk now. Given the
//      restoring entry's `parent_id` + `parent_entity_type`, it loads
//      the owner's trash index and returns the matching parent entry
//      when present.
//   2. `useResolveRestoreParent` mounts a modal dialog when a parent
//      surfaces, awaits the user's three-way choice ("Restore both",
//      "Just this record", "Cancel"), and returns the outcome.
//
// The "Restore both" branch is the responsibility of the caller (the
// trash page's restore handler iterates: restore parent first, then
// restore the child, so the child's `original_path` parent directory
// exists). This module is purely the prompt machinery.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listTrash, type TrashIndexEntry } from "@/lib/trash";
import LivingPopup from "@/components/ui/LivingPopup";
import Tooltip from "@/components/Tooltip";

/** Three-button outcome of the prompt. */
export type RestoreParentOutcome = "restore-both" | "just-this" | "cancel";

/** Walk the trash index for `username` and find the parent of `entry`
 *  if the parent is itself trashed. Returns null when no parent ref is
 *  set on the entry, or when the parent isn't in trash (which is the
 *  silent path — the caller just restores the child).
 *
 *  Owner scope: the parent must live in the SAME user's trash. Cross-
 *  owner parent restore is out of scope for R2 (it would require a
 *  multi-folder walk + cross-owner permissions check, neither of which
 *  ship in R2). */
export async function findParentInTrash(
  username: string,
  entry: TrashIndexEntry,
): Promise<TrashIndexEntry | null> {
  if (!entry.parent_id || !entry.parent_entity_type) return null;
  try {
    const all = await listTrash(username, entry.parent_entity_type);
    return (
      all.find(
        (e) =>
          e.entity_type === entry.parent_entity_type && e.id === entry.parent_id,
      ) ?? null
    );
  } catch (err) {
    console.warn("[restore-parent] findParentInTrash failed", err);
    return null;
  }
}

/** Shared module-level state for the singleton prompt. The hook reads
 *  from this state; the prompt component pulls from the same source so
 *  both render-trees see one source of truth. */
type PromptState =
  | { open: false }
  | {
      open: true;
      childEntry: TrashIndexEntry;
      parentEntry: TrashIndexEntry;
      resolve: (outcome: RestoreParentOutcome) => void;
    };

let promptState: PromptState = { open: false };
const stateSubs = new Set<() => void>();

function setPromptState(next: PromptState) {
  promptState = next;
  for (const sub of stateSubs) {
    try {
      sub();
    } catch (err) {
      console.warn("[restore-parent] subscriber threw", err);
    }
  }
}

function useSubscribePromptState(): PromptState {
  const [, force] = useState({});
  useEffect(() => {
    const sub = () => force({});
    stateSubs.add(sub);
    return () => {
      stateSubs.delete(sub);
    };
  }, []);
  return promptState;
}

/** Hook that resolves the prompt outcome. Used by the trash UI's
 *  Restore button so the same call site keeps working between R1 → R2.
 *
 *  R1 always resolved to "just-this". R2: when a parent surfaces in
 *  trash, opens a modal and awaits the user's choice. When no parent
 *  surfaces (the common case), resolves silently to "just-this". */
export function useResolveRestoreParent(): (
  username: string,
  entry: TrashIndexEntry,
) => Promise<RestoreParentOutcome> {
  return useCallback(async (username, entry) => {
    const parent = await findParentInTrash(username, entry);
    if (!parent) return "just-this";
    return await new Promise<RestoreParentOutcome>((resolve) => {
      setPromptState({
        open: true,
        childEntry: entry,
        parentEntry: parent,
        resolve: (outcome) => {
          setPromptState({ open: false });
          resolve(outcome);
        },
      });
    });
  }, []);
}

/** The modal component. Mount this ONCE at a top-level layout (the
 *  /trash route does this). It listens to the module-level prompt state
 *  and renders nothing until the hook opens it. */
export function RestoreParentPromptHost() {
  const state = useSubscribePromptState();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Retain the last open payload (child + parent + resolver) so the dialog
  // body stays rendered through LivingPopup's close animation after the
  // module state flips back to `{ open: false }`. Synced during render (no
  // ref read in render), the ExportFormatDialog idiom.
  const [shown, setShown] = useState<Extract<PromptState, { open: true }> | null>(
    state.open ? state : null,
  );
  if (state.open && state !== shown) setShown(state);

  // Focus the default action ("Restore both", OQ4) when the prompt
  // opens so the keyboard-only path defaults to the proposal answer.
  useEffect(() => {
    if (!state.open) return;
    const node = dialogRef.current;
    if (!node) return;
    const defaultBtn = node.querySelector<HTMLButtonElement>(
      "[data-restore-default]",
    );
    defaultBtn?.focus();
  }, [state.open]);

  // Close = cancel (matches the old backdrop click + Escape behavior). Use
  // the live state's resolver when open; fall back to the snapshot's so a
  // close during the exit animation still resolves the pending promise.
  const resolve = state.open ? state.resolve : shown?.resolve;

  const childEntry = shown?.childEntry;
  const parentEntry = shown?.parentEntry;
  const childName = childEntry ? displayNameFor(childEntry) : "";
  const parentName = parentEntry ? displayNameFor(parentEntry) : "";
  const parentTypeLabel = parentEntry
    ? parentEntry.entity_type.replace(/_/g, " ")
    : "";

  return (
    <LivingPopup
      open={state.open}
      onClose={() => resolve?.("cancel")}
      label="Restore parent too?"
      widthClassName="max-w-md"
      card={false}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-parent-title"
        className="bg-surface-raised rounded-lg shadow-xl w-full p-6 space-y-4"
      >
        <div className="space-y-1">
          <h2
            id="restore-parent-title"
            className="text-heading font-semibold text-foreground"
          >
            Restore parent {parentTypeLabel} too?
          </h2>
          <p className="text-body text-foreground-muted">
            The parent <strong>{parentTypeLabel}</strong>{" "}
            <span className="font-medium">{parentName}</span> is also in trash.
            Restoring{" "}
            <span className="font-medium">{childName}</span> without its parent
            would leave it orphaned at its original location.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Tooltip label="Restores both the parent and this record" placement="top">
            <button
              type="button"
              data-restore-default
              onClick={() => resolve?.("restore-both")}
              className="w-full px-4 py-2 text-body font-medium rounded-md bg-brand-action text-white hover:bg-brand-action/90 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Restore both
            </button>
          </Tooltip>
          <Tooltip label="Restores only this record, leaves the parent in trash" placement="top">
            <button
              type="button"
              onClick={() => resolve?.("just-this")}
              className="w-full px-4 py-2 text-body rounded-md border border-border bg-surface-raised text-foreground hover:bg-surface-sunken focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              Just this record
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => resolve?.("cancel")}
            className="w-full px-4 py-2 text-body rounded-md text-foreground-muted hover:bg-surface-sunken focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Cancel
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}

/** Recover a readable name from the trash filename's slug suffix. Same
 *  helper the /trash row uses; kept in-file for the prompt's own copy. */
function displayNameFor(entry: TrashIndexEntry): string {
  const filename = entry.trash_path.split("/").pop() ?? "";
  const stem = filename.replace(/\.json$/, "");
  const dashIdx = stem.indexOf("-");
  const slug = dashIdx >= 0 ? stem.slice(dashIdx + 1) : "";
  if (!slug) return `Untitled ${entry.entity_type} #${entry.id}`;
  return slug.replace(/-/g, " ");
}

// Re-export for tests + R3+ integration.
export type ParentResolver = (
  username: string,
  entry: TrashIndexEntry,
) => Promise<RestoreParentOutcome>;
