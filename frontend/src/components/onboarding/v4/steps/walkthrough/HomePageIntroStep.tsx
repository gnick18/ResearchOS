/**
 * §6.1 Home page intro (transition-intro sub-bot, 2026-05-26).
 *
 * Pure-narration page intro inserted between `setup-wrapup` (modal-
 * contained Q wrap-up) and `home-create-project` (first user-action
 * beat on /). Per Grant's 2026-05-26 standing principle: every route
 * transition needs a BeakerBot intro that explains what the page is
 * for + the core concepts the user is about to encounter, BEFORE any
 * cursor demo or click prompt.
 *
 * Pre-fix the user finished the setup modal, landed on the home page,
 * and immediately heard "click the blue plus button to make your first
 * project" with no setup for what Home is, what a Project is on this
 * site, or why we are making one first.
 *
 * Shape:
 *   - `expectedRoute: "/"` triggers the route change (Welcome already
 *     pushed to "/", but this is the first walkthrough beat outside the
 *     modal shell, so we declare it for refresh-mid-tour safety).
 *   - No `cursorScript`, no `targetSelector` (speech-only).
 *   - `pose: "pointing"`.
 *   - `completion: manualAdvance("Got it, next")`.
 *
 * Voice anchor: HomeWidgetsCanvasIntroStep.tsx (lives on the same page,
 * fires later). Concept-first, multi-sentence pedagogical prose.
 * No em-dashes, no emojis.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const homePageIntroStep = buildWalkthroughStep({
  id: "home-page-intro",
  speech: (
    <>
      <p className="mb-2">
        Welcome to your Home page. This is the first thing you see
        whenever you open ResearchOS. It carries two ideas side by
        side: your <strong>projects</strong> (longer-running
        investigations, each with its own folder of experiments and
        notes) and your <strong>widget canvas</strong> (small at-a-
        glance tiles like upcoming tasks and today&apos;s events).
      </p>
      <p className="mb-2">
        A project is the top-level container for a line of work. A
        research question, a paper, a grant aim, a class assignment.
        Everything else (experiments, tasks, notes, results) lives
        inside a project, so making one is the very first thing we do.
      </p>
      <p>Let&apos;s make your first one together.</p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/",
});
