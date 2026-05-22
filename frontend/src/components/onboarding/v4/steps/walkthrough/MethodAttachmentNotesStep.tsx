/**
 * §6.6 Method attachment NOTES sub-step (4 of 4).
 *
 * BeakerBot's cursor types the variation note into the attached method's
 * notes field. This is also the step that owns the mental-model speech:
 * editing a method from inside an experiment edits THIS EXPERIMENT'S
 * COPY, not the master method.
 *
 * Critical mental-model moment per Grant's voice-to-text: editing a
 * method from inside an experiment edits THIS EXPERIMENT'S COPY. The
 * original method stays untouched.
 *
 * This is the terminal id of the split (replacing the original single
 * `experiment-attach-method` step). Telemetry / typeguards that pinned
 * the old id should now reference `experiment-attach-method-notes` —
 * the "step completed" beat still fires at the same logical moment
 * (user has just attached a method and added a variation note).
 *
 * Artifact:
 *   { type: "method_attachment", id: "<taskId>:<methodId>", cleanup_default: "discard" }
 *
 * Cleanup default discard — the attachment exists only for the demo,
 * users won't typically want it past the tour.
 *
 * Classification: BEAKERBOT DEMO. Speech retains the original mental-
 * model paragraph (Grant's design correction 2026-05-21).
 *
 * Pose: `typing-on-laptop` (matches the audited cursor-typing pose).
 *
 * expectedRoute: "/workbench" — popup-portaled, no route change.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const VARIATION_NOTE = "This experiment uses 30 C instead of 25 C.";

export const methodAttachmentNotesStep = buildWalkthroughStep({
  id: "experiment-attach-method-notes",
  speech: (
    <>
      <p className="mb-2">
        And a quick note on what makes this run different.
      </p>
      <p>
        <strong>Important:</strong> when you edit a method from inside
        an experiment, you&apos;re editing this experiment&apos;s COPY. The
        original method stays untouched. So you can tweak per-experiment
        without worrying about overriding the master.
      </p>
    </>
  ),
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.experimentVariationNotes),
  cursorScript: cursorScript(async () => {
    const focusClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentVariationNotes),
      3000,
    );
    const typeNote = await safeTypeAction(
      targetSelector(TOUR_TARGETS.experimentVariationNotes),
      VARIATION_NOTE,
    );
    return compactScript([focusClick, typeNote]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
