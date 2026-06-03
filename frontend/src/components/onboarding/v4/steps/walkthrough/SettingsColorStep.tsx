/**
 * §6.10 Settings — header tint toggle + free-play color step.
 *
 * Pivoted 2026-05-23 (master inline edit): users now pick their primary
 * (and optional secondary) color during user creation via
 * UserColorPickerPopup, so the walkthrough no longer needs to demo color
 * picking. This step instead spotlights the "Tint header with my color"
 * toggle, explains it briefly, and unlocks the surrounding color picker
 * so the user can either toggle the header tint, tweak their colors
 * again, or just click Got-it-next when they are ready.
 *
 * Page-lock allow-list permits:
 *  - The tint toggle itself
 *  - Every palette swatch (primary + secondary) so the user can refine
 *    their pick if they want
 *  - The Clear-secondary button (gradient feature anchor)
 *  - The Got-it-next manual advance button
 *
 * Artifact encoding: same `settings_change` shape as before, but now
 * captures BOTH the color (if it changed during the step) AND the
 * coloredHeader toggle (if it changed). Two artifacts may land in the
 * pending store if both changed. Cleanup grid default stays "keep".
 *
 * Auto-cursor demo intentionally REMOVED — the step is user-paced from
 * the moment it mounts. No `cursorScript`.
 *
 * Classification: USER-ACTION stage. Speech invites the user to try the
 * toggle (or change colors, or just continue).
 */
import { readUserSettings } from "@/lib/settings/user-settings";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "personalization-color";

interface PreChangeSnapshot {
  color: string;
  colorSecondary: string | null;
  coloredHeader: boolean;
}
let preChangeSnapshot: PreChangeSnapshot | null = null;

/** Page-lock allow-list for the user-paced free-play stage. Exported so
 *  the test file can assert the exact selectors permitted.
 *
 *  Hand-walk fix 2026-05-27: dropped the `[data-tour-target="X"] *`
 *  descendant selectors. TourPageLock checks each selector via
 *  `closest()`, which walks ancestors. A descendant selector like
 *  `A B` only matches an element that IS a B with an A ancestor — that
 *  doesn't compose with closest's "walk up and match each ancestor"
 *  semantics, so those entries effectively never matched. The simple
 *  ancestor-matchable selectors below do match correctly.
 *
 *  Selectors (each tested via target.closest(selector)):
 *   - The whole color + tint wrapper. Any click inside the swatches,
 *     the toggle, or the clear-secondary button matches because they
 *     all descend from this wrapper.
 *   - Individual swatch buttons via `[data-color-swatch]` (belt + braces
 *     in case the wrapper anchor moves in the future).
 *   - The clear-secondary button.
 */
export const SETTINGS_COLOR_PAGE_LOCK_ALLOW_LIST = [
  targetSelector(TOUR_TARGETS.settingsColorAndTint),
  targetSelector(TOUR_TARGETS.settingsColorTintToggle),
  targetSelector(TOUR_TARGETS.settingsColorPicker),
  "[data-color-swatch]",
  `[data-tour-target="settings-color-picker-clear-secondary"]`,
] as const;

export const settingsColorStep = buildWalkthroughStep({
  id: STEP_ID,
  speech:
    "You already picked a color during setup. This toggle decides whether the top bar takes that color too or stays a clean white. Play with it, and click \"Got it, next\" when you're happy.",
  pose: "pointing",
  // Hand-walk fix 2026-05-27 (Grant): spotlight now wraps both the
  // color picker AND the tint toggle, not just the toggle. The user's
  // mental model on this step is "play with the colors or the tint" so
  // the highlight encompasses both.
  targetSelector: targetSelector(TOUR_TARGETS.settingsColorAndTint),
  // No cursorScript: the step is user-paced from the moment it mounts.
  // The user can flip the toggle, tweak colors, or just hit Got-it-next.
  completion: manualAdvance("Got it, next"),
  pageLock: {
    allowList: SETTINGS_COLOR_PAGE_LOCK_ALLOW_LIST,
    pillLabel: "Try the toggle or tweak your colors, then Got it, next",
  },
  onEnter: async () => {
    preChangeSnapshot = null;
    try {
      const username = await getCurrentUserCached();
      if (!username || username === "_no_user_") return;
      const settings = await readUserSettings(username);
      preChangeSnapshot = {
        color: settings.color,
        colorSecondary: settings.colorSecondary ?? null,
        coloredHeader: settings.coloredHeader,
      };
    } catch (err) {
      console.warn(
        "[onboarding-v4] personalization-color baseline read failed",
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
        preChangeSnapshot !== null
      ) {
        const settings = await readUserSettings(username);
        const before = preChangeSnapshot;

        // Record color change as a settings_change artifact only when
        // it actually moved. Encodes both stops when either changed so
        // the cleanup-execution.ts revert path restores the exact pair.
        const colorChanged =
          settings.color !== before.color ||
          (settings.colorSecondary ?? null) !== before.colorSecondary;
        if (colorChanged) {
          const fromPair = `${before.color}${before.colorSecondary ? "," + before.colorSecondary : ""}`;
          const toPair = `${settings.color}${settings.colorSecondary ? "," + settings.colorSecondary : ""}`;
          pendingArtifactStore.add(STEP_ID, {
            type: "settings_change",
            id: `color:${fromPair}→${toPair}`,
            cleanup_default: "keep",
          });
        }

        // Record the tint toggle change separately so the cleanup grid
        // can revert each independently. cleanup_default "keep" matches
        // L24 default-keep behavior.
        if (settings.coloredHeader !== before.coloredHeader) {
          pendingArtifactStore.add(STEP_ID, {
            type: "settings_change",
            id: `coloredHeader:${before.coloredHeader}→${settings.coloredHeader}`,
            cleanup_default: "keep",
          });
        }
      }
    } catch (err) {
      console.warn(
        "[onboarding-v4] personalization-color exit-read failed",
        err,
      );
    }
    preChangeSnapshot = null;
    await flushPendingArtifacts(STEP_ID);
  },
  expectedRoute: "/settings",
});
