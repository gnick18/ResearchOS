// Single source for the DETERMINISTIC per-user color fallback.
//
// WHY THIS EXISTS:
//   The same "hash a username into a fixed 10-swatch hex palette" algorithm was
//   copy-pasted in three places that all must agree on what color a member with
//   no stored entry shows:
//     - user-metadata.ts hashColor (drives pickColor's hash branch and the
//       exported fallbackUserColor).
//     - colors.ts fallbackColorForUsername (the pre-folder picker / hook
//       fallback, useUserColors).
//     - lab-roster-materialize.ts pickColor hash branch (the color it ASSIGNS a
//       co-member who has none yet).
//   Because the palette array and the hash were duplicated, two surfaces could
//   silently diverge for a member with no stored color (e.g. if anyone edited
//   one copy of the palette). This module is the ONE place the algorithm lives so
//   the stored color and every fallback agree by construction.
//
// SCOPE: this is a behavior-preserving dedupe. The palette values and the hash
//   are byte-identical to what every caller used before, so no user's resolved
//   color changes. The stored _user_metadata.json shape is untouched: this
//   module never reads or writes the file, it only computes a deterministic
//   color from a key.
//
// DEPENDENCY-FREE: no React, no file-service, no write queue, no imports. Safe to
//   import from a leaf module (user-metadata.ts) without an import cycle.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * The hex-only swatch palette used for deterministic per-user color assignment
 * and the hash fallback. The rainbow sentinels are intentionally NOT here: they
 * are opt-in only (chosen via the color picker) and must never be auto-assigned.
 *
 * This array is the SINGLE source. user-metadata.ts (HEX_ONLY_PALETTE),
 * colors.ts (fallbackColorForUsername), and lab-roster-materialize.ts all derive
 * from it so a member's fallback color is identical no matter which surface
 * computes it.
 */
export const USER_COLOR_PALETTE: readonly string[] = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

/**
 * Deterministic palette color for a key (a username). Same key always returns
 * the same swatch, across every surface and across runs. This is the hash that
 * was previously duplicated as hashColor / fallbackColorForUsername / the
 * materialize hash branch.
 *
 * @param key the username (or any stable string identity) to color.
 */
export function deterministicUserColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_COLOR_PALETTE[Math.abs(hash) % USER_COLOR_PALETTE.length];
}

/**
 * Picks a palette color for a key, preferring an unused swatch before falling
 * back to the deterministic hash. Shared by the metadata auto-assign and the
 * roster materialize so "first unused swatch, then stable hash" is computed the
 * same way everywhere.
 *
 * @param taken the set of swatches already in use (only hex swatches matter; a
 *              caller that stores rainbow sentinels should not pass them since
 *              they are never in this palette anyway).
 * @param key   the username to color when every swatch is taken.
 */
export function pickUserColor(taken: Set<string>, key: string): string {
  for (const color of USER_COLOR_PALETTE) {
    if (!taken.has(color)) return color;
  }
  return deterministicUserColor(key);
}
