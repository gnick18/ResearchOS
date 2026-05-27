/**
 * §6.11 Search page intro (transition-intro sub-bot, 2026-05-26).
 *
 * Pure-narration page intro inserted between
 * `ai-helper-use-case-agentic` (last /settings step) and `search-demo`
 * (first /search beat, a cursor demo that types a query). Per Grant's
 * 2026-05-26 standing principle: every route transition needs a
 * BeakerBot intro that explains what the page is for + the core
 * concepts the user is about to encounter, BEFORE any cursor demo or
 * click prompt.
 *
 * Pre-fix the user came off Settings and immediately saw BeakerBot's
 * cursor typing into the search box, with the explainer copy embedded
 * INSIDE that same step's speech bubble while the cursor was running.
 * Reading and watching at the same time is jarring; this beat lets the
 * user absorb what /search is FOR before the demo fires.
 *
 * Shape:
 *   - `expectedRoute: "/search"` triggers the route change.
 *   - No `cursorScript`, no `targetSelector` (speech-only).
 *   - `pose: "pointing"`.
 *   - `completion: manualAdvance("Got it, next")`.
 *
 * Voice anchor: HomeWidgetsCanvasIntroStep.tsx. Concept-first, multi-
 * sentence pedagogical prose. No em-dashes, no emojis.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const searchPageIntroStep = buildWalkthroughStep({
  id: "search-page-intro",
  speech: (
    <>
      <p className="mb-2">
        This is your search page. One box, every kind of thing you
        own in ResearchOS: experiments, tasks, methods, notes,
        results, purchase orders. Type a few characters and matches
        from every surface show up side by side.
      </p>
      <p className="mb-2">
        Useful when you remember the name of a thing but not which
        page it lives on. Also useful when you remember a snippet of
        text but not the experiment it belonged to.
      </p>
      <p>
        Your account is pretty empty so the demo will be small.
        I&apos;ll type a query that matches the experiment we made
        earlier so you can see the shape of the results.
      </p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/search",
});
