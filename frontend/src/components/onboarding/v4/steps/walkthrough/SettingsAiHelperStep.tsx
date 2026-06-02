/**
 * §6.10 Settings — AI Helper deep-explain.
 *
 * @deprecated 2026-05-22 (Settings manager, §6.10 phase redesign).
 *
 * Replaced by three manual-advance beats in `SettingsAiHelperSizeDiffStep.tsx`,
 * `SettingsAiHelperUseCasePasteStep.tsx`, and `SettingsAiHelperUseCaseAgenticStep.tsx`.
 * The split addresses two issues with the prior single-step body:
 *
 *   1. The 5-paragraph speech wall was too dense for one beat.
 *   2. The cursor flew through Full → Medium → Minimal → Copy back-
 *      to-back without giving the user time to read the size-diff
 *      preview pane between clicks.
 *
 * New shape: size-diff (with paused cursor between size clicks),
 * paste use case (with the Copy click), then agentic use case
 * (pure narration). The deep-explain step body survives in the repo
 * for git-history reference + back-compat imports; it is NOT in
 * TOUR_STEP_ORDER and the machine never lands on it.
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
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech is a long explainer (no "click X" directive to
 * the user). The cursor cycles through Full / Medium / Minimal tabs
 * to surface the size diff the speech describes. Brief explicitly
 * classifies settings-ai-helper as demo. Cursor keeps the tab cycle
 * + Copy click.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
  waitForElement,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "ai-helper-deep-explain";

/** Which prompt-size tab the cursor leaves selected at the end of its
 *  script (Full → Medium → Minimal). "minimal" is the last clicked
 *  tab in the cursor sequence so the Copy click writes the minimal
 *  prompt to the clipboard. The artifact records this so the Phase 4
 *  grid can render "AI prompt copied: minimal" verbatim. */
const COPIED_PROMPT_SIZE = "minimal";

export const settingsAiHelperStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        This is the AI Helper. It generates a system prompt about your
        notebook in three sizes: Full, Medium, Minimal.
      </p>
      <p className="mb-2">
        Two ways to use it. One: paste a prompt into a chat with Claude,
        ChatGPT, or Gemini, then ask it questions about your work.
      </p>
      <p>
        Two: give an agentic model read access to your folder and it can
        help draft entries, build methods, and fill in notes.
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
  // Record an `ai_helper_prompt_copied` artifact on entry. Per the
  // brief: the cursor's Copy click always fires (the audit confirmed
  // this), so the artifact unconditionally lands. cleanup_default
  // "keep" because the "artifact" is a clipboard write that's already
  // happened. Phase 4 grid offers a UX-honest "you copied this prompt
  // during the tour" record rather than a destructive cleanup;
  // cleanup-execution.ts treats this as an unknown type → falls to
  // the default warn-and-return branch (no-op cleanup).
  onEnter: () => {
    pendingArtifactStore.add(STEP_ID, {
      type: "ai_helper_prompt_copied",
      id: COPIED_PROMPT_SIZE,
      cleanup_default: "keep",
    });
  },
  onExit: async () => {
    await flushPendingArtifacts(STEP_ID);
  },
  // Gate: matches step-machine.ts `isStepGatedOut` —
  //   ai-helper-deep-explain → picks?.ai_helper is full/medium/minimal
  conditionalOn: (picks) => {
    const v = picks?.ai_helper;
    return v === "full" || v === "medium" || v === "minimal";
  },
  expectedRoute: "/settings",
});
