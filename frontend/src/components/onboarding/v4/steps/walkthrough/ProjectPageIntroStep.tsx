/**
 * §6.2 Project page intro (transition-intro sub-bot, 2026-05-26).
 *
 * Pure-narration page intro inserted between `project-overview-nav`
 * (the BeakerBot cursor click that navigates from "/" to the dynamic
 * `/workbench/projects/<id>` route) and `project-overview-prose` (the
 * cursor demo that types the placeholder hypothesis into the Overview
 * textarea). Per Grant's 2026-05-26 standing principle: every route
 * transition needs a BeakerBot intro that explains what the page is
 * for + the core concepts the user is about to encounter, BEFORE any
 * cursor demo or click prompt.
 *
 * Pre-fix the user landed on the project page after the cursor click
 * and immediately saw BeakerBot's cursor typing into a textarea. The
 * existing `project-overview-prose` step DID explain the page (north-
 * star metaphor) in its speech, but the speech and the cursor demo
 * ran in parallel, so a literal reader was being asked to read AND
 * watch at the same time. Splitting the conceptual setup out into a
 * pure narration beat lets the user absorb what a project page IS
 * before the typing starts.
 *
 * Shape:
 *   - NO `expectedRoute`. The project route is dynamic
 *     (`/workbench/projects/<id>`) and we don't have the id at module-
 *     load time. The previous step (`project-overview-nav`) is
 *     responsible for the navigation via its cursor click. Matches the
 *     existing `project-overview-prose` rationale (see
 *     ProjectOverviewStep.tsx:99 for the same decision).
 *   - No `cursorScript`, no `targetSelector` (speech-only).
 *   - `pose: "pointing"`.
 *   - `completion: manualAdvance("Got it, next")`.
 *
 * Voice anchor: HomeWidgetsCanvasIntroStep.tsx. Concept-first, multi-
 * sentence pedagogical prose. No em-dashes, no emojis.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const projectPageIntroStep = buildWalkthroughStep({
  id: "project-page-intro",
  speech: (
    <>
      <p className="mb-2">
        Here we are inside your project. Every project has its own
        page like this, and every page has the same shape: a sticky
        top bar with the project name, tags, and quick-action icons;
        an Overview area for the goal; and (further down) the
        experiments and notes that live inside this project.
      </p>
      <p className="mb-2">
        Treat the Overview as your north star. When you&apos;re three
        weeks deep in protocols and tasks, come back here to remember
        what question you&apos;re actually trying to answer.
      </p>
      <p>
        Let me drop in a placeholder hypothesis so you can see the
        shape of prose that fits here.
      </p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
});
