/**
 * §6.1 First project — TRIGGER sub-step.
 *
 * First of two §6.1 sub-steps. BeakerBot points to the "+ New Project" button
 * in the Workbench header and waits for the user to open the create-project
 * form. Advances the moment `tour:home-create-modal-opened` fires (dispatched
 * by `NewProjectButton.tsx` on the button's onClick).
 *
 * Widget-framework teardown v2 (2026-06-02): the customizable widget canvas
 * that used to host the only "+ New Project" affordance was removed. Project
 * creation now lives on the Workbench header (and the curated Lab Overview
 * header) via the shared `NewProjectButton`, which still carries the
 * `home-new-project` anchor + dispatches `tour:home-create-modal-opened`. The
 * beat re-homes to `/workbench` (the universal surface every account type can
 * reach) so the spotlight resolves on a real button regardless of role.
 *
 * Top-level New Project rework (dashboard-newproject-tour bot, 2026-05-29):
 * Grant's model replaced the "open the Projects Overview widget, then create
 * inside it" flow with a persistent, widget-independent New Project button.
 * This TRIGGER beat leads the §6.1 cluster and spotlights that button (the
 * `home-new-project` anchor lives on it).
 *
 * Split rationale: Grant's v4 §6.1 walkthrough surfaced that BeakerBot's
 * speech never updated between "click the button" and "the project is
 * created." Splitting into trigger + fill sub-steps lets BeakerBot guide
 * each beat: highlight the button, then explain the name + color + the
 * seven-day-week toggle as soon as the form mounts.
 *
 * Per L11 gentle redirect: any click outside the expected target during
 * this step still works as a real product click (the spotlight is
 * visual, not blocking). The wrong-action handling is driven by the
 * tour controller's `interactedWithCurrentStep` flag, out of scope for
 * this file; the registry hookup is what wires the body in.
 *
 * Classification: USER ACTION (per Grant's design correction 2026-05-21).
 * Speech tells the user to "click the blue plus button". BeakerBot is
 * directing the user, not promising to do it himself. The spotlight on
 * the New Project button is the whole visual cue: a synthetic click
 * would steal the action and confuse the moment. No cursorScript here.
 *
 * Artifact tracking lives on the fill sub-step's completion, where the
 * project actually lands. This trigger step creates no artifact.
 */
import {
  buildWalkthroughStep,
  advanceOnEvent,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchHomeCreateModalOpened } from "./lib/tour-events";

export const homeCreateProjectStep = buildWalkthroughStep({
  id: "home-create-project",
  // Widget-framework teardown v2 (2026-06-02): the New Project button now
  // lives in the Workbench header (NewProjectButton.tsx), independent of any
  // widget. Speech points the user at that button; pose stays "pointing".
  speech:
    "Let's make your first project. Click the New Project button in your Workbench header. Every project starts with just a name and a color.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.homeNewProject),
  // Intentionally no cursorScript: BeakerBot tells the user to click;
  // the user clicks. A synthetic click would clash with the speech and
  // remove the user's agency on a simple first action. The spotlight
  // does the visual work.
  completion: advanceOnEvent(watchHomeCreateModalOpened),
  // Re-homed to /workbench (the universal create surface) so the
  // `home-new-project` anchor resolves on a real button after a refresh.
  expectedRoute: "/workbench",
});
