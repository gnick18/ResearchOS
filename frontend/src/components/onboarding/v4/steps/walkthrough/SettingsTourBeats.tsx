/**
 * §6.10 Settings phase redesign 2026-05-22 (Settings manager).
 *
 * Seven short narration beats that expand the prior single
 * `settings-more` pointer into per-surface tour beats. Each beat:
 *
 *   - Scrolls + spotlights one Settings section.
 *   - Plays a 1-2 sentence speech bubble ("this is where X lives").
 *   - Advances manually via a "Got it, next" button.
 *   - Records no artifact (pure narration; nothing to clean up).
 *   - Gates on `expectedRoute === "/settings"` + the appropriate
 *     FeaturePicks field (see `isStepGatedOut` in step-machine.ts for
 *     the matching gate predicates).
 *
 * The cursor doesn't fire a click on these beats. The spotlight does
 * the work — the user sees the section, hears the explanation, and
 * clicks Got-it to advance. Three of the beats are conditional:
 *
 *   - `settings-tour-calendar`     gates on `picks.calendar === "yes"`
 *   - `settings-tour-telegram`     gates on `picks.telegram === "yes"`
 *   - `settings-tour-lab-mode-toggle` gates on `picks.account_type === "solo"`
 *
 * The other four (folder, visible-tabs, streak, rerun) fire for
 * everyone.
 *
 * Why a shared file: the seven beats are intentionally near-identical
 * (same shape, same defaults), and splitting them across seven files
 * would just spread the same skeleton across the repo. Each beat is
 * still exported under its own name so the registry + tests can
 * reference them individually.
 *
 * Surfaces without a dedicated Settings section (calendar feeds,
 * lab-mode toggle) ship with `targetSelector` undefined for now —
 * the speech bubble still lands; only the spotlight is absent. A
 * FOLLOW-UP comment marks the wire-up site for when those surfaces
 * gain a Settings home.
 */
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { targetSelector, TOUR_TARGETS } from "./lib/targets";

/** §6.10a — Lab Folder narration (universal). Anchors on the Settings
 *  page header (which surfaces `users/<user>/settings.json`, the
 *  closest in-product reference to the connected lab folder).
 *
 *  Speech-honesty fix (Settings fix manager R1, 2026-05-22): the prior
 *  speech promised a "switch to a different folder" affordance right
 *  on /settings, but folder switching today lives in
 *  `ResearchFolderSetupNew` on the entry screen. The reworded line
 *  acknowledges the affordance is sign-out + re-pick rather than
 *  pretending to point at a button that doesn't exist. */
export const settingsTourFolderStep = buildWalkthroughStep({
  id: "settings-tour-folder",
  speech:
    "Your lab folder is set up. To switch folders later, sign out and pick a new one from the entry screen.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsFolderSection),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});

/** §6.10b — Calendar feeds narration (gated on Q3=yes).
 *
 *  Speech-honesty fix (Settings fix manager R1, 2026-05-22): no
 *  dedicated calendar-feeds section exists on /settings yet, so the
 *  prior speech ("Calendar feeds live here, paste any .ics URL...")
 *  narrated UI the user couldn't see. Feed management actually lives
 *  on the /calendar page via CalendarFeedsButton. Reworked the speech
 *  to point users at the Calendar tab instead of pretending Settings
 *  owns the surface.
 *
 *  FOLLOW-UP: when the Settings page grows a "Calendar feeds" section,
 *  stamp `data-tour-target="settings-calendar-feeds-section"` on the
 *  SectionShell, add `targetSelector: targetSelector(TOUR_TARGETS.settingsCalendarFeeds)`
 *  here, and restore the "paste any .ics URL" framing. */
export const settingsTourCalendarStep = buildWalkthroughStep({
  id: "settings-tour-calendar",
  speech:
    "Calendar feeds aren't managed from Settings yet, go to the Calendar tab to paste an .ics URL.",
  pose: "pointing",
  // FOLLOW-UP: no anchor until Settings grows a calendar-feeds section.
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks: FeaturePicks | null) => picks?.calendar === "yes",
  expectedRoute: "/settings",
});

/** §6.10c — Telegram narration (gated on Q5=yes). Anchors on the
 *  BehaviorSection which already carries `id="telegram"` for deep-
 *  links from the Telegram onboarding tip. */
export const settingsTourTelegramStep = buildWalkthroughStep({
  id: "settings-tour-telegram",
  speech:
    "Telegram lives here. You linked it during setup. If you ever want to swap accounts or unlink, this is the spot.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsTelegramSection),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks: FeaturePicks | null) => picks?.telegram === "yes",
  expectedRoute: "/settings",
});

/** §6.10d — Lab Mode toggle narration (gated on Q1=solo).
 *
 *  Speech-honesty fix (Settings fix manager R1, 2026-05-22): no
 *  "Switch to Lab Mode" toggle exists on /settings yet. The lab-mode
 *  switch happens at the user-picker level today, so the prior speech
 *  ("this flips you over...") narrated a button the user couldn't see.
 *  Reworked the speech to point users at the user picker instead of
 *  pretending Settings owns the toggle.
 *
 *  FOLLOW-UP: when a dedicated toggle ships in Settings, stamp
 *  `data-tour-target="settings-lab-mode-toggle"` on it, add
 *  `targetSelector: targetSelector(TOUR_TARGETS.settingsLabModeToggle)`
 *  here, and restore the "this flips you over" framing. */
export const settingsTourLabModeToggleStep = buildWalkthroughStep({
  id: "settings-tour-lab-mode-toggle",
  speech:
    "If you ever pivot from solo to a lab account, the switch lives in the user picker up top, Settings doesn't carry it yet.",
  pose: "pointing",
  // FOLLOW-UP: no anchor until Settings grows a Lab Mode toggle row.
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks: FeaturePicks | null) =>
    picks?.account_type === "solo",
  expectedRoute: "/settings",
});

/** §6.10e — Visible Tabs narration (universal). Anchors on the
 *  TabsSection where Q7 visibility picks land. */
export const settingsTourVisibleTabsStep = buildWalkthroughStep({
  id: "settings-tour-visible-tabs",
  speech:
    "Anything you said 'no' to during setup hid the tab. To turn it back on later, just check the box here. Same goes for hiding tabs you decide you don't need.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsTabsSection),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});

/** §6.10f — Streak counter narration (universal). Anchors on the
 *  StreaksSection which owns the enable-tracking toggle. */
export const settingsTourStreakStep = buildWalkthroughStep({
  id: "settings-tour-streak",
  speech:
    "Streak counter is on by default. It's private to you, nobody else sees it. If you'd rather not be reminded, toggle it off here.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsStreakSection),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});

/** §6.10g — Re-run welcome tour narration (universal). Anchors on the
 *  TipsSection which surfaces the "Re-run tour" button. Closes out the
 *  Settings tour cluster by reminding the user the whole walkthrough
 *  can be replayed from here. */
export const settingsTourRerunStep = buildWalkthroughStep({
  id: "settings-tour-rerun",
  speech:
    "Re-run the welcome tour any time from this button. Useful if you forget how something works.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsRerunSection),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});
