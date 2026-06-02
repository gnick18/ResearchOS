/**
 * §6.9 Animation picker — universal walkthrough.
 *
 * Lives on the Settings page's Animation section (Gantt toolbar
 * declutter, 2026-05-23). The previous toolbar-popup affordance was
 * removed because Settings already carried an inline picker; rather
 * than maintain both surfaces the tour now anchors to the Settings
 * tile grid directly. Cursor clicks the "celebration" tile and the
 * animation preview fires.
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
 * as demo: cursor picks the "celebration" default so the user sees
 * the animation fire. The cleanup grid later lets the user revert if
 * they prefer a quieter theme.
 */
import { readUserSettings } from "@/lib/settings/user-settings";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
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
    "First up: the animation picker. When you finish an experiment, ResearchOS plays a little animation to mark it. Pick the one you want.",
  pose: "bouncing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsAnimationPicker),
  cursorScript: cursorScript(async () => {
    // The Settings page renders the picker as an inline tile grid; each
    // tile carries `data-animation-theme="<id>"`. The "celebration"
    // theme is the default pick per §6.9. No popup-open beat anymore
    // (the toolbar popup was removed in the 2026-05-23 declutter pass).
    const pickCelebration = await safeClickAction(
      "[data-animation-theme='celebration']",
    );
    return compactScript([pickCelebration]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
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
  // Animation picker lives on the Settings page (post-Gantt-declutter,
  // 2026-05-23). The tour controller routes the user to /settings if
  // they're elsewhere when the step fires.
  expectedRoute: "/settings",
});
