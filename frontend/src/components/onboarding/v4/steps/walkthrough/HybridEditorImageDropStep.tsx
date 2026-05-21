/**
 * §6.7 Hybrid editor — selfie image drag-drop demo.
 *
 * Third of four hybrid-editor sub-steps. BeakerBot's selfie image
 * auto-appears in the image strip below the editor (the spawn happens
 * in `onEnter`). The cursor drags the selfie from the strip into the
 * markdown editor; the image embeds.
 *
 * Asset gap (FLAG to master): the selfie PNG lives at
 * `public/onboarding/beakerbot-selfie.png`. P5 sub-bot does not commit
 * the asset itself — image generation is out of scope. The step body
 * references the path; if the asset is missing the drag still fires
 * but the resulting embed shows a broken-image icon. Master should
 * either commit the asset manually or delegate to a separate
 * asset-generation chip.
 *
 * Subscribes to the existing `imageEvents.onAttached` bus (the image
 * strip emits when an image lands in the experiment's results dir).
 * The watcher resolves the listener returning unsubscribe shape
 * `TourStepCompletion.eventListener` expects.
 *
 * Artifact:
 *   { type: "notes_image", id: "beakerbot-selfie.png:task-<taskId>", cleanup_default: "discard" }
 *
 * Cleanup default discard — the selfie is a demo asset, not user
 * content. The encoded id matches the v3 telegram-image scheme
 * (`encodeTelegramImageId`) so the Phase 4 grid can re-use the same
 * cleanup path.
 */
import {
  cursorScript,
  safeDragAction,
  compactScript,
} from "./lib/cursor-script";
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchImageAttached } from "./lib/tour-events";

export const SELFIE_ASSET_PATH = "/onboarding/beakerbot-selfie.png";

export const hybridEditorImageDropStep = buildWalkthroughStep({
  id: "hybrid-editor-image-drop",
  speech:
    "Drag-drop time. Here's my selfie from the image strip into your notes.",
  pose: "bouncing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorImageStrip),
  cursorScript: cursorScript(async () => {
    // The selfie strip element should mount as the first child of the
    // image strip with `data-tour-target` set on it. We look for any
    // child of the strip to drag from. The destination is the hybrid
    // editor textarea (the same target as the typing sub-step).
    const drag = await safeDragAction(
      `${targetSelector(TOUR_TARGETS.hybridEditorImageStrip)} > *:first-child`,
      targetSelector(TOUR_TARGETS.hybridEditorTextarea),
    );
    return compactScript([drag]);
  }),
  completion: advanceOnEvent(watchImageAttached),
});
