"use client";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * sidebar widget — "Pending lab head actions." Stub for R2; R3 wires
 * up purchase-approvals + flag-for-review + audit-acknowledge counts
 * (proposal §3g).
 */
export default function PiActionsWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  return (
    <div className="text-xs text-gray-400 italic">
      Purchase approvals + flag queue counts land in R3.
    </div>
  );
}
