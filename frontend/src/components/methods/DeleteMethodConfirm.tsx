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

import { useEffect, useMemo } from "react";
import type { Method } from "@/lib/types";
import Tooltip from "@/components/Tooltip";

export interface AffectedCompound {
  id: number;
  owner: string;
  name: string;
}

interface DeleteMethodConfirmProps {
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
  methodName,
  affectedCompounds,
  onCancel,
  onJustDelete,
  onCascadeDelete,
}: DeleteMethodConfirmProps) {
  const compoundCount = affectedCompounds.length;
  const compoundsLabel = useMemo(
    () => (compoundCount === 1 ? "1 kit" : `${compoundCount} kits`),
    [compoundCount],
  );

  // Esc to cancel — mirrors the other modal patterns in the app (the
  // CreateMethodModal etc don't all have this but the delete flow is
  // higher-consequence so adding Esc-to-cancel is a free safety net).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="delete-method-confirm"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-title font-semibold text-gray-900">
            Delete &ldquo;{methodName}&rdquo;?
          </h3>
          <Tooltip label="Cancel" placement="bottom">
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <p className="text-body text-gray-700">
            <span className="font-medium">{methodName}</span> is part of {compoundsLabel}:
          </p>
          <ul className="border border-gray-200 rounded-lg overflow-hidden text-body divide-y divide-gray-100 bg-gray-50">
            {affectedCompounds.map((c) => (
              <li key={`${c.owner}:${c.id}`} className="px-3 py-2">
                <span className="text-gray-900 font-medium">{c.name}</span>
                <span className="text-gray-400 ml-2 text-meta">
                  (id {c.id}, owner {c.owner})
                </span>
              </li>
            ))}
          </ul>
          <p className="text-body text-gray-600 pt-1">Choose one:</p>
          <div className="space-y-2">
            <button
              onClick={onJustDelete}
              className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <div className="text-body font-medium text-gray-900">
                Just delete &ldquo;{methodName}&rdquo;
              </div>
              <div className="text-meta text-gray-500 mt-1">
                Keeps the {compoundsLabel}; they will show
                &ldquo;Component deleted&rdquo; placeholders where it used to render.
                Existing experiments stay attached to the kits.
              </div>
            </button>
            <button
              onClick={onCascadeDelete}
              className="w-full text-left px-4 py-3 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100"
            >
              <div className="text-body font-medium text-red-900">
                Delete &ldquo;{methodName}&rdquo; AND the {compoundsLabel}
              </div>
              <div className="text-meta text-red-700 mt-1">
                Removes all {compoundCount + 1} method records. Experiments
                attached to any of those kits lose those attachments.
              </div>
            </button>
          </div>
        </div>
        <div className="flex justify-end px-6 py-4 border-t border-gray-100">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-body text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
