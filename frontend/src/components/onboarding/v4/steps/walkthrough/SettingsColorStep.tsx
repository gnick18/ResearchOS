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
import { manualAdvance, buildWalkthroughStep, autoAdvanceAfter } from "./lib/step-helpers";
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
 *  Selectors:
 *   - The tint toggle itself (the new spotlight target). The toggle's
 *     inner button/switch is captured by the wildcard `*` so the user's
 *     click lands on the underlying input.
 *   - Every palette swatch (primary + secondary share the
 *     `data-color-swatch` attribute) so the user can still tweak their
 *     colors here if they want.
 *   - `settings-color-picker-clear-secondary` for clearing the gradient.
 *   - The speech bubble's Next button via the standard `data-tour-bubble`
 *     attribute that the TourController stamps on the bubble shell.
 */
export const SETTINGS_COLOR_PAGE_LOCK_ALLOW_LIST = [
  `${targetSelector(TOUR_TARGETS.settingsColorTintToggle)}`,
  `${targetSelector(TOUR_TARGETS.settingsColorTintToggle)} *`,
  "[data-color-swatch]",
  `${targetSelector(TOUR_TARGETS.settingsColorPicker)} *`,
  `[data-tour-target="settings-color-picker-clear-secondary"]`,
] as const;

export const settingsColorStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        You already picked your color when you set up your account. This
        toggle decides whether the top bar takes that color too, or stays
        a clean white.
      </p>
      <p>
        Flip it on and off to see the chrome shift. If you want to change
        your color or add a gradient, the swatches above are still live.
        Click Got it, next when you are happy.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsColorTintToggle),
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

/**
 * @deprecated 2026-05-22 (Settings manager, §6.10 phase redesign).
 *
 * The "more in settings" pointer is replaced by the seven
 * `settings-tour-*` narration beats in `SettingsTourBeats.tsx`. Each
 * new beat anchors on a specific Settings surface (folder, calendar,
 * telegram, lab-mode toggle, visible tabs, streak counter, re-run
 * welcome tour) and explains its purpose in 1-2 sentences.
 *
 * This export survives for git-history reference and so any code that
 * imports `settingsMoreStep` directly (e.g. external tests, dev
 * tools) keeps compiling. The step is NOT in TOUR_STEP_ORDER, so the
 * machine never lands on it.
 */
export const settingsMoreStep = buildWalkthroughStep({
  id: "settings-more",
  speech:
    "By the way, there's a lot more you can change in Settings, explore later. There's also a streak counter that turns on when you start saving stuff. Private to you, off in Settings if you don't want it. For now, let me scroll down to one more thing.",
  pose: "thinking",
  completion: autoAdvanceAfter(3500),
  expectedRoute: "/settings",
});
