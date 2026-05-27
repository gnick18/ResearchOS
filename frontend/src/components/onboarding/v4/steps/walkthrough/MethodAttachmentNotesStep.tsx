/**
 * §6.6 Method attachment NOTES sub-step (4 of 4).
 *
 * Hand-walk simplification (Grant 2026-05-27): the typing cursor was
 * dropped. Per Grant: "he doesn't need to add a variation note. I think
 * highlighting the area and explaining it is good enough." The
 * variation-notes field stays spotlighted and the mental-model speech
 * still lands; BeakerBot just doesn't type anything anymore.
 *
 * Critical mental-model moment per Grant's voice-to-text: editing a
 * method from inside an experiment edits THIS EXPERIMENT'S COPY. The
 * original method stays untouched. The speech is preserved verbatim
 * from the prior demo shape.
 *
 * This is the terminal id of the §6.6 split (replacing the original
 * single `experiment-attach-method` step). Telemetry / typeguards that
 * pinned the old id should reference `experiment-attach-method-notes`:
 * the "step completed" beat still fires at the same logical moment
 * (user has just attached a method and seen the variation-notes spot).
 *
 * Classification: NARRATION + SPOTLIGHT (experiment-flow fix manager,
 * 2026-05-27). No cursorScript: BeakerBot points at the variation-notes
 * field with the spotlight and explains. Pose changes from
 * `typing-on-laptop` (the prior cursor was typing) to `pointing` to
 * match the spotlight-only intent.
 *
 * Artifact: none here. The method_attachment artifact is captured by
 * the prior `experiment-attach-method-attach` sub-step.
 *
 * expectedRoute: "/workbench" — popup-portaled, no route change.
 */
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  ensureFirstExperimentExists,
  ensureFirstMethodExists,
} from "./lib/ensure-helpers";

export const methodAttachmentNotesStep = buildWalkthroughStep({
  id: "experiment-attach-method-notes",
  speech: (
    <>
      <p className="mb-2">
        You can also add quick variation notes here if you changed
        anything specific for this run.
      </p>
      <p>
        <strong>Important:</strong> when you edit a method from inside
        an experiment, you&apos;re only editing this experiment&apos;s
        COPY. Your original master protocol stays untouched, so you can
        tweak things per-experiment safely.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.experimentVariationNotes),
  // Tour robustification 2026-05-27 (tour robustification manager):
  // ensure experiment + method exist so the spotlight on the variation
  // notes field has a real method-attachment row to anchor against on
  // a seed-jump past the prior steps. Canonical flow no-ops.
  onEnter: async () => {
    await ensureFirstExperimentExists();
    await ensureFirstMethodExists();
  },
  // No cursorScript: spotlight + speech is enough (Grant 2026-05-27
  // hand-walk simplification, the typing demo was dropped).
  // Universal pacing: user clicks "Got it, next" to advance.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
