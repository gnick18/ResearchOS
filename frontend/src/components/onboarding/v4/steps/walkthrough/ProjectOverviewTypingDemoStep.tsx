/**
 * §6.2 Project page Overview beat: the SINGLE project-page beat
 * (collapse 2026-06-03, HR / tour-simplification).
 *
 * Grant hand-walked the project click-through and found it overbuilt:
 * four beats (nav narration, "four sections" prose, this typing demo,
 * topbar context). They were collapsed into this one beat. It now
 * absorbs the orientation line from the deleted `project-overview-nav`
 * and the Overview-box explanation from the deleted
 * `project-overview-prose`; the `project-overview-context` topbar beat
 * was cut entirely. This step keeps the cursor focus + type-placeholder
 * behavior it already owned, so BeakerBot still types a sample into the
 * Overview textarea at the standard typing cadence.
 *
 * Classification: BEAKERBOT_DEMO. Speech frames the page and the
 * Overview box, then says it will drop in a sample; the cursor performs
 * the typing as advertised.
 *
 * Cleanup default discard: throwaway placeholder prose, not a real
 * hypothesis. The cleanup grid (P8) reads `cleanup_default: "discard"`
 * and pre-unchecks the keep box.
 *
 *   { type: "overview_prose", id: "<projectId>", cleanup_default: "discard" }
 *
 * `expectedRoute` is intentionally undefined: the project id isn't
 * resolvable at module load. The §6.1 FILL create already navigated the
 * user onto `/workbench/projects/<id>`; refresh recovery is handled by
 * the P12 Resume modal + the Resume-404 mitigation, not by a hard push
 * here.
 *
 * Easter-egg (kept in source, not user-visible): "You are smart,
 * confident, and capable of anything you put your mind to. - BeakerBot"
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
 * Real-shaped hypothesis placeholder. Exported for testability: the
 * registry test pins the exact string so a future copy edit surfaces via
 * test failure rather than silent drift.
 *
 * Easter-egg (kept in source, not user-visible): "You are smart,
 * confident, and capable of anything you put your mind to. - BeakerBot"
 */
export const PLACEHOLDER_HYPOTHESIS =
  "Goal: figure out the optimal annealing temperature for our PCR primer set. Hypothesis: 58°C will outperform the 56°C default.";

export const projectOverviewTypingDemoStep = buildWalkthroughStep({
  id: "project-overview-typing-demo",
  speech: (
    <>
      <p className="mb-2">
        Here&apos;s the project you just made. Every experiment, method, and
        task you create attaches to a project, and this page is where it all
        comes back together.
      </p>
      <p className="mb-2">
        It&apos;s mostly empty now, but it fills in on its own as you add work
        to the project.
      </p>
      <p>
        The <strong>Overview</strong> box up top is the part you write
        yourself. The hypothesis, the motivation, why this project exists.
        I&apos;ll drop in a sample so you can see how it feels.
      </p>
    </>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.projectOverviewTextarea),
  cursorScript: cursorScript(async () => {
    // Click the Overview textarea to focus it, then type the placeholder
    // hypothesis. Both actions resolve against the same anchor; the
    // browser is already on the project route because the §6.1 FILL
    // create routed us straight to /workbench/projects/<id>.
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
  // Manual advance per universal pacing (Grant 2026-05-22): BeakerBot
  // demos no longer auto-advance. User reads the typed hypothesis,
  // clicks Got it, next. This is the single project-page beat now, so
  // the next click moves on to the notifications cluster.
  completion: manualAdvance("Got it, next"),
});
