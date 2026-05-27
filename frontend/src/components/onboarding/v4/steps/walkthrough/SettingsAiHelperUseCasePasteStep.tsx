/**
 * §6.10 Settings — AI Helper use case (paste flow). Settings manager
 * 2026-05-22.
 *
 * Second of three beats replacing the prior single
 * `ai-helper-deep-explain` step. Conditional on
 * `feature_picks.ai_helper` ∈ {full, medium, minimal}.
 *
 * Cursor clicks the Copy button on whatever size is currently
 * selected (the minimal tab, left selected by the preceding
 * `ai-helper-size-diff` beat). The clipboard write records an
 * `ai_helper_prompt_copied` artifact so Phase 4 cleanup can show
 * a UX-honest "you copied this prompt during the tour" record.
 *
 * Speech: "First use case: paste a prompt into your favorite AI chat
 * (Claude, ChatGPT, Gemini). Now you've got a ResearchOS-fluent
 * assistant you can ask questions to. 'What experiments use plasmid
 * X?' 'Summarize this week's notes.' That kind of thing."
 *
 * Classification: BEAKERBOT DEMO. Cursor performs the Copy click;
 * user clicks Got-it to advance.
 *
 * Artifact:
 *   { type: "ai_helper_prompt_copied", id: "minimal", cleanup_default: "keep" }
 *
 * cleanup_default keep because the "artifact" is a clipboard write
 * that's already happened; the grid offers a UX-honest record rather
 * than a destructive cleanup. Mirrors the prior single-step body's
 * artifact contract verbatim, so cleanup-execution.ts needs no edit.
 */
import {
  cursorScript,
  safeClickAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "ai-helper-use-case-paste";

/** Which prompt-size tab the cursor leaves selected at the end of the
 *  preceding `ai-helper-size-diff` beat. The Copy click writes this
 *  size's prompt to the clipboard, and the artifact records it. */
export const COPIED_PROMPT_SIZE = "minimal";

export const settingsAiHelperUseCasePasteStep = buildWalkthroughStep({
  id: STEP_ID,
  speech: (
    <>
      <p className="mb-2">
        The simplest way to use this: copy the prompt, paste it as the
        first message in a new chat with Claude, ChatGPT, or Gemini,
        then ask your question.
      </p>
      <p>
        The model now has context on how your notebook is structured.
        You can ask things like &ldquo;summarize this week&apos;s
        notes&rdquo; or &ldquo;what experiments use plasmid X&rdquo;,
        as long as the chat can also read your ResearchOS folder.
        Without folder access, the chat understands the layout but
        can&apos;t see your actual content.
      </p>
    </>
  ),
  pose: "thinking",
  targetSelector: targetSelector(TOUR_TARGETS.settingsAiHelperCopy),
  cursorScript: cursorScript(async () => {
    const copy = await safeClickAction(
      targetSelector(TOUR_TARGETS.settingsAiHelperCopy),
    );
    return compactScript([copy]);
  }),
  completion: manualAdvance("Got it, next"),
  // Record the clipboard-write artifact on entry. Mirrors the prior
  // single-step body's contract so Phase 4 cleanup behavior is
  // unchanged (the grid renders "AI prompt copied: minimal"; the
  // unknown-type fallback in cleanup-execution.ts treats this as a
  // no-op cleanup since the write already happened).
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
  // Gate: matches step-machine.ts `isStepGatedOut` — ai_helper ∈
  // {full, medium, minimal}.
  conditionalOn: (picks) => {
    const v = picks?.ai_helper;
    return v === "full" || v === "medium" || v === "minimal";
  },
  expectedRoute: "/settings",
});
