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
 * clicks Got-it to advance. Two of the beats are conditional
 * (`settings-tour-calendar` was retired 2026-05-27 and deleted
 * 2026-06-03):
 *
 *   - `settings-tour-telegram`     gates on `picks.telegram === "yes"`
 *   - `settings-tour-account-type-toggle` gates on `picks.account_type === "solo"`
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
 * account-type toggle) ship with `targetSelector` undefined for now,
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
    "Your lab folder is set up. If you ever need to switch folders, sign out and pick a new one from the main entry screen.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsFolderSection),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});

// §6.10b: Calendar feeds narration (`settings-tour-calendar`, gated on
// Q3=yes) retired 2026-05-27 (Grant hand-walk) and deleted 2026-06-03
// (HR / tour-cleanup): no dedicated calendar-feeds section exists on
// /settings, so the beat narrated UI the user couldn't see. Feed
// management lives on the /calendar page via CalendarFeedsButton.

/** §6.10c — Telegram narration (gated on Q5=yes). Anchors on the
 *  BehaviorSection which already carries `id="telegram"` for deep-
 *  links from the Telegram onboarding tip.
 *
 *  R2 chip C 2026-05-22 copy fix: the prior speech claimed "You linked
 *  it during setup", which is only true for users who picked Q6 = yes-
 *  now. The Q5=yes gate covers BOTH the yes-now AND yes-later branches,
 *  so the neutral reframe ("if you didn't link it during setup, you can
 *  wire it up anytime") fits both audiences without making a false
 *  claim. */
export const settingsTourTelegramStep = buildWalkthroughStep({
  id: "settings-tour-telegram",
  speech:
    "Telegram lives here. If you didn't link it during setup, you can wire it up anytime by following the steps in this section.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsTelegramSection),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks: FeaturePicks | null) => picks?.telegram === "yes",
  expectedRoute: "/settings",
});

/** §6.10d — Account-type toggle narration (gated on Q1=solo).
 *
 *  Speech-honesty fix (Settings fix manager R1, 2026-05-22): no
 *  "Switch to lab account" toggle exists on /settings yet. The
 *  solo-to-lab switch happens at the user-picker level today, so the
 *  prior speech ("this flips you over...") narrated a button the user
 *  couldn't see. Reworked the speech to point users at the user picker
 *  instead of pretending Settings owns the toggle.
 *
 *  Step-id rename (walkthrough step-id rename manager, 2026-05-25):
 *  renamed from `settings-tour-lab-mode-toggle` to
 *  `settings-tour-account-type-toggle` because Lab Mode was retired
 *  (R4 Lab Mode retirement 2026-05-23) and the residual "lab-mode"
 *  terminology no longer matches what the step describes. The step
 *  itself still serves solo accounts pivoting to a lab account, the
 *  rename just drops the stale vocabulary.
 *
 *  FOLLOW-UP: when a dedicated account-type toggle ships in Settings,
 *  stamp `data-tour-target="settings-account-type-toggle"` on it, add
 *  `targetSelector: targetSelector(TOUR_TARGETS.settingsAccountTypeToggle)`
 *  here, and restore the "this flips you over" framing. */
export const settingsTourAccountTypeToggleStep = buildWalkthroughStep({
  id: "settings-tour-account-type-toggle",
  speech:
    "If you ever pivot from a solo account to a lab account, you'll do that from the user picker up top, not here in Settings.",
  pose: "pointing",
  // FOLLOW-UP: no anchor until Settings grows an account-type toggle row.
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
    "If you hid any tabs during setup, you can always turn them back on using these checkboxes.",
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
    "The streak counter is on by default. It's completely private to you. If you would rather not see it, you can toggle it off here.",
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
    "If you ever forget how something works, you can re-run this welcome tour right from this button.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.settingsRerunSection),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/settings",
});
