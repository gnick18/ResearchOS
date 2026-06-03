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
import { ensureExperimentPopupOpen } from "./lib/on-enter-helpers";

export const hybridNotesVsResultsStep = buildWalkthroughStep({
  id: "hybrid-notes-vs-results",
  speech: (
    <>
      <p className="mb-2">
        Every experiment has two separate places to write,{" "}
        <strong>Notes</strong> and <strong>Results</strong>.
      </p>
      <p className="mb-2">
        Notes is your working space while the experiment is running.
        Daily logs, what you tried, what broke, what to try next.
      </p>
      <p className="mb-2">
        Results is for the polished writeup once you&apos;re done.
        Final figures, the conclusions you&apos;d share with your PI
        or put in a paper.
      </p>
      <p>
        Same editor in both, but they stay separate. You can leave
        Notes as rough as you need without it ever ending up in
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
  // tour-popup-resilience bot 2026-06-03: this beat (and the whole §6.7
  // editor cluster) lives inside the experiment TaskDetailPopup, which a
  // mid-tour refresh closes (portal state, not a route). Reopen it before
  // the Notes-tab spotlight + cursor glide resolve. No-op on the canonical
  // path where the prior step left the popup open.
  onEnter: () => ensureExperimentPopupOpen(),
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
