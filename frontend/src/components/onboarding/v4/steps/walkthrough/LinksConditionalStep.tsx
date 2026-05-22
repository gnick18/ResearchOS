"use client";

import { useEffect, useRef } from "react";
import { useTourController } from "../../TourController";
import type { TourStep } from "../../step-types";

/**
 * Links conditional walkthrough step (Lab Links manager 2026-05-22).
 *
 * Conditional on `picks.links === "yes"`. Tiny explainer (one or two
 * beats depending on account type):
 *   Beat 1 (everyone): cursor spotlight on the Links / Lab Links nav
 *     tab. BeakerBot narrates "here's where you save bookmarks. Click
 *     + Add Link, type a URL, give it a label, save. Stuff like your
 *     university VPN, the lab calendar, the freezer inventory
 *     spreadsheet, your manuscript drafts."
 *   Beat 2 (LAB ACCOUNTS ONLY): "If you mark a card public, your
 *     teammates see it on their Lab Links page. That's how labs ship
 *     shared resource pages."
 *
 * Solo accounts skip beat 2 entirely — the public-toggle isn't a thing
 * for them, so the speech would be confusing.
 *
 * Auto-advance like the Calendar conditional step: pure narration, no
 * cursor demo (just spotlight + speech), so the universal-pacing rule
 * permits auto-advance after the read duration. Lab accounts get a
 * longer read budget because they get an extra beat.
 *
 * Classification (per Grant's 2026-05-21 design rule): BEAKERBOT
 * NARRATION (no cursor action). The spotlight just points at the tab
 * while BeakerBot describes the surface. No click / type / drag to
 * strip.
 */

const SOLO_READ_DURATION_MS = 6500;
const LAB_READ_DURATION_MS = 11000;

function LinksExplainerBody() {
  const { advance, noteEventFired, featurePicks } = useTourController();
  const startedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLab = featurePicks?.account_type === "lab";
  const readDuration = isLab ? LAB_READ_DURATION_MS : SOLO_READ_DURATION_MS;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    timerRef.current = setTimeout(() => {
      noteEventFired();
      advance();
    }, readDuration);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [advance, noteEventFired, readDuration]);

  return (
    <div className="space-y-2" data-testid="links-explainer-body">
      <p data-testid="links-explainer-beat-1">
        Here&apos;s where you save bookmarks. Click + Add Link, type a
        URL, give it a label, save. Stuff like your university VPN,
        the lab calendar, the freezer inventory spreadsheet, your
        manuscript drafts.
      </p>
      {isLab && (
        <p data-testid="links-explainer-beat-2">
          If you mark a card public, your teammates see it on their
          Lab Links page. That&apos;s how labs ship shared resource
          pages.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step body export
// ---------------------------------------------------------------------------

/**
 * Links conditional walkthrough step. Pure explainer, no API calls,
 * no artifacts. Auto-advances after the read duration so the spotlight
 * doesn't dwell on the tab past where the speech ends.
 *
 * Conditional gate (links === "yes") is enforced by
 * `step-machine.ts isStepGatedOut`. `conditionalOn` mirrors it for
 * self-description.
 *
 * `targetSelector` matches the `data-tour-target` value stamped on the
 * Links / Lab Links nav tab in AppShell.tsx (Lab Links manager
 * 2026-05-22). The same target is used regardless of account type;
 * the LABEL on the tab differs (solo: "Links", lab: "Lab Links") but
 * the tour anchor is account-agnostic.
 */
export const linksConditionalStep: TourStep = {
  id: "links",
  pose: "pointing",
  speech: () => <LinksExplainerBody />,
  completion: {
    type: "event",
    eventListener: () => () => {},
  },
  targetSelector: "[data-tour-target='lab-links-nav-tab']",
  conditionalOn: (picks) => picks?.links === "yes",
  // The surface lives at /links for both solo and lab accounts.
  expectedRoute: "/links",
};

// Export the read durations for tests + future tuning chips.
export { SOLO_READ_DURATION_MS, LAB_READ_DURATION_MS };
