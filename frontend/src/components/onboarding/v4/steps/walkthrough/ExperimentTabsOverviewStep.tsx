/**
 * §6.6 Experiment tabs OVERVIEW (inserted between -open and -tab).
 *
 * Walkthrough §6.6 reorder (experiment-tabs sub-bot, 2026-05-26). Per
 * Grant's 2026-05-26 fresh-user walkthrough feedback: the v4 tour used
 * to dive into the Methods-attach demo immediately after the popup
 * mounted, and only LATER (HE-0, much further down) explained what
 * the four popup tabs were for. The user got a click demo before the
 * conceptual frame.
 *
 * This step fixes the order: right after the popup mounts (via
 * `experiment-attach-method-open`), BeakerBot pauses and explains what
 * each of the four tabs is FOR before any tab-click demo fires.
 *
 * Teaching shape (narration + soft cursor glide, no real click demo):
 *
 *   The popup is already open. BeakerBot names the four tabs and tells
 *   the user what lives behind each one:
 *
 *     - Details: experiment metadata (project, dates, status, linked
 *                method, scheduling).
 *     - Lab Notes: a markdown editor with image support for writing up
 *                the experiment.
 *     - Method: protocols attached to this experiment.
 *     - Results: tables, outputs, and measurements tracking.
 *
 *   The speech ends with a transition cue so the next step
 *   (`experiment-attach-method-tab`) reads as a continuation.
 *
 * Spotlight: the whole `experiment-tab-container` so the spotlight
 * rings the row of four pill tabs. The cursor glides briefly across
 * each pill (Details, Lab Notes, Method, Results) but DOES NOT click
 * any of them. The hover sequence visually pairs the speech with the
 * affordances; the click demo lives in the follow-up step.
 *
 * Why the hover sequence is a glide and not a series of clicks: per
 * the brief, "explaining what they can do is more important than
 * necessarily showing them as everything". A click sequence would
 * swap the active tab four times (each click resets the panel below),
 * which is busier than the speech wants. A pure glide keeps the
 * Details tab active throughout while the cursor visually traces the
 * row.
 *
 * Completion: manual ("Got it, next") per the universal pacing rule
 * (Grant 2026-05-22). The user reads, then advances.
 *
 * Voice match: §6.7 HE-0 hybrid-notes-vs-results + §6.2b
 * home-widgets-canvas-intro. Multi-sentence, pedagogical, no
 * em-dashes, no emojis. The mascot is BeakerBot throughout.
 *
 * expectedRoute: "/workbench" — the popup is a portal over /workbench,
 * no route change happens here.
 */
import {
  cursorScript,
  compactScript,
  safeGlideToElementAction,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const experimentTabsOverviewStep = buildWalkthroughStep({
  id: "experiment-tabs-overview",
  speech: (
    <>
      <p className="mb-2">
        Before we click anything, take a look at the four tabs along
        the top of this popup.
      </p>
      <p className="mb-2">
        <strong>Details</strong> holds the experiment's metadata: the
        project it belongs to, dates, status, linked method, and
        scheduling.
      </p>
      <p className="mb-2">
        <strong>Lab Notes</strong> is a markdown editor with image
        support, where you write up the experiment as you go.
      </p>
      <p className="mb-2">
        <strong>Method</strong> is the protocol attached to this
        experiment (the recipe you're running).
      </p>
      <p className="mb-2">
        <strong>Results</strong> is for the data side: tables, outputs,
        and measurements.
      </p>
      <p>
        Now I'll show you how to attach a method.
      </p>
    </>
  ),
  pose: "pointing",
  // Spotlight the full tab strip so the speech bubble's four bullets
  // land on the four visible pills. R1 fix-pass parity with §6.7 HE-0:
  // a wider spotlight makes the multi-tab pairing readable; a narrow
  // single-tab spotlight would fight the speech.
  targetSelector: targetSelector(TOUR_TARGETS.experimentTabContainer),
  cursorScript: cursorScript(async () => {
    // Soft hover sequence across the tab anchors. The cursor glides
    // into the tab strip and lingers on each named tab in (roughly)
    // the same order the speech mentions them. Glide-only (no clicks)
    // so the active tab does not change during the explanation; the
    // follow-up `experiment-attach-method-tab` step owns the first
    // real click.
    //
    // The Details tab does not carry its own data-tour-target (the
    // container only stamps Notes / Method / Results), so we anchor
    // the first glide on the container itself. Its left edge sits
    // over the Details pill in the rendered layout, so the cursor
    // lands near the Details affordance without needing a new
    // product-surface attribute.
    //
    // Each `safeGlideToElementAction` blocks for the cursor's
    // configured glideMs (default ~1000ms), which provides the
    // natural per-tab linger so the user has a beat to read the
    // matching bullet in the speech bubble.
    const glideToTabs = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.experimentTabContainer),
      3000,
    );
    const glideToNotes = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.experimentNotesTab),
      3000,
    );
    const glideToMethod = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.experimentMethodsTab),
      3000,
    );
    const glideToResults = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.experimentResultsTab),
      3000,
    );
    return compactScript([
      glideToTabs,
      glideToNotes,
      glideToMethod,
      glideToResults,
    ]);
  }),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
