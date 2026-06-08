/**
 * §6.10 Settings phase redesign 2026-05-22 (Settings manager), updated
 * 2026-05-27 by v4 tour speech manager — E for the Wave 2E size-diff /
 * size-options split.
 *
 * Per-step contract tests for the four beats that now make up the AI
 * Helper Settings arc:
 *
 *   - `ai-helper-size-diff`         (NARRATION about token cost / WHY)
 *   - `ai-helper-size-options`      (BeakerBot demo, cursor cycle)
 *   - `ai-helper-use-case-paste`    (BeakerBot demo, Copy click)
 *   - `ai-helper-use-case-agentic`  (narration-only, closes the arc)
 *
 * All four share the same gating predicate
 * (`picks.ai_helper ∈ {full, medium, minimal}`) so opt-out users
 * (no / maybe) skip the entire arc just as before.
 *
 * Wave 2E split (2026-05-27): the cursor-cycling Full → Medium →
 * Minimal sequence MOVED from `ai-helper-size-diff` to the new
 * `ai-helper-size-options` step. The size-diff beat is now pure
 * narration explaining WHY token size matters before the demo runs.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import type { TourStep } from "../../../step-types";
import { settingsAiHelperSizeDiffStep } from "../SettingsAiHelperSizeDiffStep";
import {
  aiHelperSizeOptionsStep,
  SIZE_OPTIONS_PAUSE_MS,
} from "../AiHelperSizeOptionsStep";
import {
  settingsAiHelperUseCasePasteStep,
  COPIED_PROMPT_SIZE,
} from "../SettingsAiHelperUseCasePasteStep";
import { settingsAiHelperUseCaseAgenticStep } from "../SettingsAiHelperUseCaseAgenticStep";

function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "no",
    calendar: "no",
    goals: "no",
    ai_helper: "full",
    ...over,
  };
}

function renderSpeech(step: TourStep): string {
  const speech =
    typeof step.speech === "function" ? step.speech() : step.speech;
  const { container, unmount } = render(<>{speech}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

describe("ai-helper-size-diff (NARRATION post-Wave-2E)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsAiHelperSizeDiffStep.id).toBe("ai-helper-size-diff");
    expect(settingsAiHelperSizeDiffStep.pose).toBe("thinking");
    expect(settingsAiHelperSizeDiffStep.completion.type).toBe("manual");
    expect(settingsAiHelperSizeDiffStep.expectedRoute).toBe("/settings");
  });
  it("anchors on the settings-ai-helper-section spotlight target", () => {
    expect(settingsAiHelperSizeDiffStep.targetSelector).toBe(
      "[data-tour-target=\"settings-ai-helper-section\"]",
    );
  });
  it("conditionalOn fires on full/medium/minimal, gates on no/maybe", () => {
    const gate = settingsAiHelperSizeDiffStep.conditionalOn!;
    expect(gate(picks({ ai_helper: "full" }))).toBe(true);
    expect(gate(picks({ ai_helper: "medium" }))).toBe(true);
    expect(gate(picks({ ai_helper: "minimal" }))).toBe(true);
    expect(gate(picks({ ai_helper: "no" }))).toBe(false);
    expect(gate(picks({ ai_helper: "maybe" }))).toBe(false);
  });
  it("has NO cursorScript post-Wave-2E (the cycle moved to ai-helper-size-options)", () => {
    expect(settingsAiHelperSizeDiffStep.cursorScript).toBeUndefined();
  });
  it("speech explains WHY token size matters (tokens / cost framing)", () => {
    const text = renderSpeech(settingsAiHelperSizeDiffStep);
    expect(text).toMatch(/token/i);
    expect(text).toMatch(/Claude/);
    expect(text).toMatch(/ChatGPT/);
    expect(text).toMatch(/Gemini/);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsAiHelperSizeDiffStep)).not.toContain("—");
  });
});

describe("ai-helper-size-options (BeakerBot demo, Wave 2E split)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(aiHelperSizeOptionsStep.id).toBe("ai-helper-size-options");
    expect(aiHelperSizeOptionsStep.pose).toBe("thinking");
    expect(aiHelperSizeOptionsStep.completion.type).toBe("manual");
    expect(aiHelperSizeOptionsStep.expectedRoute).toBe("/settings");
  });
  it("anchors on the settings-ai-helper-section spotlight target", () => {
    expect(aiHelperSizeOptionsStep.targetSelector).toBe(
      "[data-tour-target=\"settings-ai-helper-section\"]",
    );
  });
  it("conditionalOn matches the AI Helper trio's gate", () => {
    const gate = aiHelperSizeOptionsStep.conditionalOn!;
    expect(gate(picks({ ai_helper: "full" }))).toBe(true);
    expect(gate(picks({ ai_helper: "medium" }))).toBe(true);
    expect(gate(picks({ ai_helper: "minimal" }))).toBe(true);
    expect(gate(picks({ ai_helper: "no" }))).toBe(false);
    expect(gate(picks({ ai_helper: "maybe" }))).toBe(false);
  });
  it("has a cursorScript (BeakerBot cycles through the three tabs)", () => {
    expect(aiHelperSizeOptionsStep.cursorScript).toBeDefined();
  });
  it("speech mentions all three size labels", () => {
    // Wave 2E speech rewrite (2026-05-27): the middle tier's USER-FACING
    // label in the speech is "Lean" (the underlying pick value is still
    // `medium`, see the gate test above). Assertion updated from the old
    // "Medium" wording to the current "Lean" label.
    const text = renderSpeech(aiHelperSizeOptionsStep);
    expect(text).toMatch(/Full/);
    expect(text).toMatch(/Lean/);
    expect(text).toMatch(/Minimal/);
  });
  it("declares an 800ms read-then-watch pause between size clicks", () => {
    expect(SIZE_OPTIONS_PAUSE_MS).toBe(800);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(aiHelperSizeOptionsStep)).not.toContain("—");
  });
});

describe("ai-helper-use-case-paste (BeakerBot demo)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsAiHelperUseCasePasteStep.id).toBe(
      "ai-helper-use-case-paste",
    );
    expect(settingsAiHelperUseCasePasteStep.pose).toBe("thinking");
    expect(settingsAiHelperUseCasePasteStep.completion.type).toBe("manual");
    expect(settingsAiHelperUseCasePasteStep.expectedRoute).toBe("/settings");
  });
  it("anchors on the settings-ai-helper-copy spotlight target", () => {
    expect(settingsAiHelperUseCasePasteStep.targetSelector).toBe(
      "[data-tour-target=\"settings-ai-helper-copy\"]",
    );
  });
  it("conditionalOn matches the ai-helper-size-diff predicate", () => {
    const gate = settingsAiHelperUseCasePasteStep.conditionalOn!;
    expect(gate(picks({ ai_helper: "full" }))).toBe(true);
    expect(gate(picks({ ai_helper: "minimal" }))).toBe(true);
    expect(gate(picks({ ai_helper: "no" }))).toBe(false);
  });
  it("has a cursorScript (BeakerBot clicks Copy)", () => {
    expect(settingsAiHelperUseCasePasteStep.cursorScript).toBeDefined();
  });
  it("speech mentions the paste use case + AI chat names", () => {
    const text = renderSpeech(settingsAiHelperUseCasePasteStep);
    expect(text).toMatch(/paste/i);
    expect(text).toMatch(/Claude/);
    expect(text).toMatch(/ChatGPT/);
    expect(text).toMatch(/Gemini/);
  });
  it("COPIED_PROMPT_SIZE is 'minimal' (last tab clicked by size-diff)", () => {
    expect(COPIED_PROMPT_SIZE).toBe("minimal");
  });
  it("declares an onEnter that records the ai_helper_prompt_copied artifact", () => {
    expect(settingsAiHelperUseCasePasteStep.onEnter).toBeDefined();
  });
  it("declares an onExit that flushes the pending artifact", () => {
    expect(settingsAiHelperUseCasePasteStep.onExit).toBeDefined();
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsAiHelperUseCasePasteStep)).not.toContain("—");
  });
});

describe("ai-helper-use-case-agentic (narration-only)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsAiHelperUseCaseAgenticStep.id).toBe(
      "ai-helper-use-case-agentic",
    );
    expect(settingsAiHelperUseCaseAgenticStep.pose).toBe("thinking");
    expect(settingsAiHelperUseCaseAgenticStep.completion.type).toBe("manual");
    expect(settingsAiHelperUseCaseAgenticStep.expectedRoute).toBe(
      "/settings",
    );
  });
  it("has no targetSelector (pure narration; closes the AI Helper arc)", () => {
    expect(settingsAiHelperUseCaseAgenticStep.targetSelector).toBeUndefined();
  });
  it("has no cursorScript (narration-only)", () => {
    expect(settingsAiHelperUseCaseAgenticStep.cursorScript).toBeUndefined();
  });
  it("conditionalOn matches the ai-helper-size-diff predicate", () => {
    const gate = settingsAiHelperUseCaseAgenticStep.conditionalOn!;
    expect(gate(picks({ ai_helper: "full" }))).toBe(true);
    expect(gate(picks({ ai_helper: "minimal" }))).toBe(true);
    expect(gate(picks({ ai_helper: "no" }))).toBe(false);
  });
  it("speech mentions agentic models + writing + collaborating with you", () => {
    const text = renderSpeech(settingsAiHelperUseCaseAgenticStep);
    expect(text).toMatch(/[Aa]gentic/);
    expect(text).toMatch(/WRITE|write/);
    // Copy-trim pass (2026-06): the "research collaborator" line was cut;
    // the collaborative framing now reads "help write your notebook with you."
    expect(text).toMatch(/with you/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsAiHelperUseCaseAgenticStep)).not.toContain("—");
  });
});
