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

// Ring-only variants for non-tabular renderings (e.g. PCR's small colored
// gradient blocks, where an amber background would clash with the
// temperature-based block color). Composes with whatever bg the block
// already has.
export const MODIFIED_BLOCK_CLASSES = "ring-2 ring-amber-400 ring-offset-1";
export const ADDED_BLOCK_CLASSES = "ring-2 ring-green-400 ring-offset-1";

// Hover-tooltip text format
export function originalValueTooltip(originalValue: string | number): string {
  return `Originally: ${originalValue}`;
}
