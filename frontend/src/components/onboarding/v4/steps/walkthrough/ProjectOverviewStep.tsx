/**
 * §6.2 Project route Overview prose demo (PROSE sub-step).
 *
 * Second of three §6.2 sub-steps (NAV → PROSE → CONTEXT → EXIT). The
 * NAV sub-step (`project-overview-nav`) has just clicked the project
 * card on home and the browser is now on `/workbench/projects/<id>`.
 * BeakerBot teaches what the overview page is FOR (a project north
 * star), then glides the cursor onto the Overview textarea, focuses
 * it, and types a concrete placeholder hypothesis sentence at the
 * standard typing cadence. Manual advance (universal pacing rule,
 * Grant 2026-05-22) means BeakerBot demos NEVER auto-advance into
 * the next sub-step.
 *
 * Teaching rework (Grant 2026-05-22): the prior version typed a
 * one-line affirmation ("You are smart, confident...") then auto-
 * advanced. Cute but didn't teach anything. New shape:
 *   - speech explains WHY you come back to this page (north star,
 *     re-anchor on the goal when knee-deep in tasks)
 *   - speech announces "I'll type a placeholder hypothesis"
 *   - cursor types a real-shaped hypothesis a researcher might write
 *   - user reads it, clicks Got it, next when ready
 *   - the new CONTEXT sub-step then narrates the tags / status strip
 *
 * Split rationale (Grant 2026-05-21): the original §6.2 step tried to
 * click the project card AND type into the textarea in a single cursor
 * script. The route change unmounted the overlay mid-script, recreated
 * the cursor ref, and the cursor-script useEffect's `cancelled` cleanup
 * fired, so the type action never ran. Splitting into NAV + PROSE
 * mirrors §6.1's trigger / fill split: each cursor script runs against
 * a stable overlay mount.
 *
 * Classification: BEAKERBOT DEMO. Speech says "I'll type a placeholder
 * hypothesis", an explicit BeakerBot-led promise to type. The cursor
 * performs the typing as advertised.
 *
 * Cleanup default discard: this is throwaway placeholder prose, not a
 * real hypothesis. The cleanup grid (P8) reads `cleanup_default:
 * "discard"` and pre-unchecks the keep box.
 *
 *   { type: "overview_prose", id: "<projectId>", cleanup_default: "discard" }
 *
 * `expectedRoute` is intentionally undefined (see the prior-history
 * note at the bottom of this file). Nav happens in the NAV sub-step.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

/**
 * Real-shaped hypothesis placeholder. Replaces the prior affirmation
 * easter-egg ("You are smart, confident, and capable of anything you
 * put your mind to. - BeakerBot") because the affirmation, while cute,
 * didn't teach the user what the Overview is FOR. A concrete goal +
 * hypothesis lands harder: this is the shape of prose that belongs on
 * the Overview page, so the user can pattern-match when they write
 * their real one later.
 *
 * Exported for testability: the registry test pins the exact string
 * so a future copy edit surfaces via test failure rather than silent
 * drift.
 *
 * Easter-egg (kept in source, not user-visible): "You are smart,
 * confident, and capable of anything you put your mind to. - BeakerBot"
 */
export const PLACEHOLDER_HYPOTHESIS =
  "Goal: figure out the optimal annealing temperature for our PCR primer set. Hypothesis: 58°C will outperform the 56°C default.";

export const projectOverviewStep = buildWalkthroughStep({
  id: "project-overview-prose",
  speech:
    "This is your project's overview page. Treat it as your north star. When you're three weeks deep in tasks and methods, come back here to remember what you're actually trying to answer. I'll type a placeholder hypothesis to show what fits here. Your real goal goes here when you're ready.",
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewTextarea),
  cursorScript: cursorScript(async () => {
    // Click the Overview textarea to focus it, then type the placeholder
    // hypothesis. Both actions resolve against the same anchor; the
    // browser is already on the project route because the NAV sub-step
    // landed us here.
    const focusClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.projectOverviewTextarea),
      5000,
    );
    const typeAction = await safeTypeAction(
      targetSelector(TOUR_TARGETS.projectOverviewTextarea),
      PLACEHOLDER_HYPOTHESIS,
    );
    return compactScript([focusClick, typeAction]);
  }),
  // Manual advance per universal pacing rule (Grant 2026-05-22):
  // BeakerBot demos no longer auto-advance. The user reads the typed
  // hypothesis at their own pace, then clicks Got it, next to move on
  // to the CONTEXT sub-step that narrates the tags / status strip.
  completion: manualAdvance("Got it, next"),
  // No expectedRoute (live-test R2 follow-up 2026-05-21): the bare
  // `/workbench/projects` push the previous version did navigates to a
  // 404 (the real route is `/workbench/projects/[id]` — we don't have
  // the id at controller-effect time). The previous step
  // `project-overview-nav` is responsible for driving the user onto
  // the right route via its cursor click; if a refresh strands the
  // user mid-step, the P12 Resume modal + Resume-404 mitigation handle
  // recovery, not this defensive push.
});

/**
 * Affirmation easter-egg (Grant 2026-05-22): the prior placeholder
 * hypothesis was BeakerBot's affirmation sentence. Kept as a code-level
 * easter-egg comment so the joke persists for code-divers without
 * showing up in the user-visible onboarding copy:
 *
 *   "You are smart, confident, and capable of anything you put your
 *    mind to. - BeakerBot"
 */
