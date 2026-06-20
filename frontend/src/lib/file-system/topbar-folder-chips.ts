// Top-bar folder picker: the pure "which chips, do we overflow" selector.
//
// The top-bar quick-switch shows up to a few inline folder chips. This module
// owns the ONE decision the chips component leans on, kept pure (no React, no
// IndexedDB) so it can be unit-tested without a DOM:
//
//   - Few folders (<= MAX_CHIPS total): show them ALL inline, no overflow caret.
//   - Many folders (> MAX_CHIPS): show up to MAX_CHIPS PINNED folders inline, but
//     ALWAYS include the active folder even when it is not pinned, and hand the
//     rest to the existing FolderSwitcher dropdown (the overflow caret).
//
// The cap on how many folders may be PINNED lives in the store
// (MAX_PINNED_FOLDERS); this module's MAX_CHIPS is the same number, kept local so
// the selector has no store import and stays trivially testable. The store is the
// enforcement point; this is purely presentation.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { RememberedFolder } from "./indexeddb-store";

/** The most inline chips the top bar shows at once (mirrors the store's
 *  MAX_PINNED_FOLDERS). */
export const MAX_CHIPS = 3;

/** The minimal shape the selector needs off a remembered folder. */
export type ChipFolder = Pick<RememberedFolder, "id" | "name"> & {
  pinned?: boolean;
};

export interface TopBarChipsResult<T extends ChipFolder> {
  /** The folders to render as inline chips, in input order. */
  chips: T[];
  /** True when there are more folders than fit inline, so the overflow caret
   *  (the existing FolderSwitcher dropdown) should render. */
  showOverflow: boolean;
}

/**
 * Decide which folders become inline chips and whether to show the overflow
 * dropdown caret, given the remembered set and the id of the active folder.
 *
 * Rules:
 *   - <= MAX_CHIPS folders total: every folder is a chip, no overflow.
 *   - > MAX_CHIPS folders: the pinned folders (first MAX_CHIPS of them, in input
 *     order) are chips, the active folder is force-included even if unpinned
 *     (replacing the last pinned slot when needed so the count never exceeds
 *     MAX_CHIPS), and the overflow caret always shows because there is more to
 *     reach. When the user has pinned nothing, the active folder alone is the
 *     single chip and everything else lives behind the caret.
 *
 * Input order is preserved (the caller sorts by recency upstream). Pure.
 */
export function selectTopBarChips<T extends ChipFolder>(
  folders: T[],
  activeId: string | null,
): TopBarChipsResult<T> {
  if (folders.length <= MAX_CHIPS) {
    return { chips: folders, showOverflow: false };
  }

  // More folders than fit. Take up to MAX_CHIPS pinned folders, in input order.
  const pinned = folders.filter((f) => f.pinned === true).slice(0, MAX_CHIPS);

  const active = activeId
    ? folders.find((f) => f.id === activeId) ?? null
    : null;

  let chips = pinned;
  if (active && !chips.some((f) => f.id === active.id)) {
    // Force-include the active folder. If the pinned set already fills every
    // slot, drop the last pinned chip to make room so we never exceed MAX_CHIPS;
    // otherwise just append it.
    if (chips.length >= MAX_CHIPS) {
      chips = [...chips.slice(0, MAX_CHIPS - 1), active];
    } else {
      chips = [...chips, active];
    }
  }

  // There are strictly more folders than chips here (length > MAX_CHIPS and
  // chips.length <= MAX_CHIPS), so the overflow caret always belongs.
  return { chips, showOverflow: true };
}
