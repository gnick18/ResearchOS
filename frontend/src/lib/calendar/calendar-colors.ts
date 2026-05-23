/**
 * Shared 10-color palette for linked-calendar and native-calendar swatches.
 *
 * Hoisted out of CalendarFeedsModal so the sidebar's click-to-edit popover
 * (CalendarSidebar.tsx), the modal's "Add a calendar" form, and the native
 * "ResearchOS events" recolor popover can all draw from the same source.
 *
 * Order matters: index 0 is the historical default (`"#3b82f6"`) and is also
 * the hardcoded fallback for the native row when no override has been set.
 */
export const DEFAULT_CALENDAR_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

/** Default color for the native "ResearchOS events" row when the user has
 *  not picked an override via the sidebar swatch popover. Kept as a named
 *  constant so callers don't accidentally drift from the modal default. */
export const NATIVE_CALENDAR_DEFAULT_COLOR = DEFAULT_CALENDAR_COLORS[0];

/**
 * Returns the first palette color not present in `takenColors`. Falls back
 * to `DEFAULT_CALENDAR_COLORS[0]` when every palette entry is taken.
 *
 * Used by the "Add a calendar" form to seed the draft swatch with a color
 * that doesn't collide with any existing linked feed or the native row.
 */
export function pickFirstUnusedColor(takenColors: Iterable<string>): string {
  const taken = new Set<string>();
  for (const c of takenColors) {
    if (typeof c === "string" && c.length > 0) taken.add(c.toLowerCase());
  }
  for (const c of DEFAULT_CALENDAR_COLORS) {
    if (!taken.has(c.toLowerCase())) return c;
  }
  return DEFAULT_CALENDAR_COLORS[0];
}
