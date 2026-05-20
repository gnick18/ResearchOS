import { useEffect } from "react";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";

interface Q6Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

/**
 * Q6: AI Helper prompt size? Four options: Full (default, recommended)
 * / Medium / Minimal / No or Maybe later (combined into a single radio
 * since both the proposal §4 and the schema treat them as
 * effectively-equivalent "user opted out for now"; the schema retains
 * both values for forward compat). Persists `feature_picks.ai_helper`.
 *
 * Per L6 lock: "full" is the default selection. The radio pre-selects
 * "full" and Next is enabled from the start (the pick is already made,
 * the user just confirms or changes it).
 */
export default function Q6AiHelperStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: Q6Props) {
  const picks = sidecar?.feature_picks ?? null;
  // ai_helper defaults to "full" in initialFeaturePicks(); the radio
  // visually pre-selects whatever the sidecar currently holds, falling
  // back to "full" if for some reason the value is missing.
  const current: FeaturePicks["ai_helper"] = picks?.ai_helper ?? "full";

  useEffect(() => {
    // L6: "full" is the recommended default, so Next is enabled on
    // mount even without a fresh click.
    setNextDisabled(false);
  }, [setNextDisabled]);

  const handleChange = async (next: FeaturePicks["ai_helper"]) => {
    await patchSidecar((cur) => {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, ai_helper: next },
      };
    });
  };

  // For the "No / Maybe later" combined option, we render a single radio
  // bound to the schema value "no" (treating it as the canonical opt-out
  // value). The schema retains "maybe" for callers that want to
  // distinguish; a future revision can split this into two options.
  const optedOut = current === "no" || current === "maybe";

  return (
    <div data-step-id="setup-q6" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        I can copy you a prompt that turns Claude, ChatGPT, or Gemini into a
        schema-aware ResearchOS assistant. Bigger prompts give the chatbot
        more context, smaller prompts cost fewer tokens. Pick a size, or
        skip entirely.
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="q6-ai-helper"
          value="full"
          selected={current === "full"}
          onChange={(v) => void handleChange(v)}
          label="Yes, Full prompt (default, recommended)"
          description="Maximum context. Best answers, biggest token bill."
        />
        <RadioCard
          name="q6-ai-helper"
          value="medium"
          selected={current === "medium"}
          onChange={(v) => void handleChange(v)}
          label="Yes, Medium prompt"
          description="Trimmed for the cost-conscious. Still pretty smart."
        />
        <RadioCard
          name="q6-ai-helper"
          value="minimal"
          selected={current === "minimal"}
          onChange={(v) => void handleChange(v)}
          label="Yes, Minimal prompt"
          description="Bare-bones. Good for quick questions or strict token budgets."
        />
        <RadioCard
          name="q6-ai-helper"
          value="no"
          selected={optedOut}
          onChange={(v) => void handleChange(v)}
          label="No / Maybe later"
          description="Skip the AI Helper tour. I can grab a prompt anytime from Settings."
        />
      </div>
    </div>
  );
}
