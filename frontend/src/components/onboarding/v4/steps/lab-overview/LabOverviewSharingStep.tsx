"use client";

/**
 * R4 Lab Overview tour — sharing primitive beat.
 *
 * R4 Lab Mode retirement (2026-05-23). Teaches the unified sharing
 * primitive that replaced the old per-record `is_public` flag + the
 * `/lab` pseudo-account aggregation. Every shareable record (task,
 * note, list, method, link, goal, project) now has the same Share
 * button on its detail popup, opening the unified `ShareDialog`.
 *
 * Two affordances inside the dialog:
 *   - "Whole lab" sentinel: share with everyone in the lab in one
 *     click. Replaces the old `is_public` toggle.
 *   - Per-user share: pick a teammate from the list, pick a permission
 *     (read or edit). Multiple per-user shares stack.
 *
 * No cursor demo on this beat: the share button lives on a per-record
 * popup that the user hasn't necessarily opened yet, and forcing them
 * through an artificial record-creation just for this teach would
 * derail the Lab Overview narrative. Pure narration; manual advance.
 * When a `data-tour-target="lab-overview-share-button"` anchor IS
 * mounted (a record's share button on a widget body), the cursor
 * glides to it as a visual cue, but the step does not require it.
 *
 * Gates on `picks.account_type === "lab"`.
 */
import type { TourStep } from "../../step-types";
import {
  cursorScript,
  safeGlideToElementAction,
  compactScript,
} from "../walkthrough/lib/cursor-script";
import {
  buildWalkthroughStep,
  manualAdvance,
} from "../walkthrough/lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "../walkthrough/lib/targets";

export const labOverviewSharingStep: TourStep = buildWalkthroughStep({
  id: "lab-overview-sharing",
  pose: "pointing",
  speech: (
    <div
      data-step-id="lab-overview-sharing"
      data-testid="lab-overview-sharing"
      className="space-y-2"
    >
      <p>
        One last concept. Every record you create (tasks, notes, lists,
        methods, links, goals) has a Share button on its detail popup.
        Same button, same dialog, every record type.
      </p>
      <p>
        Two ways to share. Pick <strong>Whole lab</strong> to make the
        record visible to everyone, or pick a teammate from the list to
        share one-to-one. You can stack as many per-user shares as you
        need, each at read or edit permission.
      </p>
      <p>
        As lab head you see everything regardless. Sharing is for your
        teammates&apos; visibility, not yours.
      </p>
    </div>
  ),
  // The selector is optional — when no widget body has stamped the
  // anchor (e.g. the user's canvas is empty), the cursor script
  // resolves to an empty action list and the step degrades to speech-
  // only narration.
  targetSelector: targetSelector(TOUR_TARGETS.labOverviewShareButton),
  cursorScript: cursorScript(async () => {
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.labOverviewShareButton),
    );
    return compactScript([glide]);
  }),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.account_type === "lab",
  expectedRoute: "/lab-overview",
});
