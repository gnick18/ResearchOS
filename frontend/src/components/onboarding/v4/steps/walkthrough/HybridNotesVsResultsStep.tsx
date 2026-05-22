/**
 * §6.7 HE-0 — Notes vs Results mental model (PROMOTED).
 *
 * Hybrid editor manager 2026-05-22. The notes-vs-results coda used to
 * be the LAST paragraph of the resize step, which made it easy to miss
 * (R7-D teaching audit). It's now the FIRST step in the §6.7 cluster
 * so the user reads it before any editor demo.
 *
 * Speech: explain that this experiment has two places to write — Notes
 * for working scratch, Results for the published output — and that the
 * two stores are independent.
 *
 * Cursor: glides between the Notes and Results tabs to visually
 * distinguish them, then settles on Notes for the rest of the phase.
 *
 * Completion: manual ("Got it, next"). Pure narration + cursor demo, no
 * user action.
 *
 * No artifact at this step.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const hybridNotesVsResultsStep = buildWalkthroughStep({
  id: "hybrid-notes-vs-results",
  speech: (
    <>
      <p className="mb-2">
        Before we touch the editor: this experiment has two places to
        write.
      </p>
      <p className="mb-2">
        <strong>Notes</strong> is your working scratch. Half-formed
        thoughts, daily logs, what you tried, what failed.
      </p>
      <p className="mb-2">
        <strong>Results</strong> is the published output. Final figures,
        conclusions you&apos;d defend in a meeting.
      </p>
      <p>
        Same editor, separate stores. What you write on Notes stays on
        Notes; same for Results. Most people write daily in Notes and
        promote to Results when they&apos;re done.
      </p>
    </>
  ),
  pose: "pointing",
  // Spotlight the whole tab container so both Notes + Results read as
  // the subject of the speech. The cursor glides between the two
  // specific tabs underneath.
  targetSelector: targetSelector(TOUR_TARGETS.experimentTabContainer),
  cursorScript: cursorScript(async () => {
    const clickNotes = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentNotesTab),
      3000,
    );
    const clickResults = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentResultsTab),
      3000,
    );
    const settleOnNotes = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentNotesTab),
      3000,
    );
    return compactScript([clickNotes, clickResults, settleOnNotes]);
  }),
  completion: manualAdvance("Got it, next"),
});
