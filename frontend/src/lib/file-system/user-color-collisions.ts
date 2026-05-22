// Helpers for the Settings color picker to detect collisions across users.
//
// Rules (locked with Grant 2026-05-22):
//   1. A SOLID color (primary only, secondary == null) is "taken" iff another
//      user has it as their primary AND that user has NO secondary.
//   2. A GRADIENT (primary + secondary) is "taken" iff another user has the
//      same unordered pair (blue→green == green→blue).
//   3. A user with a solid color does NOT block other users from picking that
//      same color as part of a gradient (e.g. Alice has solid blue; Bob can
//      still pick blue→green). Only solid-vs-solid and gradient-vs-gradient
//      collisions are disallowed.
//
// Self-contained — no React, no imports from local-api.ts.

import type { UserMetadataEntry } from "./user-metadata";

export interface ColorCombination {
  primary: string;
  /** null or undefined → solid. A non-empty string is the second gradient stop. */
  secondary?: string | null;
}

function normalizeHex(hex: string): string {
  return hex.trim().toLowerCase();
}

/**
 * Build a direction-insensitive key for a gradient. Sorting the two hex
 * strings makes "#aaa-#bbb" === "#bbb-#aaa" so reversal doesn't count as a
 * new combination.
 */
function gradientKey(a: string, b: string): string {
  const [x, y] = [normalizeHex(a), normalizeHex(b)].sort();
  return `${x}|${y}`;
}

/**
 * Returns true when `combo` is already in use by some OTHER user. Callers
 * are expected to pre-filter their own entry out of `byOtherUsers` (the
 * Settings picker passes a map that excludes `currentUser`). Tombstoned
 * (`deleted_at`) users should also be filtered out before calling — their
 * colors are free to reclaim.
 */
export function isCombinationTaken(
  combo: ColorCombination,
  byOtherUsers: Record<string, UserMetadataEntry>,
): boolean {
  const primary = normalizeHex(combo.primary);
  const secondary = combo.secondary ? normalizeHex(combo.secondary) : null;

  if (secondary === null) {
    // Solid: collides only with another user's solid of the same color.
    for (const entry of Object.values(byOtherUsers)) {
      const otherPrimary = normalizeHex(entry.color);
      const otherSecondary = entry.color_secondary
        ? normalizeHex(entry.color_secondary)
        : null;
      if (otherSecondary === null && otherPrimary === primary) return true;
    }
    return false;
  }

  // Gradient: collides only with another user's gradient with the same
  // unordered pair.
  const myKey = gradientKey(primary, secondary);
  for (const entry of Object.values(byOtherUsers)) {
    if (!entry.color_secondary) continue;
    const otherKey = gradientKey(entry.color, entry.color_secondary);
    if (otherKey === myKey) return true;
  }
  return false;
}

/**
 * Returns the set of palette swatches that are already taken as another
 * user's SOLID color (those swatches should be disabled in the Settings
 * Primary row when the current user has not picked a secondary yet).
 *
 * Note this only checks for solid-vs-solid collisions — picking such a
 * primary is fine as long as the user also picks a secondary that doesn't
 * collide. The Settings UI uses this for the "you can't go solid with this
 * color" hint only.
 */
export function takenSolidPrimaries(
  byOtherUsers: Record<string, UserMetadataEntry>,
): Set<string> {
  const taken = new Set<string>();
  for (const entry of Object.values(byOtherUsers)) {
    if (entry.color_secondary) continue;
    taken.add(normalizeHex(entry.color));
  }
  return taken;
}

/**
 * Returns the set of palette swatches that would form a TAKEN gradient
 * when paired with `currentPrimary`. The Secondary row in the Settings
 * picker disables these swatches.
 */
export function takenSecondariesFor(
  currentPrimary: string,
  byOtherUsers: Record<string, UserMetadataEntry>,
): Set<string> {
  const primary = normalizeHex(currentPrimary);
  const taken = new Set<string>();
  for (const entry of Object.values(byOtherUsers)) {
    if (!entry.color_secondary) continue;
    const a = normalizeHex(entry.color);
    const b = normalizeHex(entry.color_secondary);
    // If either side of the existing pair equals our currentPrimary, the
    // other side is the swatch that would re-create that pair.
    if (a === primary) taken.add(b);
    else if (b === primary) taken.add(a);
  }
  return taken;
}

/**
 * Returns the username that owns a given color combination — used by the
 * Settings UI to tooltip a disabled swatch with "Used by Morgan". Returns
 * null when no other user owns the combo.
 */
export function ownerOfCombination(
  combo: ColorCombination,
  byOtherUsers: Record<string, UserMetadataEntry>,
): string | null {
  const primary = normalizeHex(combo.primary);
  const secondary = combo.secondary ? normalizeHex(combo.secondary) : null;

  if (secondary === null) {
    for (const [username, entry] of Object.entries(byOtherUsers)) {
      const otherSecondary = entry.color_secondary
        ? normalizeHex(entry.color_secondary)
        : null;
      if (otherSecondary === null && normalizeHex(entry.color) === primary) {
        return username;
      }
    }
    return null;
  }

  const myKey = gradientKey(primary, secondary);
  for (const [username, entry] of Object.entries(byOtherUsers)) {
    if (!entry.color_secondary) continue;
    if (gradientKey(entry.color, entry.color_secondary) === myKey) {
      return username;
    }
  }
  return null;
}

/**
 * Strips the current user (and any tombstoned users) out of a metadata
 * map so the collision helpers work against the "other people" set only.
 * Tombstoned users are filtered because their colors are free for reuse
 * — they're hidden from the picker anyway.
 */
export function otherUsersOnly(
  all: Record<string, UserMetadataEntry>,
  currentUser: string,
): Record<string, UserMetadataEntry> {
  const out: Record<string, UserMetadataEntry> = {};
  for (const [username, entry] of Object.entries(all)) {
    if (username === currentUser) continue;
    if (entry.deleted_at) continue;
    out[username] = entry;
  }
  return out;
}
