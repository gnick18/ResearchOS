/**
 * @deprecated 2026-05-22 (Hybrid editor manager): retired by §6.7
 * redesign. Replaced by the multi-beat `hybrid-bold` / `hybrid-italic`
 * / `hybrid-underline` + `hybrid-h1` / `hybrid-h2` / `hybrid-h3`
 * sub-steps (HE-5 + HE-6). Kept in tree for git-history reference;
 * removed from `step-registry.ts` so it never mounts.
 *
 * §6.7 Hybrid editor — paragraph chunks demo.
 *
 * Second of four hybrid-editor sub-steps. Per Grant's voice-to-text:
 *
 *   "These paragraph chunks are unique to ResearchOS, each one is a
 *    separate editable block."
 *
 * The cursor hits Enter twice in the editor to start a new paragraph
 * chunk, then types a short sentence into it.
 *
 * No new artifact — the content lands inside the same notes-content
 * artifact tracked at §6.7's last sub-step.
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech describes the paragraph-chunk concept; the
 * cursor demos it by typing a new chunk into the existing editor (a
 * continuation of §6.7's "I'll type" demo flow from the shortcuts
 * sub-step). No user-directed click language; cursor keeps the typing.
 */
import {
  cursorScript,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

// "\n\n" — start a new paragraph chunk. Then a short sentence in the
// new chunk.
const PARAGRAPH_DEMO =
  "\n\nNew paragraph chunk: each block is independently editable.";

export const hybridEditorParagraphsStep = buildWalkthroughStep({
  id: "hybrid-editor-paragraphs",
  speech:
    "These paragraph chunks are unique to ResearchOS, each one is a separate editable block.",
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
  cursorScript: cursorScript(async () => {
    const typeParagraph = await safeTypeAction(
      targetSelector(TOUR_TARGETS.hybridEditorTextarea),
      PARAGRAPH_DEMO,
      25,
    );
    return compactScript([typeParagraph]);
  }),
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  completion: manualAdvance("Got it, next"),
});
