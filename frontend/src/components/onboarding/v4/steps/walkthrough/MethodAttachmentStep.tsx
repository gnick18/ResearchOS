/**
 * §6.6 Method attachment + variation notes + snapshot teach.
 *
 * Critical mental-model moment per Grant's voice-to-text: editing a
 * method from inside an experiment edits THIS EXPERIMENT'S COPY. The
 * original method stays untouched.
 *
 * Cursor flow:
 *   1. Click the experiment (created in §6.5) to open detail popup.
 *   2. Click the Methods tab inside the popup.
 *   3. Click "Attach Method." Method picker opens.
 *   4. Click the method created in §6.4d. Attached.
 *   5. Click the variation-notes field on the attachment.
 *   6. Type a placeholder note.
 *
 * Two-paragraph speech bubble. The second paragraph (the mental model)
 * is bolded subtly via a visual marker the registry can pass through.
 *
 * Artifact:
 *   { type: "method_attachment", id: "<taskId>:<methodId>", cleanup_default: "discard" }
 *
 * Cleanup default discard — the attachment exists only for the demo,
 * users won't typically want it past the tour.
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech is "Open your experiment. See that Methods tab?
 * You attach methods there. I'm doing it now." The closing "I'm doing
 * it now" is the explicit BeakerBot-led demo promise. Cursor performs
 * the methods-tab open + attach + variation note typing as advertised.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

const VARIATION_NOTE = "This experiment uses 30 C instead of 25 C.";

export const methodAttachmentStep = buildWalkthroughStep({
  id: "experiment-attach-method",
  speech: (
    <>
      <p className="mb-2">
        Open your experiment. See that Methods tab? You attach methods
        there. I&apos;m doing it now.
      </p>
      <p>
        <strong>Important:</strong> when you edit a method from inside
        an experiment, you&apos;re editing this experiment&apos;s COPY. The
        original method stays untouched. So you can tweak per-experiment
        without worrying about overriding the master.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.experimentMethodsTab),
  cursorScript: cursorScript(async () => {
    // The experiment detail popup is opened by clicking the most
    // recently created experiment row. Selector is best-effort; if the
    // selector doesn't resolve (user is on a different page), the
    // cursor script no-ops and the user can manually advance.
    const openMethodsTab = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentMethodsTab),
    );
    const clickAttach = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentAttachMethod),
    );
    const typeNote = await safeTypeAction(
      targetSelector(TOUR_TARGETS.experimentVariationNotes),
      VARIATION_NOTE,
    );
    return compactScript([openMethodsTab, clickAttach, typeNote]);
  }),
  // BeakerBotCursor types at 48ms (commit 95de59e2); +1s lead + 1.5s tail.
  completion: autoAdvanceAfter(1000 + Math.ceil(VARIATION_NOTE.length * 48) + 1500),
});
