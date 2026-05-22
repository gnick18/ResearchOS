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
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Brief explicitly classifies personalization-animations
 * as demo: cursor opens the picker and picks the "celebration"
 * default so the user sees the animation fire. The cleanup grid
 * later lets the user revert if they prefer a quieter theme.
 * Cursor keeps the open + pick.
 */
import { readUserSettings } from "@/lib/settings/user-settings";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "personalization-animations";

/** Pre-change animation snapshot. Captured in onEnter so the artifact
 *  encodes the original animationType — used by cleanup-execution.ts
 *  to revert via patchUserSettings. */
let preChangeAnimation: string | null = null;

export const animationPickerStep = buildWalkthroughStep({
  id: STEP_ID,
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
  // Capture the pre-change animationType so the artifact encodes the
  // original value for cleanup-execution.ts's settings_change revert
  // path. Done in onEnter, BEFORE the cursor picks "celebration".
  onEnter: async () => {
    preChangeAnimation = null;
    try {
      const username = await getCurrentUserCached();
      if (!username || username === "_no_user_") return;
      const settings = await readUserSettings(username);
      preChangeAnimation = settings.animationType;
    } catch (err) {
      console.warn(
        "[onboarding-v4] personalization-animations baseline read failed",
        err,
      );
    }
  },
  onExit: async () => {
    try {
      const username = await getCurrentUserCached();
      if (
        username &&
        username !== "_no_user_" &&
        preChangeAnimation !== null
      ) {
        const settings = await readUserSettings(username);
        const toAnim = settings.animationType;
        if (toAnim !== preChangeAnimation) {
          // Encoded `<field>:<from>→<to>` matches the v3
          // encodeSettingsChangeId scheme. cleanup_default "keep" per
          // L24 default-keep + the brief — Phase 4 grid lets user
          // flip back to discard if they want to revert.
          pendingArtifactStore.add(STEP_ID, {
            type: "settings_change",
            id: `animationType:${preChangeAnimation}→${toAnim}`,
            cleanup_default: "keep",
          });
        }
      }
    } catch (err) {
      console.warn(
        "[onboarding-v4] personalization-animations exit-read failed",
        err,
      );
    }
    preChangeAnimation = null;
    await flushPendingArtifacts(STEP_ID);
  },
  // Animation picker lives on the Gantt toolbar.
  expectedRoute: "/gantt",
});
