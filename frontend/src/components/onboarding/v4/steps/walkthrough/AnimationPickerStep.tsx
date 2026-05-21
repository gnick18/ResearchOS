/**
 * §6.9 Animation picker — universal walkthrough.
 *
 * On the Gantt page's toolbar (no navigation needed). Cursor moves to
 * the toolbar's animation icon, clicks. Animation picker popup opens.
 * Cursor clicks a theme; animation preview fires (same UX as v3 W6's
 * fix).
 *
 * Per §6.9, the suggested default pick is "celebration." Pickable
 * themes vary by user settings; the cursor click targets the
 * celebration tile by data-attribute. If that tile doesn't exist
 * (theme rename, etc.), the cursor falls through and the step
 * advances on the auto timer.
 *
 * Artifact:
 *   { type: "settings_change", id: "animationType:<from>→<to>", cleanup_default: "discard" }
 *
 * Cleanup default discard — the user might want to revert if they
 * picked the demo's "celebration" but actually prefer a quieter
 * theme. The encoded id format matches v3's
 * `encodeSettingsChangeId(field, from, to)` so the Phase 4 grid can
 * re-use the same restore path.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const animationPickerStep = buildWalkthroughStep({
  id: "personalization-animations",
  speech:
    "Quick personal touch, pick an animation theme that fires when you complete experiments.",
  pose: "bouncing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttAnimationPicker),
  cursorScript: cursorScript(async () => {
    const openPicker = await safeClickAction(
      targetSelector(TOUR_TARGETS.ganttAnimationPicker),
    );
    // The picker renders tiles with `data-animation-theme="<id>"`. The
    // "celebration" theme is the default pick per §6.9.
    const pickCelebration = await safeClickAction(
      "[data-animation-theme='celebration']",
    );
    return compactScript([openPicker, pickCelebration]);
  }),
  completion: autoAdvanceAfter(2500),
});
