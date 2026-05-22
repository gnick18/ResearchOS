"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Notes tab walkthrough.
 *
 * Lab Mode manager 2026-05-22. Inside the DemoLabModeViewer. Cursor
 * clicks the Notes tab; the lab-wide shared-notes panel mounts.
 *
 * CRITICAL DATA PREREQ: the demo bundle's shared-notes seed is a
 * separate parallel sub-bot. Until that lands, the Notes panel
 * inside this walk will be empty. Speech still narrates the feature
 * concept; the visual demo improves once the seed merges.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";

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
});
