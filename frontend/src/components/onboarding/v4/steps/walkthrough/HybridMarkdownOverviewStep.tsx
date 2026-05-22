/**
 * §6.7 HE-3 — markdown overview (conditional, NEW).
 *
 * Hybrid editor manager 2026-05-22. Only reached when HE-2's branch
 * landed the user here (they picked "Sure, show me"). Otherwise the
 * HE-2 branch jumps past this step to HE-4.
 *
 * Pose: pointing-up (we used to have a dedicated pose but the existing
 * `pointing` pose is the closest available — keep it consistent with
 * the rest of the narration beats).
 *
 * Speech is multi-paragraph read-only. Spotlights the shortcut bar
 * inside the hybrid editor briefly so the user sees the affordance the
 * speech references ("Every editor here has a shortcut bar at the
 * top").
 *
 * Completion: manual ("Got it, next").
 *
 * NOTE on gating: this step is NOT machine-gated. The HE-2 branch
 * either flows into this step (Sure, show me) or skips it (Yes / Skip).
 * The step-machine treats this id like any other linear step; the
 * "skip" path uses `branchTo("hybrid-editor-mechanic")` which bypasses
 * this id entirely. So there's no `conditionalOn` here.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const hybridMarkdownOverviewStep = buildWalkthroughStep({
  id: "hybrid-markdown-overview",
  speech: (
    <>
      <p className="mb-2">
        Here&apos;s the deal: markdown looks like plain text with little
        symbols around it. Editors that understand markdown turn those
        symbols into formatting.
      </p>
      <p className="mb-2">
        The basics:
        <code className="font-mono mx-0.5 px-1 bg-gray-100 rounded">**bold**</code>,
        <code className="font-mono mx-0.5 px-1 bg-gray-100 rounded">*italic*</code>,
        <code className="font-mono mx-0.5 px-1 bg-gray-100 rounded">_underline_</code>,
        and
        <code className="font-mono mx-0.5 px-1 bg-gray-100 rounded"># Heading</code>
        (more hashes = smaller). Lists work too, a hyphen at the start
        of a line makes a bullet. You&apos;ll see all of these in
        action in a moment.
      </p>
    </>
  ),
  pose: "pointing",
  // Spotlight the shortcut bar (helper panel) so the "Every editor here
  // has a shortcut bar" speech has a visual anchor.
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorShortcutBar),
  completion: manualAdvance("Got it, next"),
});
