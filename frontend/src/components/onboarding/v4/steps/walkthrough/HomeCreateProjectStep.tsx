/**
 * §6.1 Home page + first project — universal walkthrough step body.
 *
 * BeakerBot's cursor glides to the Home page's "+ New Project" button,
 * clicks it, and waits for the real modal to open. The user fills the
 * name + clicks Create. Step completes when `projectsApi.list()` count
 * grows (a poll-based watcher in `lib/tour-events.ts`).
 *
 * Per L11 gentle redirect: any click outside the expected target during
 * this step still works as a real product click (the spotlight is
 * visual, not blocking). The wrong-action handling is driven by the
 * tour controller's `interactedWithCurrentStep` flag — out of scope for
 * this file; the registry hookup is what wires the body in.
 *
 * Artifact tracking: cleanup_default "keep" — the first project is
 * useful past the tour.
 *
 *   { type: "project", id: "<projectId>", cleanup_default: "keep" }
 *
 * Persisted by the cleanup grid (P8) reading
 * `wizard_resume_state.artifacts_created`; the actual append happens in
 * the step's completion handler (lifted into the TourController's
 * `noteEventFired` chain so P5 doesn't double-write).
 */
import { cursorScript, safeClickAction, compactScript } from "./lib/cursor-script";
import {
  buildWalkthroughStep,
  advanceOnEvent,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchProjectCreated } from "./lib/tour-events";

export const homeCreateProjectStep = buildWalkthroughStep({
  id: "home-create-project",
  speech:
    "Let's make your first project. Click the blue plus button up there to get started.",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.homeNewProject),
  cursorScript: cursorScript(async () => {
    const click = await safeClickAction(
      targetSelector(TOUR_TARGETS.homeNewProject),
    );
    return compactScript([click]);
  }),
  completion: advanceOnEvent(watchProjectCreated),
});
