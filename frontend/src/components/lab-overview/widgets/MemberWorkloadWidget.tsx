"use client";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * sidebar widget — "Member workload at-a-glance." Stub for R2; R3
 * wires up open-task / overdue counts per member (proposal §3g).
 */
export default function MemberWorkloadWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  return (
    <div className="text-xs text-gray-400 italic">
      Member workload counts land in R3.
    </div>
  );
}
