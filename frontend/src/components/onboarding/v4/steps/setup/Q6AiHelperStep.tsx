import { useEffect } from "react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";

/**
 * Q6: AI Helper prompt size? Four options: Full (default, recommended)
 * / Lean / Minimal / No or Maybe later (combined into a single radio
 * since both the proposal §4 and the schema treat them as
 * effectively-equivalent "user opted out for now"; the schema retains
 * both values for forward compat). Persists `feature_picks.ai_helper`.
 * The "Lean" radio persists the internal value 'medium' (label only).
 *
 * Per the v3 L6 lock carried into v4: "full" is the default selection.
 * The radio pre-selects "full" and Next is enabled from the start (the
 * pick is already made, the user just confirms or changes it).
 *
 * v4 port: same shape as v3's Q6AiHelperStep, mounted on the v4
 * tour controller's modal-setup surface per L9.
 */
export default function Q6AiHelperStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const picks = sidecar?.feature_picks ?? null;
  // The radio visually pre-selects "full" (the recommended default) when
  // ai_helper is missing. q6 default-radio persistence fix bot 2026-05-26:
  // `initialFeaturePicks` leaves ai_helper undefined (per the 2026-05-21
  // "no option pre-selected" rule for Q2-Q5), but Q6 is the exception
  // because the spec calls for "full" as the recommended default. The
  // visual pre-selection was previously not seeded into the sidecar, so
  // a user who clicked Next without re-clicking landed on the wrapup
  // with ai_helper still undefined -> "Skipped for now". The mount-time
  // patch below commits the visual default to state so Next captures it.
  const current: FeaturePicks["ai_helper"] = picks?.ai_helper ?? "full";

  useEffect(() => {
    // "full" is the recommended default, so Next is enabled on mount
    // even without a fresh click (matches v3 L6).
    setNextDisabled(false);
  }, [setNextDisabled]);

  // Seed the default "full" pick into the sidecar on mount if the user
  // arrived here with no prior answer. Idempotent: if ai_helper is
  // already set (Resume, Back-step, or a real prior pick), this is a
  // no-op. Uses a ref-guarded effect-style check via `picks?.ai_helper`
  // so re-renders during the async write don't re-fire the patch.
  useEffect(() => {
    if (picks && picks.ai_helper === undefined) {
      void patchSidecar((cur) => {
        if (!cur.feature_picks) return cur;
        if (cur.feature_picks.ai_helper !== undefined) return cur;
        return {
          ...cur,
          feature_picks: { ...cur.feature_picks, ai_helper: "full" },
        };
      });
    }
  }, [picks, patchSidecar]);

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
        We can generate a custom system prompt for external AI tools
        like Claude, ChatGPT, or Gemini so they understand how your lab
        notebook is organized. Pick how much detail you want included.
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
          label="Yes, Lean prompt"
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
