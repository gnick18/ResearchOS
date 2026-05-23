"use client";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * sidebar widget — "Recent lab activity." Stub for R2; R3 fleshes it
 * out (ports `LabActivityPanel` into a compact 6-row feed per proposal
 * §3g). The placeholder card keeps the sidebar default layout
 * complete so PIs see all four PI-oriented widgets out of the box.
 */
export default function RecentActivityWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  return (
    <div className="text-xs text-gray-400 italic">
      Compact recent-activity feed lands in R3 (port of LabActivityPanel).
    </div>
  );
}
