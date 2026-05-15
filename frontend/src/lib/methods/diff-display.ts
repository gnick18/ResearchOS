/** Shared visual conventions for source-vs-snapshot diff display across all structured method types. */

// Visual conventions for "this value differs from the source method"
export const MODIFIED_CHIP_TEXT = "Modified from source";

// Tailwind classes for the chip itself (next to the editor section title)
export const MODIFIED_BADGE_CLASSES =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 ring-1 ring-amber-200";

// Per-row / per-cell highlighting
export const MODIFIED_CELL_CLASSES = "bg-amber-50 ring-1 ring-amber-200";
export const ADDED_ROW_CLASSES = "bg-green-50 ring-1 ring-green-200";
export const REMOVED_ROW_CLASSES = "bg-red-50 line-through opacity-60";

// Hover-tooltip text format
export function originalValueTooltip(originalValue: string | number): string {
  return `Originally: ${originalValue}`;
}
