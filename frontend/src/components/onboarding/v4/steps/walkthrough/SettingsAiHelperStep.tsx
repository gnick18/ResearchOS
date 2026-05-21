/**
 * §6.10 Settings — AI Helper deep-explain.
 *
 * Conditional on Q6 = yes (`feature_picks.ai_helper` ∈ {full,
 * medium, minimal}). The step-machine already gates the id via
 * `isStepGatedOut` in P1; the registry just provides the body.
 *
 * Cursor scrolls to the AI Helper section, then briefly clicks each
 * of the three prompt-size tabs (Full / Medium / Minimal) to show the
 * size diff. Optionally clicks Copy.
 *
 * Multi-paragraph speech bubble (no em-dashes):
 *
 *   "This is the AI Helper. Three prompt sizes: Full, Medium, Minimal.
 *    Big context for big models like Claude, ChatGPT, or Gemini.
 *
 *    Two use cases worth knowing:
 *
 *    (1) Paste a prompt into your favorite AI chat. Now you've got a
 *        ResearchOS-fluent agent you can ask questions to.
 *
 *    (2) More interesting: agentic models with access to your data
 *        folder can WRITE your lab notebook with you. You give them a
 *        prompt + read access to your folder; they help you draft
 *        entries, build new methods, fill in experiment notes.
 *
 *    It's like having a research collaborator that knows your codebase."
 *
 * Artifact (conditional):
 *   { type: "ai_helper_prompt_copied", id: "<size>", cleanup_default: "keep" }
 *
 * Only emitted if the user clicked Copy. Cleanup default keep because
 * the "artifact" is a clipboard write that's already happened; the
 * grid offers a UX-honest "you copied this prompt during the tour"
 * record rather than a destructive cleanup.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const settingsAiHelperStep = buildWalkthroughStep({
  id: "ai-helper-deep-explain",
  speech: (
    <>
      <p className="mb-2">
        This is the AI Helper. Three prompt sizes: Full, Medium,
        Minimal. Big context for big models like Claude, ChatGPT, or
        Gemini.
      </p>
      <p className="mb-2">
        Two use cases worth knowing:
      </p>
      <p className="mb-2">
        (1) Paste a prompt into your favorite AI chat. Now you&apos;ve
        got a ResearchOS-fluent agent you can ask questions to.
      </p>
      <p className="mb-2">
        (2) More interesting: agentic models with access to your data
        folder can WRITE your lab notebook with you. You give them a
        prompt and read access to your folder; they help you draft
        entries, build new methods, fill in experiment notes.
      </p>
      <p>
        It&apos;s like having a research collaborator that knows your
        codebase.
      </p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.settingsAiHelperSection),
  cursorScript: cursorScript(async () => {
    // Scroll the AI Helper section into view (waitForElement triggers
    // the spotlight's IntersectionObserver, which scrolls
    // automatically). Then click each size tab in sequence.
    await waitForElement(
      targetSelector(TOUR_TARGETS.settingsAiHelperSection),
    );
    const full = await safeClickAction(
      targetSelector(TOUR_TARGETS.settingsAiHelperTabFull),
    );
    const medium = await safeClickAction(
      targetSelector(TOUR_TARGETS.settingsAiHelperTabMedium),
    );
    const minimal = await safeClickAction(
      targetSelector(TOUR_TARGETS.settingsAiHelperTabMinimal),
    );
    const copy = await safeClickAction(
      targetSelector(TOUR_TARGETS.settingsAiHelperCopy),
    );
    return compactScript([full, medium, minimal, copy]);
  }),
  completion: manualAdvance("Got it, next"),
  // Gate: matches step-machine.ts `isStepGatedOut` —
  //   ai-helper-deep-explain → picks?.ai_helper is full/medium/minimal
  conditionalOn: (picks) => {
    const v = picks?.ai_helper;
    return v === "full" || v === "medium" || v === "minimal";
  },
});
