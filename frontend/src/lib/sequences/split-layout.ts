// Pure layout math for the /sequences left-list vs right-viewer split.
// Kept dependency-free so the clamp is unit-testable in isolation (the
// divider drag, localStorage restore, and focus toggle all funnel through
// clampListWidth so the panes can never collapse below their mins).

/** Default left-list width in px (22rem at the 16px root font size). */
export const DEFAULT_LIST_WIDTH = 352;

/** Hard minimum width for the left list (px). */
export const LIST_MIN_WIDTH = 240;

/** Soft maximum width for the left list (px); the real max also shrinks to
 *  keep the viewer above VIEWER_MIN_WIDTH on narrow windows. */
export const LIST_MAX_WIDTH = 560;

/** Minimum width the right viewer must always keep (px). */
export const VIEWER_MIN_WIDTH = 480;

/** localStorage key the dragged width persists under. */
export const LIST_WIDTH_STORAGE_KEY = "researchos:sequences:listWidth";

/**
 * Clamp a desired left-list width to the allowed range for a given container.
 *
 * The left list is clamped between LIST_MIN_WIDTH and a dynamic max that is
 * the smaller of LIST_MAX_WIDTH and (containerWidth - VIEWER_MIN_WIDTH), so
 * the viewer never drops below its own minimum. When the container itself is
 * too narrow to honor both mins, the list min wins (the viewer can dip below
 * its min only on a genuinely tiny window, never via dragging on a normal one).
 *
 * @param desired       The requested left-list width in px.
 * @param containerWidth Total available width of the split container in px.
 *                       Non-finite / non-positive values fall back to the
 *                       fixed LIST_MIN..LIST_MAX range (used pre-measurement).
 */
export function clampListWidth(desired: number, containerWidth: number): number {
  const safeDesired = Number.isFinite(desired) ? desired : DEFAULT_LIST_WIDTH;

  // Before the container is measured (e.g. SSR / first paint) fall back to the
  // static range so a restored value still gets sane bounds.
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return Math.min(Math.max(safeDesired, LIST_MIN_WIDTH), LIST_MAX_WIDTH);
  }

  // Dynamic max keeps the viewer at or above its min. Never let the max fall
  // below the list min (that would invert the range), so the list min wins on
  // a too-narrow container.
  const dynamicMax = Math.max(
    LIST_MIN_WIDTH,
    Math.min(LIST_MAX_WIDTH, containerWidth - VIEWER_MIN_WIDTH),
  );

  return Math.min(Math.max(safeDesired, LIST_MIN_WIDTH), dynamicMax);
}
