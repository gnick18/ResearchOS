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
    // Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
    // applies Grant's BEAKERBOT_TOUR_SCRIPT_REWRITE_2026-05-27.md
    // crash-course copy. Inline `**bold**` + `# Heading` render as
    // <code> per the existing sibling-step precedent.
    <>
      <p className="mb-2">
        Markdown lets you format text without clicking through menus.
        You just type simple symbols around your words.
      </p>
      <p>
        For example, typing{" "}
        <code className="font-mono mx-0.5 px-1 bg-gray-100 rounded">
          **bold**
        </code>{" "}
        makes text bold, and{" "}
        <code className="font-mono mx-0.5 px-1 bg-gray-100 rounded">
          # Heading
        </code>{" "}
        creates a large header. You don&apos;t have to memorize anything
        right now. There&apos;s always a shortcut bar on the left you
        can click if you forget.
      </p>
    </>
  ),
  pose: "pointing",
  // Spotlight the shortcut bar (helper panel) so the "Every editor here
  // has a shortcut bar" speech has a visual anchor.
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorShortcutBar),
  completion: manualAdvance("Got it, next"),
});
