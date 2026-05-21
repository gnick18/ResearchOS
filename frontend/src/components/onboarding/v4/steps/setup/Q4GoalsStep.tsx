import { useEffect, useState } from "react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";

/**
 * Q4: want a goal-tracking page? Yes / No / Maybe later. Persists
 * `feature_picks.goals`. Local-pick state pattern to avoid the
 * sidecar-write-latency flicker (see Q2 docstring for the full why).
 *
 * v4 port: same shape as v3's Q4GoalsStep, mounted on the v4
 * tour controller's modal-setup surface per L9.
 */
export default function Q4GoalsStep({
  sidecar: _sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const [pick, setPick] = useState<FeaturePicks["goals"] | null>(null);

  useEffect(() => {
    setNextDisabled(pick === null);
  }, [pick, setNextDisabled]);

  const handleChange = (next: FeaturePicks["goals"]) => {
    setPick(next);
    void patchSidecar((cur) => {
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
          selected={pick === "yes"}
          onChange={handleChange}
          label="Yes"
          description="Walk me through the goals flow and surface goals next to my Gantt."
        />
        <RadioCard
          name="q4-goals"
          value="no"
          selected={pick === "no"}
          onChange={handleChange}
          label="No"
          description="Skip goals. I can turn them on later from Settings."
        />
        <RadioCard
          name="q4-goals"
          value="maybe"
          selected={pick === "maybe"}
          onChange={handleChange}
          label="Maybe later"
          description="Skip for now. We can revisit."
        />
      </div>
    </div>
  );
}
