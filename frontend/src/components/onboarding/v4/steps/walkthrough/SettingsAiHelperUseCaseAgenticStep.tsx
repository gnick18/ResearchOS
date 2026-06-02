/**
 * §6.10 Settings — AI Helper use case (agentic flow). Settings manager
 * 2026-05-22.
 *
 * Third of three beats replacing the prior single
 * `ai-helper-deep-explain` step. Conditional on
 * `feature_picks.ai_helper` ∈ {full, medium, minimal}.
 *
 * Pure narration beat — no cursor sequence. Closes out the AI Helper
 * arc by explaining the second (more interesting) use case: agentic
 * models with read access to the user's data folder can WRITE the
 * lab notebook alongside them.
 *
 * Speech: "Second use case is more interesting. Agentic models with
 * read access to your data folder can WRITE your lab notebook with
 * you. Give them a prompt + folder access; they help draft entries,
 * build methods, fill in experiment notes. Like having a research
 * collaborator that knows your codebase."
 *
 * Classification: NARRATION-ONLY. No cursor, no artifact. User clicks
 * Got-it to advance.
 *
 * No spotlight target — the AI Helper section is already on screen
 * from the preceding two beats; this beat just lands the closing
 * paragraph. Leaving `targetSelector` undefined keeps the spotlight
 * from re-aiming at a section the user is already looking at.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

const STEP_ID = "ai-helper-use-case-agentic";

export const settingsAiHelperUseCaseAgenticStep = buildWalkthroughStep({
  id: STEP_ID,
  speech:
    "Agentic models with read access to your data folder can help write your notebook with you. Point one at your folder and it can draft entries and fill in notes.",
  pose: "thinking",
  // No spotlight — pure narration closes the AI Helper arc. The user
  // is already looking at the AI Helper section from the prior beats.
  completion: manualAdvance("Got it, next"),
  // Gate: matches step-machine.ts `isStepGatedOut` — ai_helper ∈
  // {full, medium, minimal}.
  conditionalOn: (picks) => {
    const v = picks?.ai_helper;
    return v === "full" || v === "medium" || v === "minimal";
  },
  expectedRoute: "/settings",
});
