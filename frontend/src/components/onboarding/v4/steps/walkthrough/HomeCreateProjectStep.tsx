/**
 * §6.1 Home page + first project — TRIGGER sub-step.
 *
 * First of two §6.1 sub-steps. BeakerBot points to the persistent top-level
 * "+ New Project" button on the dashboard toolbar and waits for the user to
 * open the create-project form. Advances the moment
 * `tour:home-create-modal-opened` fires (dispatched by `DashboardNewProject.tsx`
 * on the button's onClick).
 *
 * Top-level New Project rework (dashboard-newproject-tour bot, 2026-05-29):
 * Grant's decided model replaced the "open the Projects Overview widget, then
 * create inside it" flow with a persistent, widget-independent New Project
 * button on the dashboard header. The prior OPEN-WIDGET beat
 * (`home-open-projects-widget`) is retired; this TRIGGER beat now leads the
 * §6.1 cluster and spotlights the toolbar button directly (the
 * `home-new-project` anchor moved onto it).
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
  // Top-level New Project rework (dashboard-newproject-tour bot, 2026-05-29):
  // the New Project button is a persistent affordance at the top of the
  // dashboard toolbar (DashboardNewProject.tsx), independent of any widget.
  // Speech points the user at that toolbar button; pose stays "pointing".
  speech:
    "Let's make your first project. Click the New Project button at the top of your dashboard. Every project starts with just a name and a color.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.homeNewProject),
  // Intentionally no cursorScript: BeakerBot tells the user to click;
  // the user clicks. A synthetic click would clash with the speech and
  // remove the user's agency on a simple first action. The spotlight
  // does the visual work.
  completion: advanceOnEvent(watchHomeCreateModalOpened),
  // Auto-navigate to the home page when a refresh lands the user
  // somewhere else (Grant's refresh-mid-tour bug: BeakerBot pointed at
  // a "New Project" button that wasn't on the project page he was on).
  expectedRoute: "/",
});
