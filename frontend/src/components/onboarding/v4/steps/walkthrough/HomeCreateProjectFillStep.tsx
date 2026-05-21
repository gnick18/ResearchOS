/**
 * §6.1 Home page + first project — FILL sub-step.
 *
 * Second of two §6.1 sub-steps. Once the user opens the New Project form
 * (the trigger step's completion fires), BeakerBot explains the three
 * inputs that matter:
 *   1. project name
 *   2. project color
 *   3. the seven-day work week toggle (whether weekends count for
 *      scheduling, default off so the Gantt skips Sat/Sun for typical
 *      labs)
 *
 * Spotlight anchors on the form container so the user sees the whole
 * panel highlighted (name + color swatches + weekend toggle + Create
 * button all in one cutout). A separate per-input spotlight chain
 * would feel too click-driven for an explanation beat.
 *
 * Completes on `tour:project-created` (dispatched by
 * `projectsApi.create`) so the next step (§6.2 Project Overview) lands
 * the instant the project file hits disk. A polling watcher backs the
 * DOM event up for any code path that bypasses `projectsApi.create`.
 *
 * Classification: USER ACTION (per Grant's design correction 2026-05-21).
 * Speech tells the user to give the project a name, pick a color, then
 * click Create. BeakerBot is narrating the inputs, not doing them.
 * A typed-name cursor demo would be wrong here because the user is
 * picking their own real project name. No cursorScript: spotlight on
 * the whole form panel is enough.
 *
 * Artifact tracking: cleanup_default "keep" — the first project is
 * useful past the tour.
 *
 *   { type: "project", id: "<projectId>", cleanup_default: "keep" }
 *
 * Persisted by the cleanup grid (P8) reading
 * `wizard_resume_state.artifacts_created`; the actual append happens in
 * this step's completion handler (lifted into the TourController's
 * `noteEventFired` chain).
 */
import {
  buildWalkthroughStep,
  advanceOnEvent,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchProjectCreated } from "./lib/tour-events";

export const homeCreateProjectFillStep = buildWalkthroughStep({
  id: "home-create-project-fill",
  speech: (
    <>
      <p className="mb-2">
        Give your project a name and pick a color. Don&apos;t worry,
        these choices can always be changed later on.
      </p>
      <p>
        The seven-day work week toggle controls whether weekends count
        for scheduling. Most labs leave it off so the Gantt skips Sat
        and Sun. Turn it on if your work spans weekends. Click Create
        Project when you&apos;re ready.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.homeProjectCreateForm),
  // Intentionally no cursorScript — BeakerBot speaks; the user fills.
  // A typed-name cursor demo would be wrong here because the user is
  // picking their own real project name. Spotlight + speech is enough.
  completion: advanceOnEvent(watchProjectCreated),
  // Auto-navigate to home so the form anchor resolves on refresh.
  expectedRoute: "/",
});
