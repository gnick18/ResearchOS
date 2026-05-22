/**
 * §6.10 Settings — color picker sub-step.
 *
 * Auto-navigate to /settings. Cursor moves to the color swatches,
 * picks the primary swatch (the first available palette entry). The
 * header tint + avatar gradient update immediately. The user may then
 * OPTIONALLY click a secondary palette swatch (gradient feature, in
 * flight at a621daf4) to render a two-stop gradient on their avatar —
 * the page-lock allow-list mounts AFTER the cursor click and permits
 * any palette swatch + the "Clear secondary" button + the Got-it-next
 * button.
 *
 * Refined 2026-05-22 (Settings manager) per the §6.10 phase redesign:
 * the prior step's speech ("Now let's pick your color. Watch the
 * chrome shift live.") gains a second paragraph that invites the
 * optional secondary pick. The cursor demo is unchanged at the
 * primary level; the secondary stage is purely user-driven.
 *
 * Gradient-feature coordination: the secondary-swatch UI is in flight
 * at a621daf4. When that lands, the page-lock allow-list below
 * already permits the existing `[data-color-swatch]` attribute on
 * every palette button (primary + the new secondary palette), plus
 * the new `[data-tour-target="settings-color-picker-clear-secondary"]`
 * Clear button. So no follow-up edit is required when the gradient
 * sub-bot ships — the optional user-action stage becomes interactive
 * automatically. A `// FOLLOW-UP:` comment marks the polish site if
 * we later want the cursor to glide briefly to the secondary palette
 * before unlocking.
 *
 * Artifact:
 *   { type: "settings_change", id: "color:<from>→<to>", cleanup_default: "keep" }
 *
 * If the user picked a secondary, the artifact encoding includes both
 * stops: `color:<from-primary>,<from-secondary>→<to-primary>,<to-secondary>`.
 * The cleanup-execution.ts settings_change revert path splits on the
 * arrow + the comma to restore both colors.
 *
 * Classification: BEAKERBOT DEMO + optional USER-ACTION stage.
 * Speech reads "Watch the chrome shift live" (demo signal) and
 * "Want a gradient too? Click a second color or Got it, next when
 * you're happy" (optional user-action stage). The page-lock allow-
 * list permits the optional clicks; the user can also just hit Got-it
 * without doing anything secondary.
 */
import { readUserSettings } from "@/lib/settings/user-settings";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "personalization-color";

/** Pre-change settings snapshot captured in onEnter. The `to` half of
 *  the artifact is resolved at exit by reading the settings again, so
 *  the from→to pair encodes the actual change that landed (even when
 *  the user toggled the cursor's pick before exit). The snapshot
 *  intentionally captures only `color` today; when the gradient
 *  feature sub-bot (a621daf4) lands, this snapshot expands to include
 *  the secondary color field. */
let preChangeColor: string | null = null;

/** Page-lock allow-list for the optional secondary user-action stage.
 *  Exported so the test file can assert the exact selectors permitted.
 *
 *  Selectors:
 *   - `[data-color-swatch]` — every palette swatch button (primary +,
 *     once the gradient feature lands, secondary). The attribute name
 *     is identical for both palettes so the lock auto-extends when
 *     gradient ships. No follow-up edit required.
 *   - `[data-tour-target="settings-color-picker-clear-secondary"]` —
 *     the Clear-secondary button the gradient sub-bot will stamp. The
 *     attribute resolves to nothing until that sub-bot lands; the
 *     allow-list entry is benign in the meantime.
 *   - `[data-tour-bubble]` / `[data-tour-bubble] *` — the speech
 *     bubble's manual Next button. The TourController stamps this
 *     attribute on the bubble shell; matching `*` includes the
 *     button inside.
 */
export const SETTINGS_COLOR_PAGE_LOCK_ALLOW_LIST = [
  "[data-color-swatch]",
  `${targetSelector(TOUR_TARGETS.settingsColorPicker)} *`,
  `[data-tour-target="settings-color-picker-clear-secondary"]`,
  // FOLLOW-UP (Settings manager 2026-05-22): when the gradient sub-bot
  // lands, optionally extend the cursor script to glide briefly to
  // the secondary palette section BEFORE handing off to the user. The
  // allow-list above already permits the secondary swatches without
  // any further edit (they share the `data-color-swatch` attribute).
] as const;

export const settingsColorStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        Now let&apos;s pick your color. Watch the chrome shift live.
      </p>
      <p>
        Want a gradient too? You can pick a second color for variety,
        or just click Got it, next when you&apos;re happy with one.
      </p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsColorPicker),
  cursorScript: cursorScript(async () => {
    // Click the first swatch inside the color picker. Each swatch carries
    // `data-color-swatch="<hex>"` (stamped on the swatch grid in
    // `app/settings/page.tsx`). Targeting by attribute rather than
    // layout position (`button:first-child`) keeps the cursor stable
    // when the palette reorders or gets sibling controls.
    const swatch = await safeClickAction(
      `${targetSelector(TOUR_TARGETS.settingsColorPicker)} [data-color-swatch]:first-child`,
    );
    // FOLLOW-UP (gradient sub-bot a621daf4): when the secondary picker
    // UI lands, optionally append a brief glide here to draw the
    // user's eye toward the secondary palette before the page-lock
    // hands off. The allow-list already permits the secondary clicks
    // (see SETTINGS_COLOR_PAGE_LOCK_ALLOW_LIST), so the demo continues
    // to work without this polish.
    return compactScript([swatch]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for
  // the user to click before advancing. The optional secondary stage
  // also runs under the manual gate.
  completion: manualAdvance("Got it, next"),
  // Page-lock mounts the moment the step becomes active and stays up
  // until the user advances. The allow-list permits all palette
  // swatches + the Clear button so the secondary stage is interactive,
  // but the rest of the page (sidebar nav, other settings sections,
  // etc.) is locked to keep the demo focused on the color picker.
  pageLock: {
    allowList: SETTINGS_COLOR_PAGE_LOCK_ALLOW_LIST,
    pillLabel: "Click a color (optional second), then Got it, next",
  },
  // Capture the pre-change color so the artifact encodes the original
  // value for the cleanup-execution.ts settings_change revert path.
  // Done in onEnter (BEFORE the cursor clicks the swatch) so the
  // snapshot reflects what the user had, not what BeakerBot picked.
  onEnter: async () => {
    preChangeColor = null;
    try {
      const username = await getCurrentUserCached();
      if (!username || username === "_no_user_") return;
      const settings = await readUserSettings(username);
      preChangeColor = settings.color;
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
        preChangeColor !== null
      ) {
        const settings = await readUserSettings(username);
        const toColor = settings.color;
        if (toColor !== preChangeColor) {
          // Encoded `<field>:<from>→<to>` (U+2192) matches v3's
          // encodeSettingsChangeId; cleanup-execution.ts splits on the
          // arrow to revert. cleanup_default "keep" per L24 default-keep
          // and the brief — user might keep the new color but the
          // cleanup grid lets them flip it back.
          //
          // FOLLOW-UP (gradient sub-bot a621daf4): when the secondary
          // color field ships in UserSettings, extend the encoding to
          // `color:<from-primary>,<from-secondary>→<to-primary>,<to-secondary>`.
          // cleanup-execution.ts will need a matching split-on-comma
          // pass at the same time.
          pendingArtifactStore.add(STEP_ID, {
            type: "settings_change",
            id: `color:${preChangeColor}→${toColor}`,
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
    preChangeColor = null;
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
  // No spotlight — narrative beat between two anchored steps.
  completion: autoAdvanceAfter(3500),
  expectedRoute: "/settings",
});
