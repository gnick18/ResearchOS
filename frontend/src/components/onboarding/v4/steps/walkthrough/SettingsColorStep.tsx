/**
 * §6.10 Settings — color picker sub-step.
 *
 * Auto-navigate to /settings. Cursor moves to the color swatches,
 * picks one. Header tint flows immediately. The pick is recorded as a
 * `settings_change` artifact so Phase 4 cleanup can restore the
 * original theme if the user prefers.
 *
 * Then a short "settings-more" pointer fires as a separate step.
 *
 * Artifact:
 *   { type: "settings_change", id: "color:<from>→<to>", cleanup_default: "discard" }
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const settingsColorStep = buildWalkthroughStep({
  id: "personalization-color",
  speech: "Now let's pick your color. Watch the chrome shift live.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsColorPicker),
  cursorScript: cursorScript(async () => {
    // Click the first swatch inside the color picker. Real Settings
    // surfaces each swatch as a child element with `data-color-swatch`
    // or similar; we pick the first via a child selector.
    const swatch = await safeClickAction(
      `${targetSelector(TOUR_TARGETS.settingsColorPicker)} button:first-child`,
    );
    return compactScript([swatch]);
  }),
  completion: autoAdvanceAfter(2000),
  expectedRoute: "/settings",
});

/**
 * §6.10 — "more in settings" pointer. Brief speech bubble between the
 * color pick and the AI Helper deep-explain. No cursor action; just
 * BeakerBot landing the speech.
 */
export const settingsMoreStep = buildWalkthroughStep({
  id: "settings-more",
  speech:
    "By the way, there's a lot more you can change in Settings, explore later. There's also a streak counter that turns on when you start saving stuff. Private to you, off in Settings if you don't want it. For now, let me scroll down to one more thing.",
  pose: "thinking",
  // No spotlight — narrative beat between two anchored steps.
  completion: autoAdvanceAfter(3500),
  expectedRoute: "/settings",
});
