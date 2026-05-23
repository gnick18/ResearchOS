"use client";

import { useTourController } from "../../TourController";
import { manualAdvance } from "./lib/step-helpers";
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
 * Manual-advance per Wave 1 universal-pacing rule (R2 chip C
 * 2026-05-22). The prior auto-advance after a 6.5-11s read duration
 * stranded literal readers who needed more time to read the speech.
 *
 * Classification (per Grant's 2026-05-21 design rule): BEAKERBOT
 * NARRATION (no cursor action). The spotlight just points at the tab
 * while BeakerBot describes the surface. No click / type / drag to
 * strip.
 */

/**
 * Inner speech-bubble body. Renders Beat 1 always, Beat 2 only for
 * lab accounts. No auto-advance: the user paces themselves with the
 * "Got it, next" button on the bubble shell.
 */
function LinksExplainerBody() {
  const { featurePicks } = useTourController();
  const isLab = featurePicks?.account_type === "lab";

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
 * no artifacts. Manual-advance per Wave 1 universal-pacing rule.
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
  completion: manualAdvance("Got it, next"),
  targetSelector: "[data-tour-target='lab-links-nav-tab']",
  conditionalOn: (picks) => picks?.links === "yes",
  // The surface lives at /links for both solo and lab accounts.
  expectedRoute: "/links",
};
