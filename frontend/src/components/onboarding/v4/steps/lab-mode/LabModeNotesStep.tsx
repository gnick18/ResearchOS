"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Notes tab walkthrough.
 *
 * Lab Mode manager 2026-05-22, enriched in Lab Mode fix manager R1
 * (2026-05-22). Beats:
 *
 *   1. Click the Notes tab so the lab-wide shared-notes grid mounts.
 *   2. (Deferred) click the first note card → NoteDetailPopup mounts.
 *   3. (Deferred) click the popup close button → popup dismisses.
 *
 * The shared-notes seed (separate sub-bot, 13 demo notes) populates
 * the grid; without it, the first-card anchor never mounts and the
 * deferred chain no-ops gracefully.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

const FIRST_CARD = `[data-tour-target="${TOUR_TARGETS.labModeNotesFirstCard}"]`;
const POPUP_CLOSE = `[data-tour-target="${TOUR_TARGETS.labModeNotePopupClose}"]`;

export const labModeNotesStep = buildLabModeTabStep({
  id: "lab-mode-notes",
  tabTarget: TOUR_TARGETS.labModeNotesTab,
  speech: (
    <>
      <p>
        Shared notes, meeting notes, running notes, anything someone
        marked as lab-wide visible.
      </p>
      <p>
        Notes can also be shared privately between two users, but
        those don&apos;t appear here on purpose.
      </p>
    </>
  ),
  additionalActions: async ({ deferredClickAction }) => {
    return [
      deferredClickAction(FIRST_CARD),
      deferredClickAction(POPUP_CLOSE),
    ];
  },
});
