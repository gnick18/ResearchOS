/**
 * §6.9 Settings page intro (transition-intro sub-bot, 2026-05-26).
 *
 * Pure-narration page intro inserted between `gantt-goals-overview`
 * (the last /gantt step) and `personalization-animations` (first
 * /settings beat, a cursor demo that picks the celebration theme). Per
 * Grant's 2026-05-26 standing principle: every route transition needs
 * a BeakerBot intro that explains what the page is for + the core
 * concepts the user is about to encounter, BEFORE any cursor demo or
 * click prompt.
 *
 * Pre-fix the user came off the Gantt page and immediately saw
 * BeakerBot's cursor click an animation tile with no setup for what
 * /settings IS or that there are multiple personalization clusters on
 * the page about to land.
 *
 * Shape:
 *   - `expectedRoute: "/settings"` triggers the route change.
 *   - No `cursorScript`, no `targetSelector` (speech-only).
 *   - `pose: "pointing"`.
 *   - `completion: manualAdvance("Got it, next")`.
 *
 * Voice anchor: HomeWidgetsCanvasIntroStep.tsx. Concept-first, multi-
 * sentence pedagogical prose. No em-dashes, no emojis.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const settingsPageIntroStep = buildWalkthroughStep({
  id: "settings-page-intro",
  speech: (
    <>
      <p className="mb-2">
        This is your Settings page. Anything you picked during setup
        lives here, plus the personalization knobs we haven&apos;t
        touched yet: color theme, completion animation, the AI Helper,
        and a few re-run controls.
      </p>
      <p className="mb-2">
        We&apos;re going to walk through the most fun ones first
        (animation theme, color theme), then the surface-by-surface
        narration that tells you where each setup option lives so you
        can change your mind later.
      </p>
      <p>
        Nothing here is permanent. Toggle anything off later and the
        related tab just hides.
      </p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});
