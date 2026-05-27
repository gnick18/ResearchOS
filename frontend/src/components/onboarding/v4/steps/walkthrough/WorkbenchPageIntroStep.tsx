/**
 * §6.5 Workbench page intro (transition-intro sub-bot, 2026-05-26).
 *
 * Pure-narration page intro inserted between `methods-create` (last
 * /methods step) and `workbench-create-experiment-open` (first cursor /
 * user-action beat on /workbench). Per Grant's 2026-05-26 standing
 * principle: every route transition needs a BeakerBot intro that
 * explains what the page is for + the core concepts the user is about
 * to encounter, BEFORE any cursor demo or click prompt.
 *
 * Pre-fix the user landed on /workbench and immediately saw BeakerBot's
 * cursor clicking "+ New Experiment" with no setup for what Workbench is
 * or what an "experiment task" means in this app. Jarring + opaque.
 *
 * Shape:
 *   - `expectedRoute: "/workbench"` triggers the route change.
 *   - No `cursorScript`, no `targetSelector` (speech-only per
 *     step-types.ts:142 "undefined target = speech-only").
 *   - `pose: "pointing"` (default pose for narration beats).
 *   - `completion: manualAdvance("Got it, next")`.
 *
 * Voice anchor: HomeWidgetsCanvasIntroStep.tsx (§6.2b cousin). Concept-
 * first, multi-sentence pedagogical prose. No em-dashes, no emojis.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const workbenchPageIntroStep = buildWalkthroughStep({
  id: "workbench-page-intro",
  speech: (
    <>
      <p className="mb-2">
        This is your Workbench. Think of it as your day-to-day list of
        everything in flight: experiments, tasks, notes, and lists.
        Whenever you sit down to work, this is where you check what
        you&apos;re on the hook for.
      </p>
      <p className="mb-2">
        Two task shapes live here. A regular{" "}
        <strong>task</strong> is the simple kind, a one-line item you
        check off. An <strong>experiment</strong> is the richer kind:
        same checkbox surface, plus lab notes in a markdown editor,
        results tracking, attached methods, and image support. Use
        experiments for anything you want to be able to look back on
        later.
      </p>
      <p>Let me create one with you so you can see how it works.</p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
