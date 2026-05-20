import { useEffect, useState } from "react";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";

interface Q4Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

/**
 * Q4: want a goal-tracking page? Yes / No / Maybe later. Persists
 * `feature_picks.goals`. Same hasInteracted-gated Next pattern as Q2/Q3.
 */
export default function Q4GoalsStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: Q4Props) {
  const picks = sidecar?.feature_picks ?? null;
  const current = picks?.goals ?? "maybe";
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    setNextDisabled(!hasInteracted);
  }, [hasInteracted, setNextDisabled]);

  const handleChange = async (next: FeaturePicks["goals"]) => {
    setHasInteracted(true);
    await patchSidecar((cur) => {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, goals: next },
      };
    });
  };

  return (
    <div data-step-id="setup-q4" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        Goal-tracking shows weekly / monthly / quarterly bars next to your
        Gantt chart so you can see if your real life lines up with your
        plans. (Spoiler: it usually doesn&apos;t. That&apos;s fine.) Want
        it on?
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="q4-goals"
          value="yes"
          selected={hasInteracted && current === "yes"}
          onChange={(v) => void handleChange(v)}
          label="Yes"
          description="Walk me through the goals flow and surface goals next to my Gantt."
        />
        <RadioCard
          name="q4-goals"
          value="no"
          selected={hasInteracted && current === "no"}
          onChange={(v) => void handleChange(v)}
          label="No"
          description="Skip goals. I can turn them on later from Settings."
        />
        <RadioCard
          name="q4-goals"
          value="maybe"
          selected={hasInteracted && current === "maybe"}
          onChange={(v) => void handleChange(v)}
          label="Maybe later"
          description="Skip for now. We can revisit."
        />
      </div>
    </div>
  );
}
