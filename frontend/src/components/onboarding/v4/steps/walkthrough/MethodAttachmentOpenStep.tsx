/**
 * §6.6 Method attachment OPEN sub-step (1 of 4).
 *
 * BeakerBot's cursor clicks the most-recently created experiment row in
 * the workbench list to open the TaskDetailPopup. Advances on the
 * `tour:experiment-popup-opened` window event (dispatched by
 * `TaskDetailPopup.tsx` on mount when the task is an experiment).
 *
 * Split rationale (Grant 2026-05-21): the original single-id
 * `experiment-attach-method` step tried to click the methods tab,
 * click attach, and type a variation note in one cursor script that
 * SPANNED the popup-mount boundary. The popup is portal-mounted on
 * /workbench rather than a route change, but it's the same class of
 * bug as §6.2's project-route-entered: the cursor script's targets
 * don't exist until the popup mounts, so the in-flight `safeClickAction`
 * either times out or fires on a stale DOM. Splitting into four
 * sub-steps mirrors §6.2's NAV / PROSE split.
 *
 * Classification: BEAKERBOT DEMO. Speech is "Now let me open the
 * experiment we just made", an explicit BeakerBot-led promise.
 *
 * Pose: `pointing` (click-affordance pose, matches §6.2 NAV).
 *
 * expectedRoute: "/workbench" — the popup is a portal over /workbench,
 * no route change happens here.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { ensureFirstExperimentExists } from "./lib/ensure-helpers";
import { switchWorkbenchTab } from "./lib/on-enter-helpers";
import { TOUR_TARGETS } from "./lib/targets";

export const methodAttachmentOpenStep = buildWalkthroughStep({
  id: "experiment-attach-method-open",
  // 2026-06-03 (HR / tour-simplification): merged the §6.6 method-attach
  // framing 4 to 3. This beat absorbs the Methods-tab framing that the cut
  // `experiment-attach-method-tab` beat used to carry; the later §6.7d
  // `-attach` beat re-stages the Methods tab via its own onEnter. The
  // cursor click on the workbench row opens the popup so the experiment
  // surface is visible; the speech frames where the protocol gets pinned.
  speech: (
    <>
      <p className="mb-2">
        Open your experiment from the timeline or the Workbench.
      </p>
      <p>
        Inside, the <strong>Methods</strong> tab is where you pin the
        protocol you followed, so the exact steps stay tied to this run.
        We will build a method first, then come back here to attach it.
      </p>
    </>
  ),
  pose: "pointing",
  // No targetSelector: the cursor click on the workbench card is the
  // visual cue. Mirrors the §6.2 NAV pattern — a spotlight on the card
  // would dim /workbench and steal focus from the click animation.
  //
  // Tour robustification 2026-05-27 (tour robustification manager):
  // ensure an experiment exists BEFORE the cursor script tries to click
  // its row. A seed-jump past §6.5 (workbench-create-experiment-open)
  // leaves no row to click; the ensure helper creates a placeholder
  // "First experiment" so the cursor lands on a real row. Canonical
  // flow (§6.5 ran first) hits the no-op branch.
  onEnter: async () => {
    // tour-workbench-tab-fix bot 2026-06-03: the cursor below clicks a
    // `workbench-experiment-row-*` card, which only renders on the
    // Experiments sub-tab. The Workbench now defaults to Projects (de-bloat
    // change), so without a switch the row is absent and the cursor's
    // safeClickAction finds nothing to open. Switch to the Experiments tab
    // first; idempotent no-op when already active. Then ensure a row exists
    // (canonical flow already created one in §6.5; a seed-jump past §6.5
    // hits the create branch).
    switchWorkbenchTab(TOUR_TARGETS.workbenchExperimentsTab);
    await ensureFirstExperimentExists();
  },
  cursorScript: cursorScript(async () => {
    // Click the most-recently-created experiment row. The `^=`
    // attribute selector matches any workbench-experiment-row-* (fine
    // on a fresh tour because §6.5 has just created the user's first
    // experiment, so there's typically one row visible). If the row
    // never mounts (e.g. the experiment create failed), the safe helper
    // returns null and `compactScript` filters it out so the step
    // gracefully no-ops and the popup-mount fallback in
    // `watchExperimentPopupOpened` covers a manual-open case.
    const cardClick = await safeClickAction(
      "[data-tour-target^='workbench-experiment-row-']",
      3000,
    );
    return compactScript([cardClick]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
