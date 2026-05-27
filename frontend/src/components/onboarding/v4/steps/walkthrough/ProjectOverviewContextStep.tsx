/**
 * §6.2 Project route context sub-step (CONTEXT).
 *
 * Third of three §6.2 sub-steps in the walkthrough flow:
 *   NAV → PROSE → CONTEXT → EXIT
 *
 * Added 2026-05-22 (HR-dispatched: v4 §6.2 overview teach sub-bot) to
 * fix Grant's feedback that the original §6.2 was a one-liner
 * affirmation followed by "next" with no actual teaching. The new
 * shape: PROSE teaches the page's purpose + types a real-shaped
 * hypothesis; CONTEXT then narrates the project header strip (name,
 * tags, action icons) so the user knows where the project's metadata
 * lives at a glance.
 *
 * Classification: NARRATION (no cursor demo). BeakerBot points at the
 * sticky topbar and explains what lives there. No click, no type, no
 * glide — purely a "look at this surface" beat. Pose: `pointing` so
 * the user's eye is drawn toward the spotlight without the cursor
 * doing a redundant glide animation.
 *
 * Spotlight target: the sticky topbar div in `ProjectRoute.tsx`, which
 * contains the project name, archive/share/edit/delete buttons, the
 * tag chips strip, and the section nav (Overview / Results / Methods
 * / Activity links). Anchor wired via `targets.ts` (key
 * `projectOverviewTopbar`) and stamped on the topbar div in
 * `ProjectRoute.tsx`. The spotlight dims the rest of the page so the
 * user's attention lands on the project's metadata strip.
 *
 * Completion: manual ("Got it, next"). The user reads, then advances.
 * No event to listen for (no user action expected); no auto-advance
 * (universal pacing rule, Grant 2026-05-22).
 *
 * No expectedRoute: the user is already on `/workbench/projects/<id>`
 * thanks to the NAV sub-step. The EXIT sub-step that follows is the
 * one that pushes back to `/` for the §6.3 notifications surface.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const projectOverviewContextStep = buildWalkthroughStep({
  id: "project-overview-context",
  speech:
    "This topbar stays with you across the project. As you add tags or update the status, they appear here so you can always see a quick summary without scrolling.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewTopbar),
  // No cursorScript: pure narration. The spotlight on the topbar is
  // the visual cue; the cursor would just glide redundantly. Skipping
  // the cursor here also keeps the step trivially robust against any
  // re-render timing on the sticky topbar.
  completion: manualAdvance("Got it, next"),
});

