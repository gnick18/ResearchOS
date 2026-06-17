"use client";

/**
 * Three-button delete-confirm modal per Q-A4 lock: when a method is part of
 * one or more compound methods, the user picks between "just delete the
 * method (compounds keep placeholders)" and "delete the method AND all the
 * compounds that use it".
 *
 * If the method isn't referenced by any compound, the caller short-circuits
 * to today's simple `confirm("Are you sure?")` flow — no extra friction on
 * the common case. The trigger lives in methods/page.tsx's handleDelete.
 */

import { useMemo, useState } from "react";
import type { Method } from "@/lib/types";
import LivingPopup from "@/components/ui/LivingPopup";

export interface AffectedCompound {
  id: number;
  owner: string;
  name: string;
}

interface DeleteMethodConfirmProps {
  /** Controlled open state. The parent toggles this so LivingPopup can play
   *  the zoom-out exit before the body unmounts. */
  open: boolean;
  /** The method the user is about to delete. */
  methodName: string;
  /** Compounds that reference the method-to-be-deleted. Pre-computed by
   *  the caller (methods/page.tsx) so this component stays presentational. */
  affectedCompounds: AffectedCompound[];
  onCancel: () => void;
  /** "Just delete this method" — compounds keep orphan placeholders where
   *  the deleted child rendered. The renderer's orphan band guides cleanup. */
  onJustDelete: () => void;
  /** "Delete this method AND the N compounds" — cascades the delete across
   *  every referencing compound. */
  onCascadeDelete: () => void;
}

/**
 * Discover the compounds in `allMethods` that reference the given method
 * by (method_id, owner). Used by methods/page.tsx to decide whether to
 * open this modal vs short-circuit to the simple confirm.
 */
export function findAffectedCompounds(
  methodId: number,
  methodOwner: string,
  allMethods: Method[],
): AffectedCompound[] {
  const out: AffectedCompound[] = [];
  for (const m of allMethods) {
    if (m.method_type !== "compound" || !m.components) continue;
    const referenced = m.components.some((c) => {
      const childOwner = c.owner ?? m.owner;
      return c.method_id === methodId && childOwner === methodOwner;
    });
    if (referenced) {
      out.push({ id: m.id, owner: m.owner, name: m.name });
    }
  }
  return out;
}

export function DeleteMethodConfirm({
  open,
  methodName,
  affectedCompounds,
  onCancel,
  onJustDelete,
  onCascadeDelete,
}: DeleteMethodConfirmProps) {
  // Snapshot the prop-driven body so it stays rendered through LivingPopup's
  // zoom-out exit after the parent clears `pendingDelete` (props go stale on
  // close). Synced during render, the RestoreParentPrompt idiom.
  const [shown, setShown] = useState<{
    methodName: string;
    affectedCompounds: AffectedCompound[];
  } | null>(open ? { methodName, affectedCompounds } : null);
  if (open && (shown?.methodName !== methodName || shown?.affectedCompounds !== affectedCompounds)) {
    setShown({ methodName, affectedCompounds });
  }

  const snapName = shown?.methodName ?? methodName;
  const snapCompounds = shown?.affectedCompounds ?? affectedCompounds;
  const compoundCount = snapCompounds.length;
  const compoundsLabel = useMemo(
    () => (compoundCount === 1 ? "1 kit" : `${compoundCount} kits`),
    [compoundCount],
  );

  return (
    <LivingPopup
      open={open}
      onClose={onCancel}
      label={`Delete ${snapName}`}
      widthClassName="max-w-lg"
      card={false}
    >
      <div className="bg-surface-raised rounded-xl ros-popup-card-shadow max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-title font-semibold text-foreground">
            Delete &ldquo;{snapName}&rdquo;?
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <p className="text-body text-foreground">
            <span className="font-medium">{snapName}</span> is part of {compoundsLabel}:
          </p>
          <ul className="border border-border rounded-lg overflow-hidden text-body divide-y divide-gray-100 bg-surface-sunken">
            {snapCompounds.map((c) => (
              <li key={`${c.owner}:${c.id}`} className="px-3 py-2">
                <span className="text-foreground font-medium">{c.name}</span>
                <span className="text-foreground-muted ml-2 text-meta">
                  (id {c.id}, owner {c.owner})
                </span>
              </li>
            ))}
          </ul>
          <p className="text-body text-foreground-muted pt-1">Choose one:</p>
          <div className="space-y-2">
            <button
              onClick={onJustDelete}
              className="w-full text-left px-4 py-3 border border-border rounded-lg hover:bg-surface-sunken"
            >
              <div className="text-body font-medium text-foreground">
                Just delete &ldquo;{snapName}&rdquo;
              </div>
              <div className="text-meta text-foreground-muted mt-1">
                Keeps the {compoundsLabel}; they will show
                &ldquo;Component deleted&rdquo; placeholders where it used to render.
                Existing experiments stay attached to the kits.
              </div>
            </button>
            <button
              onClick={onCascadeDelete}
              className="w-full text-left px-4 py-3 border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 rounded-lg hover:bg-red-100 dark:hover:bg-red-500/20"
            >
              <div className="text-body font-medium text-red-900">
                Delete &ldquo;{snapName}&rdquo; AND the {compoundsLabel}
              </div>
              <div className="text-meta text-red-700 dark:text-red-300 mt-1">
                Removes all {compoundCount + 1} method records. Experiments
                attached to any of those kits lose those attachments.
              </div>
            </button>
          </div>
        </div>
        <div className="flex justify-end px-6 py-4 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
          >
            Cancel
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
