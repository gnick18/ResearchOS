"use client";

/**
 * §6.7b Workbench Notes + Lists expansion (Workbench expansion manager
 * 2026-05-22; collapsed to 5 beats by Workbench fix manager R1
 * 2026-05-22; speech rewritten Wave 2C 2026-05-27 by v4 tour speech
 * manager — C per Grant's BEAKERBOT_TOUR_SCRIPT_REWRITE_2026-05-27.md;
 * collapsed to 2 beats 2026-06-03 by HR / tour-simplification).
 *
 * Two tour steps that sit between §6.7 hybrid editor and the §6.7c
 * methods cluster. Teaches the standalone Notes panel + the Lists
 * panel on the Workbench page. Both steps are universal (no
 * `conditionalOn`); both are explanation beats with manual advance
 * ("Got it, next").
 *
 * 2026-06-03 (HR / tour-simplification): Grant hand-walked the cluster
 * and found it overbuilt. The tool is UI-friendly enough that users
 * just need to know what notes and lists ARE (and the difference
 * between single notes and running logs); they can figure out usage on
 * their own. So the three BeakerBot demos were cut (the
 * note-creation demo, the coffee-restock list-build demo, and the
 * mark-list-done demo). The two surviving beats each click their tab
 * and explain the concept.
 *
 * Step order (matches TOUR_STEP_ORDER insertion):
 *   1. workbench-notes-intro  — cursor clicks Notes tab, explains
 *                               Single Notes vs Running Logs.
 *   2. workbench-lists-intro  — cursor clicks Lists tab, explains what
 *                               a list is.
 *
 * Why a single file: the two steps share the same skeleton (tab click
 * via cursorScript, manual advance, /workbench route). Splitting them
 * across two files would scatter the same shape.
 *
 * The Workbench page tabs ALREADY ship: tab buttons live on
 * `workbench/page.tsx` and are stamped with data-tour-target. The two
 * kept steps just click those tabs to take the user into each section.
 */
import {
  cursorScript,
  compactScript,
  safeClickAction,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { targetSelector, TOUR_TARGETS } from "./lib/targets";

// Step ids — module-level so the tests can import without hard-coding strings.
export const NOTES_INTRO_STEP_ID = "workbench-notes-intro";
export const LISTS_INTRO_STEP_ID = "workbench-lists-intro";

// ---------------------------------------------------------------------------
// 1. workbench-notes-intro — narration, cursor clicks Notes tab
// ---------------------------------------------------------------------------

export const workbenchNotesIntroStep = buildWalkthroughStep({
  id: NOTES_INTRO_STEP_ID,
  speech: (
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // applies Grant's new script copy. Frames the Notes tab via the
    // "not everything you write belongs to a specific experiment" lead,
    // then introduces Single Notes vs Running Logs with conference
    // examples. Replaces the prior PI 1-on-1 framing.
    <>
      <p className="mb-2">
        Not everything you write down belongs to a specific experiment.
        Conference takeaways, meeting notes, a paper you want to
        remember. The middle <strong>Notes</strong> tab in your
        Workbench is for that. Click it now.
      </p>
      <p>
        Two flavors live here. <strong>Single Notes</strong> are
        one-offs like a meeting, a paper summary, or a stray idea.{" "}
        <strong>Running Logs</strong> are for things that grow over
        time. One log per conference, one entry per talk, everything in
        one file instead of scattered across ten notes.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchNotesTab),
  cursorScript: cursorScript(async () => {
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchNotesTab),
      3000,
    );
    return compactScript([click]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});

// ---------------------------------------------------------------------------
// 2. workbench-lists-intro — narration, cursor clicks Lists tab
// ---------------------------------------------------------------------------

export const workbenchListsIntroStep = buildWalkthroughStep({
  id: LISTS_INTRO_STEP_ID,
  speech: (
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // applies Grant's new script lead. Frames a list as a "lightweight
    // task with a checklist inside", with reagent-restock /
    // errands-before-deadline / conference-prep examples.
    <>
      <p className="mb-2">
        Last tab on the Workbench is <strong>Lists</strong>.
      </p>
      <p className="mb-2">
        A list is a lightweight task with a checklist inside. Reach for
        one when the work is just &quot;do these things and check them
        off&quot;: a reagent restock, errands before a deadline, items
        to bring to a conference.
      </p>
      <p>No protocol, no results section. Just a name and a set of boxes to tick.</p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.workbenchListsTab),
  cursorScript: cursorScript(async () => {
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.workbenchListsTab),
      3000,
    );
    return compactScript([click]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
