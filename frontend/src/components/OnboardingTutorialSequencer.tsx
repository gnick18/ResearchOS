"use client";

/**
 * Phase-4 guided tutorial sequencer. Mounted by `<OnboardingProvider>`
 * when both `isDemoOrWikiCapture()` and `isTutorialMode()` are true,
 * i.e. the user opened `/demo?tutorial=1` in a new tab via the welcome
 * modal's "Walk me through it" button.
 *
 * Walks the user through every tip in `ONBOARDING_TIPS` in priority
 * order, auto-navigating to each tip's route (and auto-opening the
 * relevant detail popup via the `openProject` / `openMethod` /
 * `openTask` query params for popup-gated tips). Renders a per-tip
 * card with TUTORIAL controls (Back / Skip / Next + progress + End)
 * instead of the normal dismissals; the X close button prompts to end
 * the tour. After the last tip, an end-screen invites the user to
 * close the tab.
 *
 * The tutorial passes through within-tour navigations by preserving
 * `?tutorial=1` on every router.push it issues. The popup-open params
 * (openProject/openMethod/openTask) are stripped on consume by the
 * destination page's deep-link useEffect.
 *
 * Stub file — wired up in a follow-up commit on the same branch.
 */

import { useEffect } from "react";

export default function OnboardingTutorialSequencer() {
  // Placeholder body — real sequencer state machine lands in a
  // follow-up commit on this branch. Renders nothing for now so the
  // typecheck and the tutorial-route load both succeed.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[onboarding-tutorial] sequencer mounted (stub)");
  }, []);
  return null;
}
