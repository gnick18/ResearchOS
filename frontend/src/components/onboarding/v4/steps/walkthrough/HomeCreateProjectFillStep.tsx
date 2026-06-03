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
import { watchProjectCreated, TOUR_DOM_EVENTS } from "./lib/tour-events";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "home-create-project-fill";

export const homeCreateProjectFillStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Give your project a name and pick a color. Don&apos;t worry,
        these choices can always be changed later.
      </p>
      <p>
        The seven-day work week toggle controls whether weekends count
        for your schedule. Most labs leave it off so the Gantt chart
        skips Saturday and Sunday. Click Create Project when you&apos;re
        ready.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.homeProjectCreateForm),
  // panel copy polish 2026-05-26: literal-reader bot reported that if
  // the form was dismissed mid-step, the recovery banner fell back to
  // the generic "the button you clicked before" — which has no
  // referent (the last button was the tour's own Next). Anchor the
  // recovery copy to the real re-entry button (widget-framework teardown
  // v2: now the Workbench header New Project button).
  recoveryHint: {
    buttonLabel: "the + New Project button in your Workbench header",
  },
  // Intentionally no cursorScript — BeakerBot speaks; the user fills.
  // A typed-name cursor demo would be wrong here because the user is
  // picking their own real project name. Spotlight + speech is enough.
  completion: advanceOnEvent(watchProjectCreated),
  // Capture the created project id from the `tour:project-created`
  // DOM event detail. The watcher itself doesn't expose the id (it's
  // a generic "fire on advance" callback), so we attach a sibling
  // listener on enter + tear it down on exit. The captured artifact
  // lands in the sidecar via `onExit`'s `flushPendingArtifacts` call.
  // Phase 4 cleanup grid (§6.17 + L24) picks it up via the
  // wizard_resume_state.artifacts_created list.
  onEnter: () => {
    if (typeof window === "undefined") return;
    const handler = (evt: Event) => {
      const id = (evt as CustomEvent<{ id?: number }>).detail?.id;
      if (id === undefined || id === null) return;
      pendingArtifactStore.add(STEP_ID, {
        type: "project",
        id: String(id),
        cleanup_default: "keep",
      });
      window.removeEventListener(TOUR_DOM_EVENTS.projectCreated, handler);
    };
    window.addEventListener(TOUR_DOM_EVENTS.projectCreated, handler);
  },
  onExit: async () => {
    // Resolve username via getCurrentUserCached inside flushPendingArtifacts.
    // Best-effort: a missing user clears the pending list without
    // persisting (test fixtures + the _no_user_ sentinel both no-op).
    await flushPendingArtifacts(STEP_ID);
  },
  // Re-homed to /workbench (the universal create surface) so the form
  // anchor resolves on refresh. On a successful create, NewProjectButton
  // navigates to the new project's page, which the next beat
  // (`project-overview-typing-demo`, the single project-page beat after
  // the 2026-06-03 tour-simplification collapse) frames and types into.
  expectedRoute: "/workbench",
});
