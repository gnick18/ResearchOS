import { useEffect, useState } from "react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";

/**
 * Q3: want calendar feeds? Yes / No / Maybe later. Persists
 * `feature_picks.calendar`. Local-pick state pattern to avoid the
 * sidecar-write-latency flicker (see Q2 docstring for the full why).
 * P12: hydrates from the sidecar on mount so Resume / back-step lands
 * on the saved answer (see Q2 docstring for the fix rationale).
 *
 * v4 port: same shape as v3's Q3CalendarStep plus P12 hydration,
 * mounted on the v4 tour controller's modal-setup surface per L9.
 */
export default function Q3CalendarStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const [pick, setPick] = useState<FeaturePicks["calendar"] | null>(
    () => sidecar?.feature_picks?.calendar ?? null,
  );

  useEffect(() => {
    setNextDisabled(pick === null);
  }, [pick, setNextDisabled]);

  const handleChange = (next: FeaturePicks["calendar"]) => {
    setPick(next);
    void patchSidecar((cur) => {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, calendar: next },
      };
    });
  };

  return (
    <div data-step-id="setup-q3" className="space-y-4">
      <p className="text-body text-gray-700 leading-relaxed">
        ResearchOS can overlay any public calendar such as personal ones
        from Outlook, Apple, Google, etc. Would you like a walkthrough
        on how to get that link working?
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="q3-calendar"
          value="yes"
          selected={pick === "yes"}
          onChange={handleChange}
          label="Yes"
          description="Show the Calendar tab and walk me through subscribing to a feed."
        />
        <RadioCard
          name="q3-calendar"
          value="no"
          selected={pick === "no"}
          onChange={handleChange}
          label="No"
          description="Hide the Calendar tab. I can turn it on later from Settings."
        />
        <RadioCard
          name="q3-calendar"
          value="maybe"
          selected={pick === "maybe"}
          onChange={handleChange}
          label="Maybe later"
          description="Hide it for now. Ask me again sometime."
        />
      </div>
    </div>
  );
}
