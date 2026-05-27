/**
 * §6.7 HE-0 — Notes vs Results mental model (PROMOTED).
 *
 * Hybrid editor manager 2026-05-22. The notes-vs-results coda used to
 * be the LAST paragraph of the resize step, which made it easy to miss
 * (R7-D teaching audit). It's now the FIRST step in the §6.7 cluster
 * so the user reads it before any editor demo.
 *
 * Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
 * applies Grant's BEAKERBOT_TOUR_SCRIPT_REWRITE_2026-05-27.md copy.
 * Same structure (intro + Notes paragraph + Results paragraph + same-
 * editor coda), tightened wording for the messy-vs-clean framing.
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
        Every experiment splits your writing into two separate places,
        on purpose.
      </p>
      <p className="mb-2">
        <strong>Notes</strong> is the messy side. Daily logs, half-
        formed ideas, things that broke. Nobody else needs to read it.
      </p>
      <p className="mb-2">
        <strong>Results</strong> is the clean side. Final figures, the
        conclusion you would actually defend in a lab meeting. This is
        what you point people to.
      </p>
      <p>
        Same editor, but the two never bleed into each other. You can
        be sloppy in Notes without worrying about it showing up in
        Results.
      </p>
    </>
  ),
  pose: "pointing",
  // R1 fix-pass P1 #9: tighten the spotlight to the Notes tab
  // specifically instead of the whole tab container (which wraps
  // Details / Method / Items / Notes / Results — too wide for a step
  // whose speech specifically calls out the Notes-vs-Results pair).
  // The cursor's glide between Notes and Results in the cursor script
  // provides the visual pairing, so a single tight anchor on Notes is
  // sufficient.
  targetSelector: targetSelector(TOUR_TARGETS.experimentNotesTab),
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
